const axios = require('axios');
const { cleanMessageBody, generateInternalThreadId, decodeGmailBody } = require('./preprocessor');
const { upsertStatusLock, syncUiMetadata } = require('./dbSync');
const { metadataDb } = require('../config/database');
const UniversalEmailObject = require('../models/ueo');
const { OAuth2Client } = require('google-auth-library');

// Initialize Google OAuth2 Client for background auto-refresh
const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
);

if (process.env.GMAIL_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });
}

async function fetchGmailThread(threadId) {
    const { token } = await oauth2Client.getAccessToken();
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`;
    const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
}

function saveGmailHistoryId(historyId) {
    if (historyId) {
        metadataDb.prepare(`
            INSERT INTO sync_state (provider, latest_token)
            VALUES ('gmail', ?)
            ON CONFLICT(provider) DO UPDATE SET latest_token = excluded.latest_token
        `).run(historyId.toString());
    }
}

async function processGmailNotification(historyId) {
    const { token } = await oauth2Client.getAccessToken();
    const historyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${historyId}`;
    let historyResponse;
    try {
        historyResponse = await axios.get(historyUrl, {
            headers: { Authorization: `Bearer ${token}` }
        });
    } catch (e) {
        if (e.response && e.response.status === 404) {
            console.error("History expired, trigger Full Sync here.");
            return [];
        }
        throw e;
    }

    const histories = historyResponse.data.history || [];

    if (historyResponse.data.historyId) {
        saveGmailHistoryId(historyResponse.data.historyId);
    }

    const processedThreadIds = new Set();
    const results = [];

    for (const record of histories) {
        if (record.messagesAdded) {
            for (const msgAdded of record.messagesAdded) {
                const threadId = msgAdded.message.threadId;

                // Deduplicate threads within the same history delta
                if (processedThreadIds.has(threadId)) continue;
                processedThreadIds.add(threadId);

                // Fetch full thread to get all messages and history context
                const threadData = await fetchGmailThread(threadId);
                const messages = threadData.messages || [];
                if (messages.length === 0) continue;

                // The last message in the array is the most recent
                const latestMsgRaw = messages[messages.length - 1];
                const rawBody = decodeGmailBody(latestMsgRaw.payload);
                const latestMessageText = cleanMessageBody(rawBody);

                // Find the latest message that isn't a draft to extract accurate metadata
                let latestReceivedMsg = messages.slice().reverse().find(msg => !(msg.labelIds && msg.labelIds.includes('DRAFT')));
                // If all messages are drafts, fall back to the ORIGINAL draft (messages[0]) to get the original Subject and Date
                if (!latestReceivedMsg) latestReceivedMsg = messages[0];
                const receivedRawBody = decodeGmailBody(latestReceivedMsg.payload);
                const receivedMessageText = cleanMessageBody(receivedRawBody);

                // Check if the thread has an existing draft
                const hasDraft = messages.some(msg => msg.labelIds && msg.labelIds.includes('DRAFT'));

                // Extract historical messages
                const historicalMessages = [];
                for (let i = 0; i < messages.length - 1; i++) {
                    const mRaw = decodeGmailBody(messages[i].payload);
                    historicalMessages.push(cleanMessageBody(mRaw));
                }

                // Extract headers from the received message
                const headers = latestReceivedMsg.payload.headers || [];
                const getHeader = (name) => {
                    const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
                    return h ? h.value : '';
                };

                const internalThreadId = generateInternalThreadId('gmail', threadId);

                // Clean and normalize metadata
                const cleanedEmail = {
                    internal_thread_id: internalThreadId,
                    source: 'gmail',
                    provider_thread_id: threadId,
                    sender_name: getHeader('From').split('<')[0].trim(),
                    sender_email: (getHeader('From').match(/<(.+)>/) || [])[1] || getHeader('From'),
                    subject: getHeader('Subject'),
                    snippet: latestReceivedMsg.snippet || receivedMessageText.substring(0, 100),
                    timestamp: parseInt(latestReceivedMsg.internalDate) || Date.now(),
                    has_attachments: !!latestReceivedMsg.payload.parts && latestReceivedMsg.payload.parts.some(p => p.filename),
                    is_unread: messages.some(msg => msg.labelIds && msg.labelIds.includes('UNREAD')),
                    is_trash: messages.some(msg => msg.labelIds && msg.labelIds.includes('TRASH')),
                    is_sent: messages.some(msg => msg.labelIds && msg.labelIds.includes('SENT')),
                    is_starred: messages.some(msg => msg.labelIds && msg.labelIds.includes('STARRED')),
                    is_spam: messages.some(msg => msg.labelIds && msg.labelIds.includes('SPAM')),
                    is_draft: hasDraft,
                    is_inbox: messages.some(msg => msg.labelIds && msg.labelIds.includes('INBOX'))
                };

                // Identify if this ping is purely because a Draft was generated.
                // A Draft ping will have the newest message as a Draft.
                const isDraftPing = latestMsgRaw.labelIds && latestMsgRaw.labelIds.includes('DRAFT');

                // If this is just a draft ping from our worker, we completely ignore it.
                // We do NOT want to bump the live_version, otherwise we will sabotage the worker 
                // trying to mark the current live_version as 'completed'.
                if (isDraftPing) {
                    console.log(`[DELTA SYNC] Completely ignored Draft Ping for ${internalThreadId} to avoid race conditions.`);
                    continue;
                }

                // DB Syncs
                const liveVersion = upsertStatusLock(internalThreadId);
                syncUiMetadata(cleanedEmail);

                // Construct UEO
                const ueo = new UniversalEmailObject({
                    internal_thread_id: internalThreadId,
                    live_version: liveVersion,
                    latest_message: latestMessageText,
                    historical_thread_messages: historicalMessages,
                    source: 'gmail',
                    provider_thread_id: threadId,
                    has_draft: hasDraft,
                    sender_email: cleanedEmail.sender_email,
                    is_spam: cleanedEmail.is_spam
                });

                results.push(ueo);
            }
        }
    }
    return results;
}

