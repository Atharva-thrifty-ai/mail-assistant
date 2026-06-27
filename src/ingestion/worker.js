const { backgroundQueue, urgentQueue } = require('./fetchQueue');
const { statusDb, queuesDb, metadataDb } = require('../config/database');
const { deleteThreadPayload } = require('./dbSync');
const { runMemoryNode } = require('../nodes/memoryNode');
const { runClassifierNode } = require('../nodes/classifierNode');
const { runDrafterNode } = require('../nodes/drafterNode');
const { rebuildPayloadForWorker } = require('./adapter');

async function processQueueTask(workerId) {
    console.log(`[WORKER ${workerId}] Started.`);
    
    while (true) {
        // Priority 1: Check Urgent Queue first
        let task = urgentQueue.shift();
        
        // Priority 2: Check Background Queue if Urgent is empty
        if (!task) {
            task = backgroundQueue.shift();
        }
        
        // If both queues are empty, idle for 100ms to save CPU without losing speed
        if (!task) {
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
        }
        
        const { internal_thread_id, live_version } = task;
        
        // === THE STATUS LOCK & DISCARD MECHANISM ===
        const row = statusDb.prepare("SELECT live_version, status FROM status WHERE internal_thread_id = ?").get(internal_thread_id);
        
        if (!row) {
            console.warn(`[WORKER ${workerId}] DB record missing for ${internal_thread_id}. Discarding task.`);
            continue;
        }
        
        if (row.status === 'completed' || live_version < row.live_version) {
            console.log(`[WORKER ${workerId}] DISCARDED stale task ${internal_thread_id} (v${live_version} < DB v${row.live_version} or completed)`);
            // Instantly destroy the massive stale payload to save disk space
            deleteThreadPayload(internal_thread_id, live_version);
            continue;
        }
        
        // === THE LLM EXECUTION ===
        console.log(`[WORKER ${workerId}] Fetching payload for ${internal_thread_id} (v${live_version}) from queues.db...`);
        
        try {
            // 1. Lazy-load the massive payload from the transient disk
            const payloadRow = queuesDb.prepare("SELECT payload_json FROM threads WHERE internal_thread_id = ? AND live_version = ?").get(internal_thread_id, live_version);
            
            let ueo;
            if (!payloadRow) {
                console.warn(`[WORKER ${workerId}] Payload missing in DB for ${internal_thread_id} v${live_version}. Attempting self-healing rebuild...`);
                try {
                    ueo = await rebuildPayloadForWorker(internal_thread_id, live_version);
                    console.log(`[WORKER ${workerId}] Successfully rebuilt payload from provider API.`);
                } catch (rebuildErr) {
                    console.error(`[WORKER ${workerId}] FATAL: Rebuild failed:`, rebuildErr);
                    // Force the status to failed to prevent eternal pending
                    statusDb.prepare(`UPDATE status SET status = 'failed' WHERE internal_thread_id = ? AND live_version = ?`)
                        .run(internal_thread_id, live_version);
                    continue;
                }
            } else {
                // 2. Parse back into a fast JavaScript object
                ueo = JSON.parse(payloadRow.payload_json);
            }
            
            // 3. Execute Phase 3: The Memory Node
            ueo = await runMemoryNode(ueo);
            
            // 4. Draft Decision Check
            let shouldDraft = true;
            let ownerEmail = process.env.OWNER_EMAIL ? process.env.OWNER_EMAIL.replace(/['"]/g, '').trim() : null;
            
            if (ueo.has_draft) {
                console.log(`[WORKER ${workerId}] Skipping Drafter Node: A draft already exists for this thread.`);
                shouldDraft = false;
            } else if (ownerEmail && ueo.sender_email === ownerEmail) {
                console.log(`[WORKER ${workerId}] Skipping Drafter Node: System owner (${ownerEmail}) already replied.`);
                shouldDraft = false;
            } else {
                const automatedRegex = /noreply|no-reply|updates|notifications|newsletter|mailer|do-not-reply|support/i;
                if (automatedRegex.test(ueo.sender_email)) {
                    console.log(`[WORKER ${workerId}] Skipping Drafter Node: Sender (${ueo.sender_email}) appears to be automated/promotional.`);
                    shouldDraft = false;
                }
            }

            // 5. Execute Phase 4 (Parallel Fan-Out)
            await Promise.all([
                runClassifierNode(ueo),
                shouldDraft ? runDrafterNode(ueo) : Promise.resolve(ueo)
            ]);
            
            console.log(`\n[WORKER ${workerId}] === FINAL UEO STATE FOR ${internal_thread_id} ===`);
            console.log(JSON.stringify(ueo, null, 2));
            console.log(`====================================================\n`);
            
            // 6. Phase 5: Resolution & Status Sync (Fan-In)
            if (ueo.native_draft_id) {
                metadataDb.prepare(`UPDATE metadata SET native_draft_id = ?, is_draft = 1 WHERE internal_thread_id = ?`)
                    .run(ueo.native_draft_id, internal_thread_id);
                console.log(`[WORKER ${workerId}] Persisted native_draft_id: ${ueo.native_draft_id}`);
            }

            if (ueo.is_spam) {
                metadataDb.prepare(`UPDATE metadata SET ai_categories = ? WHERE internal_thread_id = ?`)
                    .run(JSON.stringify(["Spam"]), internal_thread_id);
                console.log(`[WORKER ${workerId}] Phase 5: Explicitly locked ai_categories to ["Spam"] for native spam.`);
            }

            statusDb.prepare(`UPDATE status SET status = 'completed' WHERE internal_thread_id = ? AND live_version = ?`)
                .run(internal_thread_id, live_version);
            
            deleteThreadPayload(internal_thread_id, live_version);
            
            console.log(`[WORKER ${workerId}] Phase 5 Complete: Status flipped to 'completed' and payload instantly destroyed.`);
            console.log(`[WORKER ${workerId}] Successfully completed entire pipeline for ${internal_thread_id}.`);
        } catch (e) {
            console.error(`[WORKER ${workerId}] LLM Error on ${internal_thread_id}:`, e);
            // Explicitly mark as failed and destroy payload to prevent zombie pending states
            statusDb.prepare(`UPDATE status SET status = 'failed' WHERE internal_thread_id = ? AND live_version = ?`)
                .run(internal_thread_id, live_version);
            deleteThreadPayload(internal_thread_id, live_version);
        }
    }
}

function startWorkerPool() {
    console.log("=== STARTING WORKER POOL ===");
    // Spawn exactly 3 parallel infinite loops
    Promise.all([
        processQueueTask(1),
        processQueueTask(2),
        processQueueTask(3)
    ]).catch(err => {
        console.error("Worker Pool crashed:", err);
    });
}

module.exports = {
    startWorkerPool
};
