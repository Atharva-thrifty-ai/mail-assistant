require('dotenv').config();
const express = require('express');
const webhookRoutes = require('./routes');
const { metadataDb, statusDb } = require('../config/database');
const { performGmailFullSync, performGmailDeltaSync } = require('./adapter');
const { syncThreadPayload } = require('./dbSync');
const { backgroundQueue } = require('./fetchQueue');
const { startWorkerPool } = require('./worker');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Expose webhook routes (Still here for Outlook later)
app.use('/', webhookRoutes);

function processAndEnqueueResults(results) {
    if (!results || results.length === 0) return;
    
    // 1. Sort chronologically DESCENDING (Newest first) so the worker processes the most recent emails instantly
    results.sort((a, b) => b.timestamp - a.timestamp);
    
    for (const ueo of results) {
        // 2. Save massive payload to transient DB
        syncThreadPayload(ueo);
        
        // 3. Push lightweight packet to pure FIFO memory queue
        // DO NOT deduplicate the array! If a thread gets updated, push the new version into the queue.
        // The worker will naturally discard the older version when it pops it and checks status.db.
        backgroundQueue.push({
            internal_thread_id: ueo.internal_thread_id,
            live_version: ueo.live_version
        });
        
        console.log(`[QUEUE] Enqueued ${ueo.internal_thread_id} to Background Queue (v${ueo.live_version}). Queue length: ${backgroundQueue.length}`);
    }
}

async function startIngestionEngine() {
    console.log("=== INGESTION ENGINE STARTING ===");
    
    // Boot Recovery: Recover any pending tasks that were orphaned due to a server crash or stop
    console.log("[BOOT] Checking for stuck pending tasks in status.db...");
    const pendingTasks = statusDb.prepare("SELECT internal_thread_id, live_version FROM status WHERE status = 'pending'").all();
    if (pendingTasks.length > 0) {
        console.log(`[BOOT] Found ${pendingTasks.length} pending tasks. Pushing them back into the worker queue...`);
        for (const task of pendingTasks) {
            backgroundQueue.push({
                internal_thread_id: task.internal_thread_id,
                live_version: task.live_version
            });
        }
    } else {
        console.log("[BOOT] No stuck tasks found. Queue is clean.");
    }
    
    // Check Case 1A: Empty Database
    const countRow = metadataDb.prepare("SELECT COUNT(*) as count FROM metadata WHERE source = 'gmail'").get();
    
    if (countRow.count === 0) {
        console.log("[BOOT] Database is empty. Initiating Case 1A: Full Synchronization (Past 10 days)...");
        const results = await performGmailFullSync(10);
        processAndEnqueueResults(results);
    } else {
        console.log(`[BOOT] Database has ${countRow.count} emails. Initiating Case 1B: Delta Catch-Up...`);
        const results = await performGmailDeltaSync();
        processAndEnqueueResults(results);
    }
    
    // Start Case 3: Delta CRON
    console.log("[CRON] Starting Delta Polling Loop (15s interval)...");
    setInterval(async () => {
        try {
            const results = await performGmailDeltaSync();
            processAndEnqueueResults(results);
        } catch (e) {
            console.error("[CRON ERROR]", e.message);
        }
    }, 15000);
}

app.listen(port, async () => {
    console.log(`[SERVER] Node running on port ${port}`);
    startWorkerPool();
    await startIngestionEngine();
});
