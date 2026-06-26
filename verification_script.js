// verification_script.js (Phase 3: BFF Drafter Generator Test)
require('dotenv').config();
const { getDraftStream } = require('./bff/services/drafterService');
const { statusDb, metadataDb } = require('./src/config/database');

console.log("=== PHASE 3 VERIFICATION: BFF DRAFTER SSE STREAM ===\n");

const testId = "fake_draft_test_123";

// 1. Clean up past runs
statusDb.exec(`DELETE FROM status WHERE internal_thread_id = '${testId}'`);
metadataDb.exec(`DELETE FROM metadata WHERE internal_thread_id = '${testId}'`);

// 2. Setup initial 'pending' state
statusDb.prepare(`INSERT INTO status (internal_thread_id, live_version, status) VALUES (?, ?, ?)`).run(testId, 1, 'pending');
metadataDb.prepare(`
    INSERT INTO metadata (internal_thread_id, source, provider_thread_id, timestamp, is_draft) 
    VALUES (?, ?, ?, ?, ?)
`).run(testId, 'gmail', 'fake_provider_123', Date.now(), 0);

console.log(`[TEST A - Polling Stream] Thread is PENDING. Establishing SSE Connection...`);

async function runTest() {
    // Start the generator
    const draftStream = getDraftStream(testId, ["Recent message from user"]);
    
    // Simulate the Pure Backend finishing its work after 1.5 seconds
    setTimeout(() => {
        console.log(`\n\n[BACKGROUND WORKER] Finishing task... flipping status to completed!`);
        statusDb.prepare(`UPDATE status SET status = 'completed' WHERE internal_thread_id = ?`).run(testId);
        metadataDb.prepare(`UPDATE metadata SET is_draft = 1, native_draft_id = 'fake_draft_id_999' WHERE internal_thread_id = ?`).run(testId);
    }, 1500);

    // Read from the stream just like an Express Server would for SSE
    console.log("BFF Yielding Tokens:");
    for await (const chunk of draftStream) {
        process.stdout.write(`>>> [STREAM] ${chunk}\n`);
    }
    
    console.log(`\n\n✅ TEST COMPLETE: Notice how it yielded the [SSE_WAITING] signal to hold the connection, then instantly dumped the final draft the millisecond the background worker finished!`);
    console.log("\n✅ Phase 3 complete! Run this script with `node verification_script.js` anytime.");
}

runTest();
