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
const summariesDb = new Database(path.join(dbDir, 'summaries.db')); // UI Summaries DB
const queuesDb = new Database(path.join(dbDir, 'queues.db')); // Transient DB for heavy UEO payloads
const memoryDb = new Database(path.join(dbDir, 'memory.db')); // Running Summary Dictionary for AI

// Enable WAL mode for concurrency and performance
[metadataDb, statusDb, summariesDb, queuesDb, memoryDb].forEach(db => {
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
        is_unread INTEGER NOT NULL DEFAULT 1,
        native_draft_id TEXT,
        is_trash INTEGER NOT NULL DEFAULT 0,
        is_sent INTEGER NOT NULL DEFAULT 0,
        is_starred INTEGER NOT NULL DEFAULT 0,
        is_spam INTEGER NOT NULL DEFAULT 0,
        is_draft INTEGER NOT NULL DEFAULT 0,
        is_inbox INTEGER NOT NULL DEFAULT 0
    )
`);

// Initialize Sync State Table (for Case 1B and Case 3 delta catch-ups)
metadataDb.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
        provider TEXT PRIMARY KEY,
        latest_token TEXT NOT NULL
    )
`);

// Initialize Threads Table in queuesDb (Transient heavy storage)
queuesDb.exec(`
    CREATE TABLE IF NOT EXISTS threads (
        internal_thread_id TEXT NOT NULL,
        live_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (internal_thread_id, live_version)
    )
`);

// Initialize UI Summaries Table (The 1-sentence frontend summary)
summariesDb.exec(`
    CREATE TABLE IF NOT EXISTS ui_summaries (
        internal_thread_id TEXT PRIMARY KEY,
        ui_summary TEXT NOT NULL
    )
`);

// Initialize Memory Node Table (The Running Summary Dictionary)
memoryDb.exec(`
    CREATE TABLE IF NOT EXISTS running_summaries (
        internal_thread_id TEXT PRIMARY KEY,
        summarized_count INTEGER NOT NULL DEFAULT 0,
        running_summary TEXT
    )
`);

module.exports = {
    metadataDb,
    statusDb,
    summariesDb,
    queuesDb,
    memoryDb
};
