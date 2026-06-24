const { backgroundQueue, urgentQueue } = require('./fetchQueue');
const { statusDb, queuesDb } = require('../config/database');
const { deleteThreadPayload } = require('./dbSync');
const { runMemoryNode } = require('../nodes/memoryNode');

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
            
            if (!payloadRow) {
                console.error(`[WORKER ${workerId}] FATAL: Payload missing in DB for ${internal_thread_id} v${live_version}`);
                continue;
            }
            
            // 2. Parse back into a fast JavaScript object
            let ueo = JSON.parse(payloadRow.payload_json);
            
            // 3. Execute Phase 3: The Memory Node
            ueo = await runMemoryNode(ueo);
            
            // Note: In Phase 4, we will pass 'ueo' to the parallel Fan-Out nodes here.
            console.log(`[WORKER ${workerId}] Successfully completed Phase 3 for ${internal_thread_id}.`);
        } catch (e) {
            console.error(`[WORKER ${workerId}] LLM Error on ${internal_thread_id}:`, e);
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
