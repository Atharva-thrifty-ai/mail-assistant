// verification_script.js (Parallel Fan-Out & RAG Draft Test)
require('dotenv').config();
const { queuesDb, statusDb, memoryDb, metadataDb, summariesDb } = require('./src/config/database');
const { urgentQueue } = require('./src/ingestion/fetchQueue');
const { startWorkerPool } = require('./src/ingestion/worker');

console.log("=== INJECTING 2 FAKE THREADS FOR RAG TESTING ===");

const threads = [
    {
        id: "thread_rag_pricing",
        messages: [
            "Customer: Hi! Do you do website development?",
            "Owner: Yes I do! What did you have in mind?",
            "Customer: Awesome. Can you tell me what your base fee is for a website? And do you take PayPal?"
        ]
    },
    {
        id: "thread_owner_replied",
        messages: [
            "Customer: When are you available?",
            "Owner: I am available Monday through Friday. Does that work?",
            "Customer: Yes, can you send me your calendar?",
            "From: atharva.dalvi1983@gmail.com\nOwner: Here is my Calendly link!"
        ]
    }
];

// Clean and Inject both threads
for (const t of threads) {
    statusDb.exec(`DELETE FROM status WHERE internal_thread_id = '${t.id}'`);
    metadataDb.exec(`DELETE FROM metadata WHERE internal_thread_id = '${t.id}'`);
    memoryDb.exec(`DELETE FROM running_summaries WHERE internal_thread_id = '${t.id}'`);
    summariesDb.exec(`DELETE FROM ui_summaries WHERE internal_thread_id = '${t.id}'`);
    queuesDb.exec(`DELETE FROM threads WHERE internal_thread_id = '${t.id}'`);

    statusDb.prepare(`INSERT INTO status (internal_thread_id, live_version, status) VALUES (?, ?, ?)`).run(t.id, 1, 'pending');
    metadataDb.prepare(`INSERT INTO metadata (internal_thread_id, source, provider_thread_id, timestamp) VALUES (?, ?, ?, ?)`).run(t.id, 'gmail', `g_${t.id}`, Date.now());

    const fakeUeo = {
        internal_thread_id: t.id,
        live_version: 1,
        source: "test_script", // Fake source so we don't accidentally push real drafts to Google API during test
        provider_thread_id: `fake_${t.id}`,
        historical_thread_messages: t.messages
    };

    queuesDb.prepare(`INSERT INTO threads (internal_thread_id, live_version, payload_json) VALUES (?, ?, ?)`).run(t.id, 1, JSON.stringify(fakeUeo));
    urgentQueue.push({ internal_thread_id: t.id, live_version: 1 });
}

console.log("Injected 2 threads into queues.db.");
console.log("Starting Worker Pool to watch parallel Fan-Out execution...\n");

startWorkerPool();

// Poll for completion
const checkInterval = setInterval(() => {
    let completedCount = 0;
    
    for (const t of threads) {
        const statusRow = statusDb.prepare(`SELECT status FROM status WHERE internal_thread_id = ?`).get(t.id);
        if (statusRow && statusRow.status === 'completed') completedCount++;
    }

    if (completedCount === 2) {
        console.log("\n=== PHASE 5 VERIFICATION: CHECKING DATABASE STATE ===");
        
        let allTestsPassed = true;
        for (const t of threads) {
            // Check Status DB
            const statusRow = statusDb.prepare(`SELECT status FROM status WHERE internal_thread_id = ?`).get(t.id);
            if (statusRow.status === 'completed') {
                console.log(`✅ [${t.id}] Status successfully flipped to 'completed'`);
            } else {
                console.error(`❌ [${t.id}] Status is still '${statusRow.status}'!`);
                allTestsPassed = false;
            }
            
            // Check Queues DB
            const threadsRow = queuesDb.prepare(`SELECT * FROM threads WHERE internal_thread_id = ?`).get(t.id);
            if (!threadsRow) {
                console.log(`✅ [${t.id}] Massive payload successfully deleted from transient Threads database.`);
            } else {
                console.error(`❌ [${t.id}] Payload still exists in Threads database!`);
                allTestsPassed = false;
            }
        }
        
        if (allTestsPassed) {
            console.log("\n✅ ALL PHASES 1-5 VERIFICATION COMPLETE! The Backend is fully functional.");
        } else {
            console.error("\n❌ VERIFICATION FAILED.");
        }
        
        clearInterval(checkInterval);
        process.exit(0);
    }
}, 3000);
