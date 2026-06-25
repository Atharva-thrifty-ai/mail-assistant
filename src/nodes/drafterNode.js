const { ChatOpenAI, OpenAIEmbeddings } = require("@langchain/openai");
const { PromptTemplate } = require("@langchain/core/prompts");
const fs = require('fs');
const path = require('path');
const { createGmailDraft } = require('../utils/gmailApi');

// Simple cosine similarity dot product
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct;
}

async function runDrafterNode(ueo) {
    console.log(`[DRAFTER NODE] Analyzing thread ${ueo.internal_thread_id}...`);

    try {
        // 1. Prepare context for search
        const K = 3; // The visible window size used by Memory Node
        const visibleHistory = ueo.historical_thread_messages.slice(-K);
        const allRecentMessages = [...visibleHistory, ueo.latest_message];
        const recentMessagesText = allRecentMessages.join("\n\n");
        const searchQuery = `Summary: ${ueo.running_summary || 'None'}\n\nRecent Emails:\n${recentMessagesText}`;

        // 2. Perform RAG Similarity Search
        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: "text-embedding-3-small",
        });
        
        const queryVector = await embeddings.embedQuery(searchQuery);
        
        const dbPath = path.join(__dirname, '../config/memory_vectors.json');
        let ragContext = "No rules found.";
        
        if (fs.existsSync(dbPath)) {
            const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            
            // Score all chunks
            const scoredChunks = db.map(doc => ({
                text: doc.text,
                score: cosineSimilarity(queryVector, doc.embedding)
            }));
            
            // Sort highest score first, grab top 2
            scoredChunks.sort((a, b) => b.score - a.score);
            const topChunks = scoredChunks.slice(0, 2);
            
            ragContext = topChunks.map(c => c.text).join("\n\n");
            console.log(`[DRAFTER NODE] Retrieved ${topChunks.length} relevant business rules via RAG.`);
        }

        // 3. Draft the Reply
        const llm = new ChatOpenAI({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: "gpt-4o-mini",
            temperature: 0.2
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
CRITICAL INSTRUCTION: ONLY draft a reply if the sender is explicitly asking a question, requesting a query, demanding feedback/action, OR showing an intent to talk, converse, or schedule a meeting. If the email is purely informational, a newsletter, or a dead-end conversation, output the exact word "SKIP" and nothing else.

If drafting a reply, you MUST adhere to the following strict structure:
1. Start with a friendly greeting (e.g., "Hello [Name]," or "Hi there,")
2. On a new line, write the body of the message addressing their question using the Business Rules.
3. On a new line, end with a professional closing (e.g., "Best regards," followed by "[Your Name]").

Do NOT include Subject lines or "To/From" headers. Just the raw email text.
        `);

        const chain = prompt.pipe(llm);
        const result = await chain.invoke({
            rag_context: ragContext,
            summary: ueo.running_summary || 'None',
            emails: recentMessagesText
        });

        const draftText = result.content;
        
        if (draftText.trim() === 'SKIP') {
            console.log(`[DRAFTER NODE] AI determined no reply is needed. Skipping draft creation.`);
            return ueo;
        }

        console.log(`[DRAFTER NODE] Generated Draft:\n${draftText}\n`);

        // 4. Provider-Agnostic API Push
        if (ueo.provider_thread_id) {
            if (ueo.source === 'gmail') {
                const draftResponse = await createGmailDraft(ueo.provider_thread_id, draftText);
                if (draftResponse && draftResponse.id) {
                    ueo.native_draft_id = draftResponse.id;
                }
            } else if (ueo.source === 'microsoft') {
                console.log(`[DRAFTER NODE] Microsoft API not yet implemented. Skipping push.`);
            }
        } else {
            console.log(`[DRAFTER NODE] No provider_thread_id found (likely a test). Skipping native API push.`);
        }

        // 5. Attach to UEO
        ueo.draft = draftText;
        return ueo;

    } catch (e) {
        console.error(`[DRAFTER NODE] Error processing thread ${ueo.internal_thread_id}:`, e);
        return ueo;
    }
}

module.exports = { runDrafterNode };
