const { ChatOpenAI } = require('@langchain/openai');
const { PromptTemplate } = require('@langchain/core/prompts');
const { memoryDb } = require('../config/database');

// Initialize the LangChain LLM using the gpt-5.4-nano model
const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: "gpt-4o-mini", // Note: gpt-5.4-nano is a conceptual name; using gpt-4o-mini as the literal API equivalent for cheap/fast text processing
    temperature: 0.2 // Low temperature for factual summarization
});

// The prompt template for squashing new messages into an existing summary
const summaryPrompt = PromptTemplate.fromTemplate(`
You are an expert executive assistant. Your task is to update a running summary of an email thread.

CURRENT SUMMARY:
{existing_summary}

NEW EMAILS TO SQUASH INTO SUMMARY:
{new_messages}

INSTRUCTIONS:
Integrate the core information from the NEW EMAILS into the CURRENT SUMMARY. 
Keep the final output dense, strictly factual, and concise. Do not add conversational filler.
`);

async function runMemoryNode(ueo) {
    const K = 3; // The visible window size
    const internalThreadId = ueo.internal_thread_id;
    const historicalMessages = ueo.historical_thread_messages || [];
    const totalMessages = historicalMessages.length;

    console.log(`[MEMORY NODE] Analyzing thread ${internalThreadId} (${totalMessages} total historical messages)`);

    // 1. Dormancy Check (Cost Savings)
    if (totalMessages <= K) {
        console.log(`[MEMORY NODE] Thread ${internalThreadId} is <= K (${totalMessages} <= ${K}). Remaining dormant.`);
        return ueo; // Return as-is, fan-out nodes will just see the raw messages
    }

    // 2. Fetch existing summary state from memory.db
    let dbRow = memoryDb.prepare("SELECT summarized_count, running_summary FROM running_summaries WHERE internal_thread_id = ?").get(internalThreadId);
    
    let summarizedCount = dbRow ? dbRow.summarized_count : 0;
    let existingSummary = dbRow ? dbRow.running_summary : "No previous summary exists.";

    // 3. The Math: Calculate how many messages are falling out of the K-window
    const targetSquashCount = totalMessages - K;

    if (summarizedCount >= targetSquashCount) {
        // This is a safety catch. It means the summary is already perfectly up to date.
        console.log(`[MEMORY NODE] Summary already up to date. (summarized: ${summarizedCount}, target: ${targetSquashCount})`);
        // Inject the summary into the UEO for the Fan-out nodes to use
        ueo.running_summary = existingSummary;
        return ueo;
    }

    // 4. The Bunch Slice: Grab ALL messages that were skipped and need squashing
    const messagesToSquash = historicalMessages.slice(summarizedCount, targetSquashCount);
    console.log(`[MEMORY NODE] Squashing ${messagesToSquash.length} skipped messages into summary...`);

    // 5. Build the text block of the missed emails
    const newMessagesText = messagesToSquash.map((msg, idx) => `--- EMAIL ${summarizedCount + idx + 1} ---\n${msg}`).join('\n\n');

    // 6. Execute LangChain
    const chain = summaryPrompt.pipe(llm);
    
    const response = await chain.invoke({
        existing_summary: existingSummary,
        new_messages: newMessagesText
    });
    
    const newRunningSummary = response.content;

    // 7. Save to DB
    const stmt = memoryDb.prepare(`
        INSERT INTO running_summaries (internal_thread_id, summarized_count, running_summary)
        VALUES (?, ?, ?)
        ON CONFLICT(internal_thread_id) DO UPDATE SET
            summarized_count = excluded.summarized_count,
            running_summary = excluded.running_summary
    `);
    
    stmt.run(internalThreadId, targetSquashCount, newRunningSummary);
    console.log(`[MEMORY NODE] Successfully updated memory.db for ${internalThreadId} (Now squashed: ${targetSquashCount} messages)`);

    // 8. Inject the summary into the UEO for the next Phase (Fan-Out nodes)
    ueo.running_summary = newRunningSummary;
    
    return ueo;
}

module.exports = {
    runMemoryNode
};
