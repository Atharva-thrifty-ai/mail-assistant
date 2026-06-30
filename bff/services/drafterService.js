const logger = require('../../src/utils/logger');
const { ChatOpenAI, OpenAIEmbeddings } = require("@langchain/openai");
const { PromptTemplate } = require("@langchain/core/prompts");
const fs = require('fs');
const path = require('path');
const { statusDb, metadataDb, memoryDb, metricsDb } = require('../../src/config/database');
const { TpmCallback } = require('../../src/utils/tpmCallback');
const { createGmailDraft, updateGmailDraft, getGmailDraftText, getGmailThreadDrafts } = require('../../src/utils/gmailApi');
const { extractThreadHistory } = require('./extractorService');
const { cleanMessageBody } = require('../../src/ingestion/preprocessor');

// Sleep utility for polling
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Simple cosine similarity dot product for local RAG
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct;
}

// Local RAG lookup
async function getRagContext(searchQuery) {
    const embeddings = new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "text-embedding-3-small",
    });
    const queryVector = await embeddings.embedQuery(searchQuery);
    const dbPath = path.join(__dirname, '../../src/config/memory_vectors.json');
    let ragContext = "No rules found.";

    if (fs.existsSync(dbPath)) {
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const scoredChunks = db.map(doc => ({
            text: doc.text,
            score: cosineSimilarity(queryVector, doc.embedding)
        }));
        scoredChunks.sort((a, b) => b.score - a.score);
        const topChunks = scoredChunks.slice(0, 2);
        ragContext = topChunks.map(c => c.text).join("\n\n");
    }
    return ragContext;
}

// ------------------------------------------------------------------
// 1. FAST-CREATE DRAFT (For SSE Stream)
// ------------------------------------------------------------------
async function* generateFastCreateStream(internal_thread_id, provider_thread_id, source) {
    const extractorData = await extractThreadHistory(internal_thread_id);
    const recentMessagesText = extractorData.messages.map(m => cleanMessageBody(m.bodyHtml)).join("\n\n");
    
    const runningSummaryRow = memoryDb.prepare("SELECT running_summary FROM running_summaries WHERE internal_thread_id = ?").get(internal_thread_id);
    const summary = runningSummaryRow ? runningSummaryRow.running_summary : 'None';
    
    const ragContext = await getRagContext(`Summary: ${summary}\n\nRecent Emails:\n${recentMessagesText}`);

    const llm = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0.2,
        streamUsage: true,
        callbacks: [new TpmCallback()]
    });

    const prompt = PromptTemplate.fromTemplate(`
You are an intelligent email assistant drafting a reply on behalf of the user.

BUSINESS RULES (Strictly adhere to these):
{rag_context}

CONVERSATION SUMMARY:
{summary}

RECENT EMAILS:
{emails}

Write a highly professional, friendly, and concise reply to the last email.
CRITICAL INSTRUCTION: Since the user explicitly requested this draft, DO NOT SKIP. Always write a response.
1. Start with a friendly greeting
2. On a new line, write the body
3. End with a professional closing

Do NOT include Subject lines or "To/From" headers. Just the raw email text.
    `);

    const chain = prompt.pipe(llm);
    const stream = await chain.stream({
        rag_context: ragContext,
        summary: summary,
        emails: recentMessagesText
    });

    let fullDraftText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    
    for await (const chunk of stream) {
        fullDraftText += chunk.content;
        
        if (chunk.usage_metadata) {
            inputTokens = chunk.usage_metadata.input_tokens || 0;
            outputTokens = chunk.usage_metadata.output_tokens || 0;
        }

        yield chunk.content;
    }

    metricsDb.prepare(`
        INSERT INTO node_metrics (node_name, total_input_tokens, total_output_tokens, total_requests)
        VALUES ('BFF Fast-Create', ?, ?, 1)
        ON CONFLICT(node_name) DO UPDATE SET 
            total_input_tokens = total_input_tokens + excluded.total_input_tokens,
            total_output_tokens = total_output_tokens + excluded.total_output_tokens,
            total_requests = total_requests + 1
    `).run(inputTokens, outputTokens);

    // POST-STREAM SYNC
    if (source === 'gmail') {
        const draftResponse = await createGmailDraft(provider_thread_id, fullDraftText);
        if (draftResponse && draftResponse.id) {
            metadataDb.prepare("UPDATE metadata SET native_draft_id = ?, is_draft = 1 WHERE internal_thread_id = ?").run(draftResponse.id, internal_thread_id);
        }
    } else if (source === 'microsoft') {
        logger.info(`[BFF DRAFTER] Microsoft API paused. Skipping push for thread ${internal_thread_id}`);
        metadataDb.prepare("UPDATE metadata SET is_draft = 1 WHERE internal_thread_id = ?").run(internal_thread_id);
    }
}