async function processGraphNotification(resourceId) {
    const accessToken = process.env.MS_ACCESS_TOKEN;
    const url = `https://graph.microsoft.com/v1.0/${resourceId}`;
    const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const latestMsgRaw = response.data;
    const conversationId = latestMsgRaw.conversationId;

    // Fetch historical thread messages
    const threadUrl = `https://graph.microsoft.com/v1.0/me/messages?$filter=conversationId eq '${conversationId}'&$orderBy=receivedDateTime asc`;
    const threadResponse = await axios.get(threadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const messages = threadResponse.data.value || [];
    const latestMessageText = cleanMessageBody(latestMsgRaw.body ? latestMsgRaw.body.content : '');

    const historicalMessages = [];
    for (const msg of messages) {
        if (msg.id !== latestMsgRaw.id) {
            historicalMessages.push(cleanMessageBody(msg.body ? msg.body.content : ''));
        }
    }

    const internalThreadId = generateInternalThreadId('outlook', conversationId);

    const cleanedEmail = {
        internal_thread_id: internalThreadId,
        source: 'outlook',
        provider_thread_id: conversationId,
        sender_name: latestMsgRaw.sender && latestMsgRaw.sender.emailAddress ? latestMsgRaw.sender.emailAddress.name : '',
        sender_email: latestMsgRaw.sender && latestMsgRaw.sender.emailAddress ? latestMsgRaw.sender.emailAddress.address : '',
        subject: latestMsgRaw.subject,
        snippet: latestMsgRaw.bodyPreview || latestMessageText.substring(0, 100),
        timestamp: new Date(latestMsgRaw.receivedDateTime).getTime(),
        has_attachments: latestMsgRaw.hasAttachments,
        is_unread: !latestMsgRaw.isRead,
        is_sent: latestMsgRaw.sender && latestMsgRaw.sender.emailAddress ? latestMsgRaw.sender.emailAddress.address === process.env.OWNER_EMAIL : false,
        is_starred: false,
        is_spam: false,
        is_draft: false,
        is_inbox: latestMsgRaw.sender && latestMsgRaw.sender.emailAddress ? latestMsgRaw.sender.emailAddress.address !== process.env.OWNER_EMAIL : true
    };

    const liveVersion = upsertStatusLock(internalThreadId);
    syncUiMetadata(cleanedEmail);

    const ueo = new UniversalEmailObject({
        internal_thread_id: internalThreadId,
        live_version: liveVersion,
        latest_message: latestMessageText,
        historical_thread_messages: historicalMessages,
        source: 'microsoft',
        provider_thread_id: conversationId,
        has_draft: false,
        sender_email: cleanedEmail.sender_email
    });

    return [ueo];
}

async function performGmailFullSync(days = 10) {
    const { token } = await oauth2Client.getAccessToken();
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:${days}d&includeSpamTrash=true`;
    let response;
    try {
        response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
        console.error("[FULL SYNC] Failed to fetch historical messages:", e.message);
        return [];
    }

    const messages = response.data.messages || [];
    if (messages.length === 0) {
        console.log(`[FULL SYNC] No emails found from the last ${days} days.`);
        return [];
    }

    console.log(`[FULL SYNC] Found ${messages.length} messages. Processing unique threads...`);

    // We only want to process each thread once
    const threadIds = new Set();
    messages.forEach(m => threadIds.add(m.threadId));

    const results = [];
    for (const threadId of threadIds) {
        try {
            // Re-use our existing processing logic
            const threadData = await fetchGmailThread(threadId);

            if (threadData.historyId) {
                saveGmailHistoryId(threadData.historyId);
            }

            const threadMessages = threadData.messages || [];
            if (threadMessages.length === 0) continue;

            const latestMsgRaw = threadMessages[threadMessages.length - 1];
            const rawBody = decodeGmailBody(latestMsgRaw.payload);
            const latestMessageText = cleanMessageBody(rawBody);

            // Find the latest message that isn't a draft to extract accurate metadata
            let latestReceivedMsg = threadMessages.slice().reverse().find(msg => !(msg.labelIds && msg.labelIds.includes('DRAFT')));
            // If all messages are drafts, fall back to the ORIGINAL draft (messages[0]) to get the original Subject and Date
            if (!latestReceivedMsg) latestReceivedMsg = threadMessages[0];
            const receivedRawBody = decodeGmailBody(latestReceivedMsg.payload);
            const receivedMessageText = cleanMessageBody(receivedRawBody);

            const hasDraft = threadMessages.some(msg => msg.labelIds && msg.labelIds.includes('DRAFT'));

            const historicalMessages = [];
            for (let i = 0; i < threadMessages.length - 1; i++) {
                const mRaw = decodeGmailBody(threadMessages[i].payload);
                historicalMessages.push(cleanMessageBody(mRaw));
            }

            // Extract headers from the received message
            const headers = latestReceivedMsg.payload.headers || [];
            const getHeader = (name) => {
                const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
                return h ? h.value : '';
            };

            const internalThreadId = generateInternalThreadId('gmail', threadId);

            const cleanedEmail = {
                internal_thread_id: internalThreadId,
                source: 'gmail',
                provider_thread_id: threadId,
                sender_name: getHeader('From').split('<')[0].trim(),
                sender_email: (getHeader('From').match(/<(.+)>/) || [])[1] || getHeader('From'),
                subject: getHeader('Subject'),
                snippet: latestReceivedMsg.snippet || receivedMessageText.substring(0, 100),
                timestamp: parseInt(latestReceivedMsg.internalDate) || Date.now(),
                has_attachments: !!latestReceivedMsg.payload.parts && latestReceivedMsg.payload.parts.some(p => p.filename),
                is_unread: threadMessages.some(msg => msg.labelIds && msg.labelIds.includes('UNREAD')),
                is_trash: threadMessages.some(msg => msg.labelIds && msg.labelIds.includes('TRASH')),
                is_sent: threadMessages.some(msg => msg.labelIds && msg.labelIds.includes('SENT')),
                is_starred: threadMessages.some(msg => msg.labelIds && msg.labelIds.includes('STARRED')),
                is_spam: threadMessages.some(msg => msg.labelIds && msg.labelIds.includes('SPAM')),
                is_draft: hasDraft,
                is_inbox: threadMessages.some(msg => msg.labelIds && msg.labelIds.includes('INBOX'))
            };

            const liveVersion = upsertStatusLock(internalThreadId);
            syncUiMetadata(cleanedEmail);

            const ueo = new UniversalEmailObject({
                internal_thread_id: internalThreadId,
                live_version: liveVersion,
                latest_message: latestMessageText,
                historical_thread_messages: historicalMessages,
                source: 'gmail',
                provider_thread_id: threadId,
                has_draft: hasDraft,
                sender_email: cleanedEmail.sender_email,
                is_spam: cleanedEmail.is_spam
            });

            results.push(ueo);
        } catch (err) {
            console.error(`[FULL SYNC] Error processing thread ${threadId}:`, err.message);
        }
    }
    console.log(`[FULL SYNC] Complete. Processed ${results.length} unique threads.`);
    return results;
}

async function performGmailDeltaSync() {
    const row = metadataDb.prepare("SELECT latest_token FROM sync_state WHERE provider = 'gmail'").get();
    if (!row || !row.latest_token) {
        console.log("[DELTA SYNC] No historyId found. Triggering Full Sync instead.");
        return performGmailFullSync(10);
    }

    console.log(`[DELTA SYNC] Catching up from historyId: ${row.latest_token}...`);
    const results = await processGmailNotification(row.latest_token);
    if (results && results.length > 0) {
        console.log(`[DELTA SYNC] Pulled ${results.length} missed threads.`);
    } else {
        console.log(`[DELTA SYNC] Up to date. No missed threads.`);
    }
    return results;
}

async function rebuildPayloadForWorker(internalThreadId, liveVersion) {
    const [source, providerThreadId] = internalThreadId.split('_');
    
    if (source === 'gmail') {
        const threadData = await fetchGmailThread(providerThreadId);
        const messages = threadData.messages || [];
        if (messages.length === 0) throw new Error("No messages found");
        
        const latestMsgRaw = messages[messages.length - 1];
        const rawBody = decodeGmailBody(latestMsgRaw.payload);
        const latestMessageText = cleanMessageBody(rawBody);

        const hasDraft = messages.some(msg => msg.labelIds && msg.labelIds.includes('DRAFT'));

        let latestReceivedMsg = messages.slice().reverse().find(msg => !(msg.labelIds && msg.labelIds.includes('DRAFT')));
        if (!latestReceivedMsg) latestReceivedMsg = messages[0];
        
        const historicalMessages = [];
        for (let i = 0; i < messages.length - 1; i++) {
            const mRaw = decodeGmailBody(messages[i].payload);
            historicalMessages.push(cleanMessageBody(mRaw));
        }

        const headers = latestReceivedMsg.payload.headers || [];
        const getHeader = (name) => {
            const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
            return h ? h.value : '';
        };

        const sender_email = (getHeader('From').match(/<(.+)>/) || [])[1] || getHeader('From');
        const is_spam = messages.some(msg => msg.labelIds && msg.labelIds.includes('SPAM'));

        return new UniversalEmailObject({
            internal_thread_id: internalThreadId,
            live_version: liveVersion,
            latest_message: latestMessageText,
            historical_thread_messages: historicalMessages,
            source: 'gmail',
            provider_thread_id: providerThreadId,
            has_draft: hasDraft,
            sender_email: sender_email,
            is_spam: is_spam
        });
    } else {
        throw new Error("Microsoft/Unknown rebuild not implemented yet");
    }
}

module.exports = {
    processGmailNotification,
    processGraphNotification,
    performGmailFullSync,
    performGmailDeltaSync,
    rebuildPayloadForWorker,
    oauth2Client
};
