const axios = require('axios');
const { cleanMessageBody, generateInternalThreadId, decodeGmailBody } = require('./preprocessor');
const { upsertStatusLock, syncUiMetadata } = require('./dbSync');
const UniversalEmailObject = require('../models/ueo');

// Note: Access tokens should typically be managed using google-auth-library and @azure/msal-node.
// Since you will provide the tokens/keys manually for this implementation, we use environment variables.

async function fetchGmailThread(threadId) {
    const accessToken = process.env.GMAIL_ACCESS_TOKEN; 
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`;
    const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
}

async function processGmailNotification(historyId) {
    const accessToken = process.env.GMAIL_ACCESS_TOKEN;
    const historyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${historyId}`;
    let historyResponse;
    try {
        historyResponse = await axios.get(historyUrl, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
    } catch (e) {
        if (e.response && e.response.status === 404) {
            console.error("History expired, trigger Full Sync here.");
            return []; 
        }
        throw e;
    }

    const histories = historyResponse.data.history || [];
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
                
                // Extract historical messages
                const historicalMessages = [];
                for (let i = 0; i < messages.length - 1; i++) {
                    const mRaw = decodeGmailBody(messages[i].payload);
                    historicalMessages.push(cleanMessageBody(mRaw));
                }

                // Extract headers
                const headers = latestMsgRaw.payload.headers || [];
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
                    snippet: latestMsgRaw.snippet || latestMessageText.substring(0, 100),
                    timestamp: parseInt(latestMsgRaw.internalDate) || Date.now(),
                    has_attachments: !!latestMsgRaw.payload.parts && latestMsgRaw.payload.parts.some(p => p.filename),
                    is_unread: latestMsgRaw.labelIds && latestMsgRaw.labelIds.includes('UNREAD')
                };

                // DB Syncs
                const liveVersion = upsertStatusLock(internalThreadId);
                syncUiMetadata(cleanedEmail);
                
                // Construct UEO
                const ueo = new UniversalEmailObject({
                    internal_thread_id: internalThreadId,
                    live_version: liveVersion,
                    latest_message: latestMessageText,
                    historical_thread_messages: historicalMessages
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
        is_unread: !latestMsgRaw.isRead
    };

    const liveVersion = upsertStatusLock(internalThreadId);
    syncUiMetadata(cleanedEmail);
    
    const ueo = new UniversalEmailObject({
        internal_thread_id: internalThreadId,
        live_version: liveVersion,
        latest_message: latestMessageText,
        historical_thread_messages: historicalMessages
    });
    
    return [ueo];
}

module.exports = {
    processGmailNotification,
    processGraphNotification
};