// ------------------------------------------------------------------
// GET DRAFT (MASTER ROUTING FUNCTION)
// ------------------------------------------------------------------
async function* getDraftStream(internal_thread_id) {
    const metadataRow = metadataDb.prepare("SELECT provider_thread_id, is_draft, native_draft_id, source FROM metadata WHERE internal_thread_id = ?").get(internal_thread_id);
    if (!metadataRow) {
        yield "Error: Thread not found.";
        return;
    }

    let statusRow = statusDb.prepare("SELECT status FROM status WHERE internal_thread_id = ?").get(internal_thread_id);

    // CONDITION 1: PENDING
    if (statusRow && (statusRow.status === 'pending' || statusRow.status === 'processing')) {
        yield "[SSE_WAITING]"; // Special token for UI
        while (statusRow && (statusRow.status === 'pending' || statusRow.status === 'processing')) {
            await sleep(500);
            statusRow = statusDb.prepare("SELECT status FROM status WHERE internal_thread_id = ?").get(internal_thread_id);
        }
        // Once complete, fetch the updated metadata
        const updatedMeta = metadataDb.prepare("SELECT is_draft, native_draft_id FROM metadata WHERE internal_thread_id = ?").get(internal_thread_id);
        if (updatedMeta.is_draft && updatedMeta.native_draft_id) {
            const draftText = await getGmailDraftText(updatedMeta.native_draft_id);
            yield draftText;
        } else {
            // Edge case: Finished but gatekeeper skipped it
            for await (const token of generateFastCreateStream(internal_thread_id, metadataRow.provider_thread_id, metadataRow.source)) {
                yield token;
            }
        }
        return;
    }

    // CONDITION 2: COMPLETED & SKIPPED
    if (statusRow.status === 'completed' && metadataRow.is_draft === 0) {
        for await (const token of generateFastCreateStream(internal_thread_id, metadataRow.provider_thread_id, metadataRow.source)) {
            yield token;
        }
        return;
    }

    // CONDITION 3: COMPLETED & DRAFTED
    if (statusRow.status === 'completed' && metadataRow.is_draft === 1) {
        let draftText = null;
        if (metadataRow.native_draft_id) {
            draftText = await getGmailDraftText(metadataRow.native_draft_id);
        } else {
            // Fallback: User manual draft
            draftText = await getGmailThreadDrafts(metadataRow.provider_thread_id);
        }
        yield draftText || "Error: Draft missing.";
        return;
    }
}

// ------------------------------------------------------------------
// REDRAFT (POST STREAM)
// ------------------------------------------------------------------
async function* redraftStream(internal_thread_id, user_comments, earlier_draft) {
    const metadataRow = metadataDb.prepare("SELECT provider_thread_id, native_draft_id, source FROM metadata WHERE internal_thread_id = ?").get(internal_thread_id);
    if (!metadataRow) {
        yield "Error: Thread not found.";
        return;
    }

    const extractorData = await extractThreadHistory(internal_thread_id);
    const recentMessagesText = extractorData.messages.map(m => cleanMessageBody(m.bodyHtml)).join("\n\n");

    const runningSummaryRow = memoryDb.prepare("SELECT running_summary FROM running_summaries WHERE internal_thread_id = ?").get(internal_thread_id);
    const summary = runningSummaryRow ? runningSummaryRow.running_summary : 'None';
    
    const ragContext = await getRagContext(`User Request: ${user_comments}\nOld Draft: ${earlier_draft}`);

    const llm = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o-mini",
        temperature: 0.4, // Slightly higher temperature for revision creativity
        streamUsage: true,
        callbacks: [new TpmCallback()]
    });

    const prompt = PromptTemplate.fromTemplate(`
You are an intelligent email assistant revising an email draft based on user feedback.

BUSINESS RULES:
{rag_context}

CONVERSATION SUMMARY:
{summary}

RECENT EMAILS:
{emails}

OLD DRAFT:
{earlier_draft}

USER COMMENTS / INSTRUCTIONS:
{user_comments}

Rewrite the draft to perfectly address the user's comments. Maintain a professional structure.
Do NOT include Subject lines or headers. Just the raw email text.
    `);

    const chain = prompt.pipe(llm);
    const stream = await chain.stream({
        rag_context: ragContext,
        summary: summary,
        emails: recentMessagesText,
        earlier_draft: earlier_draft,
        user_comments: user_comments
    });

    let fullRevisedText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
        fullRevisedText += chunk.content;
        
        if (chunk.usage_metadata) {
            inputTokens = chunk.usage_metadata.input_tokens || 0;
            outputTokens = chunk.usage_metadata.output_tokens || 0;
        }

        yield chunk.content;
    }

    metricsDb.prepare(`
        INSERT INTO node_metrics (node_name, total_input_tokens, total_output_tokens, total_requests)
        VALUES ('BFF Redraft', ?, ?, 1)
        ON CONFLICT(node_name) DO UPDATE SET 
            total_input_tokens = total_input_tokens + excluded.total_input_tokens,
            total_output_tokens = total_output_tokens + excluded.total_output_tokens,
            total_requests = total_requests + 1
    `).run(inputTokens, outputTokens);

    // POST-STREAM SYNC
    if (metadataRow.source === 'gmail') {
        if (metadataRow.native_draft_id) {
            await updateGmailDraft(metadataRow.native_draft_id, metadataRow.provider_thread_id, fullRevisedText);
        } else {
            // In case it was a manual user draft, we just create a new one to overwrite
            const draftResponse = await createGmailDraft(metadataRow.provider_thread_id, fullRevisedText);
            if (draftResponse && draftResponse.id) {
                metadataDb.prepare("UPDATE metadata SET native_draft_id = ?, is_draft = 1 WHERE internal_thread_id = ?").run(draftResponse.id, internal_thread_id);
            }
        }
    } else if (metadataRow.source === 'microsoft') {
        logger.info(`[BFF DRAFTER] Microsoft API paused. Skipping redraft push for thread ${internal_thread_id}`);
    }
}

module.exports = { getDraftStream, redraftStream };
