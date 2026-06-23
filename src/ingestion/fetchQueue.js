const { processGmailNotification, processGraphNotification } = require('./adapter');

// fetchQueue handles the memory array. In a true production app, this would be SQLite-backed.
const fetchQueue = [];

// The background worker pool queue (for LLM tasks)
const backgroundQueue = [];

// Deduplication cache to drop duplicate instant webhook echo pings
const processedWebhookIds = new Set();

// Clean up cache every 10 mins
setInterval(() => {
    processedWebhookIds.clear();
}, 10 * 60 * 1000);

async function processFetchQueue() {
    if (fetchQueue.length === 0) {
        setTimeout(processFetchQueue, 1000);
        return;
    }
    
    const task = fetchQueue.shift();
    
    try {
        let ueoResults = [];
        if (task.provider === 'gmail') {
            const results = await processGmailNotification(task.id);
            if (results) ueoResults = ueoResults.concat(results);
        } else if (task.provider === 'outlook') {
            const results = await processGraphNotification(task.id);
            if (results) ueoResults = ueoResults.concat(results);
        }
        
        // Push standardized UEOs to the background queue for LLM workers
        ueoResults.forEach(ueo => {
            backgroundQueue.push(ueo);
            console.log(`[QUEUE] Pushed UEO for ${ueo.internal_thread_id} to background queue (Live Version: ${ueo.live_version})`);
        });
        
    } catch (err) {
        console.error(`[ERROR] Processing webhook task ${task.id}:`, err.message);
    }
    
    // Process next item
    setTimeout(processFetchQueue, 0);
}

function enqueueWebhook(provider, id) {
    if (processedWebhookIds.has(id)) {
        console.log(`[DEDUPE] Ignored duplicate webhook ID: ${id}`);
        return;
    }
    processedWebhookIds.add(id);
    fetchQueue.push({ provider, id });
}

// Kick off the background loop
processFetchQueue();

module.exports = {
    enqueueWebhook,
    backgroundQueue
};
