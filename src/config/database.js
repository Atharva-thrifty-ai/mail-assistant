const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// We use 3 separate DBs as discussed to avoid file lock contention
const metadataDb = new Database(path.join(dbDir, 'metadata.db'));
const statusDb = new Database(path.join(dbDir, 'status.db'));
const summariesDb = new Database(path.join(dbDir, 'summaries.db')); // Summaries DB included for completeness

// Enable WAL mode for concurrency and performance
[metadataDb, statusDb, summariesDb].forEach(db => {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
});

// Initialize Status Table
statusDb.exec(`
    CREATE TABLE IF NOT EXISTS status (
        internal_thread_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        live_version INTEGER NOT NULL DEFAULT 1,
        last_processed_version INTEGER NOT NULL DEFAULT 0
    )
`);

// Initialize Metadata Table
metadataDb.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
        internal_thread_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        provider_thread_id TEXT NOT NULL,
        sender_name TEXT,
        sender_email TEXT,
        subject TEXT,
        snippet TEXT,
        timestamp INTEGER NOT NULL,
        ai_categories TEXT,
        has_attachments INTEGER NOT NULL DEFAULT 0,
        is_unread INTEGER NOT NULL DEFAULT 1
    )
`);

module.exports = {
    metadataDb,
    statusDb,
    summariesDb
};
