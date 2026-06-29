const { forwardDraftStream, forwardSend } = require('../controllers/composeController');
const { starThread, unstarThread, trashThread, untrashThread } = require('../controllers/actionController');
const express = require('express');
const { sendDraft } = require('../services/senderService');
const router = express.Router();
const { metadataDb, statusDb } = require('../../src/config/database');
const { extractThreadHistory } = require('../services/extractorService');
const { getSummary } = require('../services/summarizerService');
const { getDraftStream, redraftStream } = require('../services/drafterService');

// 1. FOLDER METADATA ROUTE
router.get('/', (req, res) => {
    try {
        const stmt = metadataDb.prepare(`
            SELECT internal_thread_id, sender_name, sender_email, subject, timestamp as date, snippet, ai_categories, is_draft, is_starred, is_trash
            FROM metadata
            WHERE ai_categories LIKE '%Attention%' AND is_trash = 0
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

// 4. DRAFT ROUTE (SSE Stream)
router.get('/:thread_id/draft', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
        const stream = getDraftStream(req.params.thread_id);
        for await (const token of stream) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
    } catch (error) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// 5. REDRAFT ROUTE (SSE Stream)
router.post('/:thread_id/redraft', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const { user_comments, earlier_draft } = req.body;

    try {
        const stream = redraftStream(req.params.thread_id, user_comments, earlier_draft);
        for await (const token of stream) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
        res.write(`data: [DONE]\n\n`);
        res.end();
    } catch (error) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// SEND EMAIL ROUTE
router.post('/:thread_id/send', async (req, res) => {
    try {
        const { draftText } = req.body;
        const thread_id = req.params.thread_id;
        const result = await sendDraft(thread_id, draftText);
        res.json(result);
    } catch (error) {
        logger.error(`[BFF API ERROR] Failed to send email for thread ${req.params.thread_id}:`, error.message);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
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
