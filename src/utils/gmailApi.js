const logger = require('../utils/logger');
const { google } = require('googleapis');
const { metadataDb } = require('../config/database');

// Construct raw RFC 2822 email format required by the Gmail API
function makeRawEmail(to, from, subject, message) {
    const email = [
        `To: ${to}`,
        `From: ${from}`,
        `Subject: ${subject}`,
        '',
        message
    ].join('\n');
    
    // Base64url encoding
    return Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createGmailDraft(provider_thread_id, draftText) {
    // 1. Initialize OAuth2 Client
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );

    // 2. Set credentials using the refresh token
    oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        logger.info(`[GMAIL API] Pushing draft to provider thread: ${provider_thread_id}...`);
        
        // Lookup thread metadata to properly populate To and Subject headers
        const metadataRow = metadataDb.prepare("SELECT sender_email, subject FROM metadata WHERE provider_thread_id = ?").get(provider_thread_id);
        let to = '';
        let subject = '';
        if (metadataRow) {
            to = metadataRow.sender_email || '';
            subject = metadataRow.subject || '';
            if (subject && !subject.toLowerCase().startsWith('re:')) {
                subject = `Re: ${subject}`;
            }
        }
        
        const rawMessage = makeRawEmail(to, 'me', subject, draftText);

        const response = await gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
                message: {
                    raw: rawMessage,
                    threadId: provider_thread_id // Attach to existing conversation
                }
            }
        });

        logger.info(`[GMAIL API] Successfully created native Draft! Draft ID: ${response.data.id}`);
        return response.data;
    } catch (error) {
        const exactError = error.response?.data?.error?.message || error.message;
        logger.error(`[GMAIL API ERROR] Failed to create draft:`, exactError);
        return null;
    }
}

async function createComposeDraft(to, subject, draftText, threadId = null) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        logger.info(`[GMAIL API] Pushing Compose draft (to: ${to})...`);
        
        const rawMessage = makeRawEmail(to, 'me', subject, draftText);

        const requestBody = {
            message: {
                raw: rawMessage
            }
        };

        if (threadId) {
            requestBody.message.threadId = threadId; // For Forwarding
        }

        const response = await gmail.users.drafts.create({
            userId: 'me',
            requestBody
        });

        logger.info(`[GMAIL API] Successfully created Compose Draft! Draft ID: ${response.data.id}`);
        return response.data;
    } catch (error) {
        const exactError = error.response?.data?.error?.message || error.message;
        logger.error(`[GMAIL API ERROR] Failed to create Compose draft:`, exactError);
        return null;
    }
}

async function updateGmailDraft(draftId, provider_thread_id, draftText) {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        logger.info(`[GMAIL API] Updating draft ${draftId}...`);
        
        // Lookup thread metadata to properly populate To and Subject headers
        const metadataRow = metadataDb.prepare("SELECT sender_email, subject FROM metadata WHERE provider_thread_id = ?").get(provider_thread_id);
        let to = '';
        let subject = '';
        if (metadataRow) {
            to = metadataRow.sender_email || '';
            subject = metadataRow.subject || '';
            if (subject && !subject.toLowerCase().startsWith('re:')) {
                subject = `Re: ${subject}`;
            }
        }
        
        const rawMessage = makeRawEmail(to, 'me', subject, draftText);
        
        const response = await gmail.users.drafts.update({
            userId: 'me',
            id: draftId,
            requestBody: {
                message: { raw: rawMessage, threadId: provider_thread_id }
            }
        });
        logger.info(`[GMAIL API] Successfully updated native Draft!`);
        return response.data;
    } catch (error) {
        const exactError = error.response?.data?.error?.message || error.message;
        logger.error(`[GMAIL API ERROR] Failed to update draft:`, exactError);
        return null;
    }
}

async function getGmailDraftText(draftId) {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        const response = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'full' });
        // The body is often in parts, simplify by just pulling snippet for the UI or decoding the payload
        let body = "";
        const payload = response.data.message.payload;
        if (payload.parts) {
            const part = payload.parts.find(p => p.mimeType === 'text/plain');
            if (part && part.body.data) {
                body = Buffer.from(part.body.data, 'base64').toString('utf8');
            }
        } else if (payload.body && payload.body.data) {
            body = Buffer.from(payload.body.data, 'base64').toString('utf8');
        }
        return body || response.data.message.snippet;
    } catch (error) {
        logger.error(`[GMAIL API ERROR] Failed to get draft:`, error.message);
        return null;
    }
}

async function getGmailThreadDrafts(provider_thread_id) {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        const response = await gmail.users.threads.get({ userId: 'me', id: provider_thread_id });
        const messages = response.data.messages || [];
        const draftMessage = messages.find(m => m.labelIds && m.labelIds.includes('DRAFT'));
        
        if (draftMessage) {
            let body = "";
            const payload = draftMessage.payload;
            if (payload.parts) {
                const part = payload.parts.find(p => p.mimeType === 'text/plain');
                if (part && part.body.data) body = Buffer.from(part.body.data, 'base64').toString('utf8');
            } else if (payload.body && payload.body.data) {
                body = Buffer.from(payload.body.data, 'base64').toString('utf8');
            }
            return body || draftMessage.snippet;
        }
        return null;
    } catch (error) {
        logger.error(`[GMAIL API ERROR] Failed to get thread drafts:`, error.message);
        return null;
    }
}
async function sendGmailDraft(draftId) {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        const response = await gmail.users.drafts.send({
            userId: 'me',
            requestBody: {
                id: draftId
            }
        });
        logger.info(`[GMAIL API] Successfully sent Draft ID: ${draftId}`);
        return response.data;
    } catch (error) {
        const exactError = error.response?.data?.error?.message || error.message;
        logger.error(`[GMAIL API ERROR] Failed to send draft:`, exactError);
        return null;
    }
}

async function modifyGmailThreadLabels(threadId, addLabelIds = [], removeLabelIds = []) {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        const response = await gmail.users.threads.modify({
            userId: 'me',
            id: threadId,
            requestBody: {
                addLabelIds: addLabelIds,
                removeLabelIds: removeLabelIds
            }
        });
        logger.info(`[GMAIL API] Successfully modified labels for thread: ${threadId}`);
        return response.data;
    } catch (error) {
        const exactError = error.response?.data?.error?.message || error.message;
        logger.error(`[GMAIL API ERROR] Failed to modify labels for thread ${threadId}: ${exactError}`);
        return null;
    }
}

async function trashGmailThread(threadId) {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        const response = await gmail.users.threads.trash({
            userId: 'me',
            id: threadId
        });
        logger.info(`[GMAIL API] Successfully trashed thread: ${threadId}`);
        return response.data;
    } catch (error) {
        const exactError = error.response?.data?.error?.message || error.message;
        logger.error(`[GMAIL API ERROR] Failed to trash thread ${threadId}: ${exactError}`);
        return null;
    }
}

async function untrashGmailThread(threadId) {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
        const response = await gmail.users.threads.untrash({
            userId: 'me',
            id: threadId
        });
        logger.info(`[GMAIL API] Successfully untrashed thread: ${threadId}`);
        return response.data;
    } catch (error) {
        const exactError = error.response?.data?.error?.message || error.message;
        logger.error(`[GMAIL API ERROR] Failed to untrash thread ${threadId}: ${exactError}`);
        return null;
    }
}

module.exports = { createGmailDraft, createComposeDraft, updateGmailDraft, getGmailDraftText, getGmailThreadDrafts, sendGmailDraft, modifyGmailThreadLabels, trashGmailThread, untrashGmailThread };
