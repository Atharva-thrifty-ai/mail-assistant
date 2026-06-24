// verification_script.js (Run this to test Phase 3)
require('dotenv').config();
const { queuesDb, statusDb, memoryDb } = require('./src/config/database');
const { urgentQueue } = require('./src/ingestion/fetchQueue');
const { startWorkerPool } = require('./src/ingestion/worker');

console.log("=== INJECTING FAKE 10-EMAIL THREAD ===");

const TEST_ID = "test_thread_123";
const TEST_VERSION = 1;

// 1. Reset databases for this specific test thread
statusDb.exec(`DELETE FROM status WHERE internal_thread_id = '${TEST_ID}'`);
memoryDb.exec(`DELETE FROM running_summaries WHERE internal_thread_id = '${TEST_ID}'`);
queuesDb.exec(`DELETE FROM threads WHERE internal_thread_id = '${TEST_ID}'`);

// 2. Create the fake Status
statusDb.prepare(`INSERT INTO status (internal_thread_id, live_version, status) VALUES (?, ?, ?)`).run(TEST_ID, TEST_VERSION, 'pending');

// 3. Create a fake UEO with 10 historical messages
const fakeUeo = {
    internal_thread_id: TEST_ID,
    live_version: TEST_VERSION,
    historical_thread_messages: [
        "Email 1: Hi, I want to buy your software.",
        "Email 2: Okay, it costs $50.",
        "Email 3: Can you do $40?",
        "Email 4: No, sorry.",
        "Email 5: Fine, I will pay $50.",
        "Email 6: Great, here is the payment link.",
        "Email 7: I paid it. Did you get it?",
        "Email 8: Yes, thanks.",
        "Email 9: How do I install it?",
        "Email 10: Just run the exe file."
    ]
};

// 4. Save to queues.db
queuesDb.prepare(`
    INSERT INTO threads (internal_thread_id, live_version, payload_json)
    VALUES (?, ?, ?)
`).run(TEST_ID, TEST_VERSION, JSON.stringify(fakeUeo));

// 5. Inject into Urgent Queue
urgentQueue.push({ internal_thread_id: TEST_ID, live_version: TEST_VERSION });

console.log(`Injected Thread ${TEST_ID} with 10 raw messages.`);
console.log("Starting Worker Pool to watch the Memory Node work...");

// 6. Start the worker to process it immediately
startWorkerPool();
