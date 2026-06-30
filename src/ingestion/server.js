require('dotenv').config();
const logger = require('../utils/logger');
const express = require('express');
const webhookRoutes = require('./routes');
const { metadataDb, statusDb } = require('../config/database');
const { performGmailFullSync, performGmailDeltaSync } = require('./adapter');
const { syncThreadPayload } = require('./dbSync');
const { backgroundQueue } = require('./fetchQueue');
const { startWorkerPool } = require('./worker');

const app = express();
const port = process.env.INGESTION_PORT || 3000;

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
        
        logger.info(`[QUEUE] Enqueued ${ueo.internal_thread_id} to Background Queue (v${ueo.live_version}). Queue length: ${backgroundQueue.length}`);
    }
}

async function startIngestionEngine() {
    logger.info("=== INGESTION ENGINE STARTING ===");
    
    // Boot Recovery: Recover any pending tasks that were orphaned due to a server crash or stop
    logger.info("[BOOT] Checking for stuck pending tasks in status.db...");
    const pendingTasks = statusDb.prepare("SELECT internal_thread_id, live_version FROM status WHERE status = 'pending'").all();
    if (pendingTasks.length > 0) {
        logger.info(`[BOOT] Found ${pendingTasks.length} pending tasks. Pushing them back into the worker queue...`);
        for (const task of pendingTasks) {
            backgroundQueue.push({
                internal_thread_id: task.internal_thread_id,
                live_version: task.live_version
            });
        }
    } else {
        logger.info("[BOOT] No stuck tasks found. Queue is clean.");
    }
    
    // Check Case 1A: Empty Database
    const countRow = metadataDb.prepare("SELECT COUNT(*) as count FROM metadata WHERE source = 'gmail'").get();
    
    if (countRow.count === 0) {
        logger.info("[BOOT] Database is empty. Initiating Case 1A: Full Synchronization (Past 10 days)...");
        const results = await performGmailFullSync(20);
        processAndEnqueueResults(results);
    } else {
        logger.info(`[BOOT] Database has ${countRow.count} emails. Initiating Case 1B: Delta Catch-Up...`);
        const results = await performGmailDeltaSync();
        processAndEnqueueResults(results);
    }
    
    // Start Case 3: Delta CRON
    logger.info("[CRON] Starting Delta Polling Loop (15s interval)...");
    setInterval(async () => {
        try {
            const results = await performGmailDeltaSync();
            processAndEnqueueResults(results);
        } catch (e) {
            logger.error("[CRON ERROR]", e.message);
        }
    }, 15000);
}

app.listen(port, async () => {
    logger.info(`[SERVER] Node running on port ${port}`);
    startWorkerPool();
    await startIngestionEngine();
});
