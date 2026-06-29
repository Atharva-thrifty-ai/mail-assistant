const { ChatOpenAI } = require("@langchain/openai");
const { PromptTemplate } = require("@langchain/core/prompts");
const { createComposeDraft, sendGmailDraft } = require('../../src/utils/gmailApi');
const { metadataDb } = require('../../src/config/database');
const { extractThreadHistory } = require('../services/extractorService');
const { cleanMessageBody } = require('../../src/ingestion/preprocessor');
const logger = require('../../src/utils/logger');

// 1. Stream Compose Draft
async function composeDraftStream(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { instructions } = req.body;

    const llm = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0.7,
        streaming: true
    });

    const prompt = PromptTemplate.fromTemplate(`
You are an intelligent email assistant composing a new email from scratch.

USER INSTRUCTIONS:
{instructions}

Write the email to perfectly address the user's instructions. Maintain a professional structure.
Do NOT include Subject lines or headers. Just the raw email text.
`);

    const chain = prompt.pipe(llm);

    try {
        const stream = await chain.stream({ instructions });
        for await (const chunk of stream) {
            if (chunk.content) {
                res.write(`data: ${JSON.stringify({ text: chunk.content })}\n\n`);
            }
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
    } catch (error) {
        logger.error(`[COMPOSE AI] Error streaming compose draft:`, error);
        res.write(`data: ${JSON.stringify({ text: "\n[Error generating draft]" })}\n\n`);
        res.end();
    }
}

// 2. Stream Forward Draft (Optional AI Intro)
async function forwardDraftStream(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { thread_id } = req.params;
    const { instructions } = req.body;

    const extractorData = await extractThreadHistory(thread_id);
    const recentMessagesText = extractorData.messages.map(m => cleanMessageBody(m.bodyHtml)).join("\n\n");

    const llm = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0.7,
        streaming: true
    });

    const prompt = PromptTemplate.fromTemplate(`
You are an intelligent email assistant writing a brief introduction for an email that is being forwarded.

FORWARDED EMAILS (Context):
{emails}

USER INSTRUCTIONS:
{instructions}

Write a short, polite introduction addressing the user's instructions. 
Do NOT include the forwarded message itself. Do NOT include Subject lines or headers.
Just the brief introductory text.
`);

    const chain = prompt.pipe(llm);

    try {
        const stream = await chain.stream({ instructions, emails: recentMessagesText });
        for await (const chunk of stream) {
            if (chunk.content) {
                res.write(`data: ${JSON.stringify({ text: chunk.content })}\n\n`);
            }
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
    } catch (error) {
        logger.error(`[FORWARD AI] Error streaming forward draft:`, error);
        res.write(`data: ${JSON.stringify({ text: "\n[Error generating draft]" })}\n\n`);
        res.end();
    }
}

// 3. Send Compose
async function composeSend(req, res) {
    const { to, subject, draftText } = req.body;

    try {
        const draft = await createComposeDraft(to, subject, draftText);
        if (draft && draft.id) {
            const success = await sendGmailDraft(draft.id);
            if (success) {
                return res.json({ success: true });
            }
        }
        res.status(500).json({ success: false, error: "Failed to send email" });
    } catch (error) {
        logger.error("[COMPOSE] Error sending email:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// 4. Send Forward
async function forwardSend(req, res) {
    const { thread_id } = req.params;
    const { to, draftText } = req.body;

    try {
        const metadataRow = metadataDb.prepare("SELECT provider_thread_id, subject FROM metadata WHERE internal_thread_id = ?").get(thread_id);
        if (!metadataRow) {
            return res.status(404).json({ success: false, error: 'Thread not found' });
        }

        let subject = metadataRow.subject || '';
        if (subject && !subject.toLowerCase().startsWith('fwd:')) {
            subject = `Fwd: ${subject}`;
        } else if (!subject) {
            subject = 'Fwd:';
        }

        const draft = await createComposeDraft(to, subject, draftText, metadataRow.provider_thread_id);
        if (draft && draft.id) {
            const success = await sendGmailDraft(draft.id);
            if (success) {
                return res.json({ success: true });
            }
        }
        res.status(500).json({ success: false, error: "Failed to forward email" });
    } catch (error) {
        logger.error("[FORWARD] Error forwarding email:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    composeDraftStream,
    forwardDraftStream,
    composeSend,
    forwardSend
};
