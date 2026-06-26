const express = require('express');
const router = express.Router();
const { metadataDb, statusDb } = require('../../src/config/database');
const { extractThreadHistory } = require('../services/extractorService');
const { getSummary } = require('../services/summarizerService');

// 1. FOLDER METADATA ROUTE
router.get('/', (req, res) => {
    try {
        const stmt = metadataDb.prepare(`
            SELECT internal_thread_id, sender_name, sender_email, subject, timestamp as date, snippet, ai_categories, is_draft
            FROM metadata
            WHERE is_draft = 1
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

// We are leaving out the extractor and summarizer endpoints for drafts
// because the drafting logic will be implemented in Phase 5.

module.exports = router;
