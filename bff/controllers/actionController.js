const { modifyGmailThreadLabels, trashGmailThread, untrashGmailThread } = require('../../src/utils/gmailApi');
const { metadataDb } = require('../../src/config/database');
const logger = require('../../src/utils/logger');

async function starThread(req, res) {
    const { thread_id } = req.params;
    try {
        // Find provider_thread_id
        const row = metadataDb.prepare("SELECT provider_thread_id FROM metadata WHERE internal_thread_id = ?").get(thread_id);
        if (!row) {
            return res.status(404).json({ error: 'Thread not found' });
        }
        
        // Gmail API
        const response = await modifyGmailThreadLabels(row.provider_thread_id, ['STARRED'], []);
        if (response) {
            // DB Update
            metadataDb.prepare("UPDATE metadata SET is_starred = 1 WHERE internal_thread_id = ?").run(thread_id);
            res.json({ success: true });
        } else {
            throw new Error("Failed to modify Gmail labels");
        }
    } catch (error) {
        logger.error(`[BFF] Failed to star thread ${thread_id}:`, error.message);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}

async function unstarThread(req, res) {
    const { thread_id } = req.params;
    try {
        const row = metadataDb.prepare("SELECT provider_thread_id FROM metadata WHERE internal_thread_id = ?").get(thread_id);
        if (!row) {
            return res.status(404).json({ error: 'Thread not found' });
        }
        
        const response = await modifyGmailThreadLabels(row.provider_thread_id, [], ['STARRED']);
        if (response) {
            metadataDb.prepare("UPDATE metadata SET is_starred = 0 WHERE internal_thread_id = ?").run(thread_id);
            res.json({ success: true });
        } else {
            throw new Error("Failed to modify Gmail labels");
        }
    } catch (error) {
        logger.error(`[BFF] Failed to unstar thread ${thread_id}:`, error.message);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}

async function trashThread(req, res) {
    const { thread_id } = req.params;
    try {
        const row = metadataDb.prepare("SELECT provider_thread_id FROM metadata WHERE internal_thread_id = ?").get(thread_id);
        if (!row) {
            return res.status(404).json({ error: 'Thread not found' });
        }
        
        const response = await trashGmailThread(row.provider_thread_id);
        if (response) {
            metadataDb.prepare("UPDATE metadata SET is_trash = 1 WHERE internal_thread_id = ?").run(thread_id);
            res.json({ success: true });
        } else {
            throw new Error("Failed to trash Gmail thread");
        }
    } catch (error) {
        logger.error(`[BFF] Failed to trash thread ${thread_id}:`, error.message);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}

async function untrashThread(req, res) {
    const { thread_id } = req.params;
    try {
        const row = metadataDb.prepare("SELECT provider_thread_id FROM metadata WHERE internal_thread_id = ?").get(thread_id);
        if (!row) {
            return res.status(404).json({ error: 'Thread not found' });
        }
        
        const response = await untrashGmailThread(row.provider_thread_id);
        if (response) {
            metadataDb.prepare("UPDATE metadata SET is_trash = 0 WHERE internal_thread_id = ?").run(thread_id);
            res.json({ success: true });
        } else {
            throw new Error("Failed to untrash Gmail thread");
        }
    } catch (error) {
        logger.error(`[BFF] Failed to untrash thread ${thread_id}:`, error.message);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}

module.exports = { starThread, unstarThread, trashThread, untrashThread };
