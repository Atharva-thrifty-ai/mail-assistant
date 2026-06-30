const express = require('express');
const router = express.Router();
const logger = require('../../src/utils/logger');
const { metadataDb, statusDb } = require('../../src/config/database');

router.get('/', (req, res) => {
    try {
        const query = req.query.q || '';
        if (!query.trim()) {
            return res.json([]);
        }

        const searchTerm = `%${query}%`;
        
        const stmt = metadataDb.prepare(`
            SELECT internal_thread_id, sender_name, sender_email, subject, timestamp as date, snippet, ai_categories, is_draft, is_starred, is_trash
            FROM metadata
            WHERE (sender_name LIKE ? OR sender_email LIKE ? OR subject LIKE ? OR snippet LIKE ?)
              AND is_trash = 0
            ORDER BY timestamp DESC
            LIMIT 50
        `);
        const threads = stmt.all(searchTerm, searchTerm, searchTerm, searchTerm);

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
        logger.error('[BFF API ERROR] Failed to perform search:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
