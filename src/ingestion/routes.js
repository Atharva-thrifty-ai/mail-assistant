const express = require('express');
const { enqueueWebhook, urgentQueue } = require('./fetchQueue');
const router = express.Router();

// The Internal Bridge API (For the BFF Queue Jump)
router.post('/api/internal/urgent', (req, res) => {
    const { internal_thread_id, live_version } = req.body;
    
    if (!internal_thread_id || !live_version) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    
    // Push directly to the front-of-line Urgent Queue
    urgentQueue.push({ internal_thread_id, live_version });
    console.log(`[URGENT] BFF Triggered Queue Jump for ${internal_thread_id} (v${live_version})`);
    
    return res.status(200).json({ success: true, message: "Task injected into Urgent Queue" });
});

router.post('/webhooks/gmail', (req, res) => {
    // 1. Instantly return 200 OK (Fast Path)
    res.status(200).send('OK');
    
    // 2. Decode payload and push to fetchQueue
    try {
        if (!req.body || !req.body.message || !req.body.message.data) return;
        
        const payloadStr = Buffer.from(req.body.message.data, 'base64').toString('utf8');
        const payload = JSON.parse(payloadStr);
        const historyId = payload.historyId;
        
        if (historyId) {
            enqueueWebhook('gmail', historyId);
        }
    } catch (e) {
        console.error('Failed to parse Gmail webhook payload', e);
    }
});

router.post('/webhooks/graph', (req, res) => {
    // Microsoft Graph initial validation handshake
    if (req.query && req.query.validationToken) {
        res.set('Content-Type', 'text/plain');
        return res.status(200).send(req.query.validationToken);
    }
    
    // 1. Instantly return 202 Accepted (Fast Path)
    res.status(202).send('Accepted');
    
    // 2. Extract resource ID and push to fetchQueue
    if (req.body && req.body.value) {
        req.body.value.forEach(notification => {
            if (notification.resourceData && notification.resourceData.id) {
                // MS Graph uses the full resource URL (e.g. Users/xxx/Messages/yyy)
                const resourcePath = notification.resource;
                enqueueWebhook('outlook', resourcePath);
            }
        });
    }
});

module.exports = router;
