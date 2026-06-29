const { forwardDraftStream, forwardSend } = require('../controllers/composeController');
const { starThread, unstarThread, trashThread, untrashThread } = require('../controllers/actionController');
const express = require('express');
const router = express.Router();
const { metadataDb, statusDb } = require('../../src/config/database');
const { extractThreadHistory } = require('../services/extractorService');
const { getSummary } = require('../services/summarizerService');

// 1. FOLDER METADATA ROUTE
router.get('/', (req, res) => {
    try {
        const stmt = metadataDb.prepare(`
            SELECT internal_thread_id, sender_name, sender_email, subject, timestamp as date, snippet, ai_categories, is_draft, is_starred, is_trash
            FROM metadata
            WHERE is_sent = 1 AND is_trash = 0
            ORDER BY timestamp DESC
        `);
        const threads = stmt.all();

        const enrichedThreads = threads.map(thread => {
            const statusRow = statusDb.prepare(`
                SELECT status 
                FROM status 
                WHERE internal_thread_id = ?
            `).get(thread.internal_thread_id);

            return {
                ...thread,
                status: statusRow ? statusRow.status : 'completed'
            };
        });

        res.json(enrichedThreads);
    } catch (error) {
        console.error('[BFF API ERROR] Failed to fetch folder:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 2. EXTRACTOR ROUTE
router.get('/:thread_id/extractor', async (req, res) => {
    try {
        const thread_id = req.params.thread_id;
        const extractorData = await extractThreadHistory(thread_id);
        res.json(extractorData);
    } catch (error) {
        console.error('[BFF API ERROR] Extractor failed:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 3. SUMMARIZER ROUTE
router.get('/:thread_id/summary', (req, res) => {
    try {
        const thread_id = req.params.thread_id;
        const summaryData = getSummary(thread_id);
        res.json(summaryData);
    } catch (error) {
        console.error('[BFF API ERROR] Summarizer failed:', error.message);
        res.status(500).json({ error: error.message });
    }
});


// Action Routes
router.post('/:thread_id/star', starThread);
router.post('/:thread_id/unstar', unstarThread);
router.post('/:thread_id/trash', trashThread);
router.post('/:thread_id/untrash', untrashThread);


router.post('/:thread_id/forward/draft', forwardDraftStream);
router.post('/:thread_id/forward/send', forwardSend);
module.exports = router;
