const logger = require('../utils/logger');
const { ChatOpenAI, OpenAIEmbeddings } = require('@langchain/openai');
const fs = require('fs');
const path = require('path');
const { PromptTemplate } = require('@langchain/core/prompts');
const { z } = require('zod');
const { summariesDb, metadataDb } = require('../config/database');

// Simple cosine similarity dot product
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct;
}

// 1. Define the exact Zod Schema for Structured Outputs
const classifierSchema = z.object({
    summary: z.string().describe("A concise, 1-sentence summary of the entire thread."),
    categories: z.array(z.enum([
        "Spam",
        "Personal & Social",
        "Work & Professional",
        "Attention"
    ])).describe("Select 1 or more categories that perfectly describe this thread.")
});

// 2. Initialize the LLM with Structured Output bound
const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: "gpt-4o-mini", // Literal API equivalent for cheap/fast processing
    temperature: 0.1 // Very low temp for strict classification
}).withStructuredOutput(classifierSchema);

// 3. The Prompt Template
const classifierPrompt = PromptTemplate.fromTemplate(`
You are a highly efficient personal email assistant.
Your task is to analyze an email conversation, provide a  summary, and apply the most accurate categories to it.

BUSINESS RULES:
{rag_context}

PREVIOUS THREAD SUMMARY:
{running_summary}

RECENT MESSAGES:
{recent_messages}

INSTRUCTIONS:
1. Provide a single, short sentence summarizing the entire state of the conversation.
2. Select the most appropriate categories. 
   - "Spam": Unwanted or malicious emails.
   - "Personal & Social": Automated notifications from Reddit, LinkedIn, Discord, social media, promotional emails, and personal friendly chats.
   - "Work & Professional": Legitimate work-related emails, job opportunities
   - "Attention": Use this IF AND ONLY IF the email is inquiring about, offering, or directly related to the BUSINESS RULES provided in the buissness rules.
` );

async function runClassifierNode(ueo) {
    const internalThreadId = ueo.internal_thread_id;
    logger.info(`[CLASSIFIER NODE] Analyzing thread ${internalThreadId}...`);

    // 1. Build the prompt text
    const runningSummary = ueo.running_summary || "No previous summary.";

    // Grab the actual raw messages that haven't been squashed into the summary yet
    const K = 3; // The visible window size used by Memory Node
    const visibleHistory = ueo.historical_thread_messages.slice(-K);
    const allRecentMessages = [...visibleHistory, ueo.latest_message];
    const recentMessagesText = allRecentMessages.map((msg, idx) => `--- MESSAGE ${idx + 1} ---\n${msg}`).join('\n\n');

    // 2. Perform RAG Similarity Search
    const searchQuery = `Summary: ${runningSummary}\n\nRecent Emails:\n${recentMessagesText}`;
    const embeddings = new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "text-embedding-3-small",
    });

    const queryVector = await embeddings.embedQuery(searchQuery);
    const dbPath = path.join(__dirname, '../config/memory_vectors.json');
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
        logger.info(`[CLASSIFIER NODE] Retrieved ${topChunks.length} relevant business rules via RAG.`);
    }

    // 3. Execute the Chain (returns a perfect JSON object matching our Zod schema)
    const chain = classifierPrompt.pipe(llm);

    const structuredResult = await chain.invoke({
        rag_context: ragContext,
        running_summary: runningSummary,
        recent_messages: recentMessagesText
    });

    logger.info(`[CLASSIFIER NODE] Generated: ${JSON.stringify(structuredResult)}`);

    // 3. Save the Summary to summariesDb
    const summaryStmt = summariesDb.prepare(`
        INSERT INTO ui_summaries (internal_thread_id, ui_summary)
        VALUES (?, ?)
        ON CONFLICT(internal_thread_id) DO UPDATE SET
            ui_summary = excluded.ui_summary
    `);
    summaryStmt.run(internalThreadId, structuredResult.summary);

    // 4. Update the Categories in metadataDb
    if (!ueo.is_spam) {
        // AI Spam Flagging: If AI detects spam, permanently flag it as spam in the DB
        if (structuredResult.categories && structuredResult.categories.includes("Spam")) {
            logger.info(`[CLASSIFIER NODE] AI flagged thread as Spam. Updating is_spam = 1 and is_inbox = 0.`);
            
            // Remove other conflicting categories if it's spam
            structuredResult.categories = structuredResult.categories.filter(cat => 
                !["Attention", "Work & Professional", "Personal & Social"].includes(cat)
            );

            metadataDb.prepare(`UPDATE metadata SET is_spam = 1, is_inbox = 0 WHERE internal_thread_id = ?`)
                .run(internalThreadId);
        }

        const metadataStmt = metadataDb.prepare(`
            UPDATE metadata 
            SET ai_categories = ? 
            WHERE internal_thread_id = ?
        `);
        metadataStmt.run(JSON.stringify(structuredResult.categories), internalThreadId);
    } else {
        logger.info(`[CLASSIFIER NODE] Thread is native SPAM. Skipping ai_categories update.`);
    }

    logger.info(`[CLASSIFIER NODE] Successfully updated databases for ${internalThreadId}.`);

    return ueo;
}

module.exports = {
    runClassifierNode
};
