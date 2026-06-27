const { statusDb, metadataDb, queuesDb } = require('../config/database');

function upsertStatusLock(internalThreadId, isDraftPing = false) {
    if (isDraftPing) {
        // If it's a draft ping, we just increment the live_version to invalidate old tasks,
        // but we do NOT reset the status to pending. If it doesn't exist, assume completed.
        const stmt = statusDb.prepare(`
            INSERT INTO status (internal_thread_id, status, live_version)
            VALUES (?, 'completed', 1)
            ON CONFLICT(internal_thread_id) DO UPDATE SET
                live_version = live_version + 1
            RETURNING live_version
        `);
        const result = stmt.get(internalThreadId);
        return result.live_version;
    } else {
        const stmt = statusDb.prepare(`
            INSERT INTO status (internal_thread_id, status, live_version)
            VALUES (?, 'pending', 1)
            ON CONFLICT(internal_thread_id) DO UPDATE SET
                live_version = live_version + 1,
                status = 'pending'
            RETURNING live_version
        `);
        const result = stmt.get(internalThreadId);
        return result.live_version;
    }
}

function syncUiMetadata(cleanedEmail) {
    const stmt = metadataDb.prepare(`
        INSERT INTO metadata (
            internal_thread_id, source, provider_thread_id, sender_name, sender_email,
            subject, snippet, timestamp, ai_categories, has_attachments, is_unread,
            is_trash, is_sent, is_starred, is_spam, is_draft, is_inbox
        ) VALUES (
            @internal_thread_id, @source, @provider_thread_id, @sender_name, @sender_email,
            @subject, @snippet, @timestamp, @ai_categories, @has_attachments, @is_unread,
            @is_trash, @is_sent, @is_starred, @is_spam, @is_draft, @is_inbox
        )
        ON CONFLICT(internal_thread_id) DO UPDATE SET
            sender_name = excluded.sender_name,
            sender_email = excluded.sender_email,
            subject = excluded.subject,
            snippet = excluded.snippet,
            timestamp = excluded.timestamp,
            has_attachments = excluded.has_attachments,
            is_unread = excluded.is_unread,
            is_trash = excluded.is_trash,
            is_sent = excluded.is_sent,
            is_starred = excluded.is_starred,
            is_spam = excluded.is_spam,
            is_draft = excluded.is_draft,
            is_inbox = excluded.is_inbox
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
        is_unread: cleanedEmail.is_unread ? 1 : 0,
        is_trash: cleanedEmail.is_trash ? 1 : 0,
        is_sent: cleanedEmail.is_sent ? 1 : 0,
        is_starred: cleanedEmail.is_starred ? 1 : 0,
        is_spam: cleanedEmail.is_spam ? 1 : 0,
        is_draft: cleanedEmail.is_draft ? 1 : 0,
        is_inbox: cleanedEmail.is_inbox ? 1 : 0
    });
}

function syncThreadPayload(ueo) {
    const stmt = queuesDb.prepare(`
        INSERT INTO threads (internal_thread_id, live_version, payload_json)
        VALUES (?, ?, ?)
        ON CONFLICT(internal_thread_id, live_version) DO UPDATE SET
            payload_json = excluded.payload_json
    `);
    stmt.run(ueo.internal_thread_id, ueo.live_version, JSON.stringify(ueo));
}

function deleteThreadPayload(internalThreadId, liveVersion) {
    const stmt = queuesDb.prepare(`
        DELETE FROM threads 
        WHERE internal_thread_id = ? AND live_version = ?
    `);
    stmt.run(internalThreadId, liveVersion);
}

module.exports = {
    upsertStatusLock,
    syncUiMetadata,
    syncThreadPayload,
    deleteThreadPayload
};
