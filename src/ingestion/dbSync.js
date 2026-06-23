const { statusDb, metadataDb } = require('../config/database');

function upsertStatusLock(internalThreadId) {
    const stmt = statusDb.prepare(`
        INSERT INTO status (internal_thread_id, status, live_version)
        VALUES (?, 'pending', 1)
        ON CONFLICT(internal_thread_id) DO UPDATE SET
            live_version = live_version + 1,
            status = 'pending'
        RETURNING live_version
    `);
    
    // Using run().lastInsertRowid or .get() with RETURNING clause ensures atomic access
    const result = stmt.get(internalThreadId);
    return result.live_version;
}

function syncUiMetadata(cleanedEmail) {
    const stmt = metadataDb.prepare(`
        INSERT INTO metadata (
            internal_thread_id, source, provider_thread_id, sender_name, sender_email,
            subject, snippet, timestamp, ai_categories, has_attachments, is_unread
        ) VALUES (
            @internal_thread_id, @source, @provider_thread_id, @sender_name, @sender_email,
            @subject, @snippet, @timestamp, @ai_categories, @has_attachments, @is_unread
        )
        ON CONFLICT(internal_thread_id) DO UPDATE SET
            sender_name = excluded.sender_name,
            sender_email = excluded.sender_email,
            subject = excluded.subject,
            snippet = excluded.snippet,
            timestamp = excluded.timestamp,
            has_attachments = excluded.has_attachments,
            is_unread = excluded.is_unread
    `);
    
    stmt.run({
        internal_thread_id: cleanedEmail.internal_thread_id,
        source: cleanedEmail.source,
        provider_thread_id: cleanedEmail.provider_thread_id,
        sender_name: cleanedEmail.sender_name || '',
        sender_email: cleanedEmail.sender_email || '',
        subject: cleanedEmail.subject || '',
        snippet: cleanedEmail.snippet || '',
        timestamp: cleanedEmail.timestamp || Date.now(),
        ai_categories: null, // Initial is always null
        has_attachments: cleanedEmail.has_attachments ? 1 : 0,
        is_unread: cleanedEmail.is_unread ? 1 : 0
    });
}

module.exports = {
    upsertStatusLock,
    syncUiMetadata
};
