const logger = require('../../src/utils/logger');
const { google } = require('googleapis');
const { statusDb, metadataDb } = require('../../src/config/database');

/**
 * Extracts and formats the complete email thread specifically for the React UI.
 * @param {string} internal_thread_id - The unique ID of the thread
 * @returns {Array} Array of cleanly formatted messages containing raw HTML
 */
async function extractThreadHistory(internal_thread_id) {
    // 1. Database Lookup
    const metadataRow = metadataDb.prepare("SELECT provider_thread_id, is_draft FROM metadata WHERE internal_thread_id = ?").get(internal_thread_id);
    const statusRow = statusDb.prepare("SELECT status, live_version FROM status WHERE internal_thread_id = ?").get(internal_thread_id);

    if (!metadataRow || !statusRow) {
        throw new Error("Thread not found in database.");
    }

    // 2. Urgent Queue Jump (Fire and Forget)
    if (statusRow.status === 'pending') {
        logger.info(`[EXTRACTOR] Thread ${internal_thread_id} is pending. Triggering Urgent Queue Jump...`);
        // We use native fetch (available in Node 18+) to hit the ingestion server's urgent API
        try {
            fetch('http://localhost:3000/api/internal/urgent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    internal_thread_id: internal_thread_id,
                    live_version: statusRow.live_version
                })
            }).catch(e => logger.error("[EXTRACTOR] Urgent queue jump fetch failed:", e.message));
        } catch(e) {} 
    }

    // 3. Gmail API Live Fetch
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.threads.get({
        userId: 'me',
        id: metadataRow.provider_thread_id,
        format: 'full'
    });

    const messages = response.data.messages || [];
    const cleanMessages = [];
    let isLastMessageSent = false;
    let draftHtml = null;

    // 4 & 5. Draft Stripping and HTML Extraction
    for (const msg of messages) {
        // STRIP THE DRAFT: If the message contains the DRAFT label, skip it!
        const isMsgDraft = msg.labelIds && msg.labelIds.includes('DRAFT');
        if (metadataRow.is_draft === 1 && isMsgDraft) {
            logger.info(`[EXTRACTOR] Captured draft message ${msg.id} for inline UI view.`);
            draftHtml = extractHtmlBody(msg.payload);
            continue; // Skip pushing this to the cleanMessages array
        }

        // Parse Headers
        const headers = msg.payload.headers;
        const from = headers.find(h => h.name === 'From')?.value || '';
        const to = headers.find(h => h.name === 'To')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        // Extract raw HTML for perfect UI formatting
        const htmlBody = extractHtmlBody(msg.payload);

        cleanMessages.push({
            id: msg.id,
            from,
            to,
            date,
            bodyHtml: htmlBody
        });
        
        // Tracking logic for hiding the Draft UI button.
        // We constantly update this so by the end of the loop, 
        // it holds the boolean value of the FINAL historical message.
        if (msg.labelIds && msg.labelIds.includes('SENT')) {
            isLastMessageSent = true;
        } else {
            isLastMessageSent = false; // Reset if the next message was received
        }
    }

    // Return the universal object so the frontend knows exactly what to render
    return {
        messages: cleanMessages,
        hideDraftButton: isLastMessageSent,
        draft: draftHtml
    };
}

/**
 * Specifically digs through the Google MIME tree to find the raw HTML payload,
 * ensuring the React UI can render bolding, colors, and inline images perfectly.
 */
function extractHtmlBody(payload) {
    if (!payload) return '';
    
    let bodyData = '';
    // If the top-level payload is already HTML
    if (payload.body && payload.body.data && payload.mimeType === 'text/html') {
        bodyData = payload.body.data;
    } else if (payload.parts) {
        // Try to find the HTML part inside the parts array
        const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
        if (htmlPart && htmlPart.body && htmlPart.body.data) {
            bodyData = htmlPart.body.data;
        } else if (payload.parts[0] && payload.parts[0].parts) {
             // Handle nested multipart/alternative inside multipart/mixed
             return extractHtmlBody(payload.parts[0]); 
        } else {
             // Fallback to plain text if no HTML exists at all
             const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
             if (textPart && textPart.body && textPart.body.data) {
                 bodyData = textPart.body.data;
             }
        }
    } else if (payload.body && payload.body.data) {
        // Base case fallback
        bodyData = payload.body.data;
    }

    // Decode the base64 URL-safe string provided by Google
    if (bodyData) {
        const base64 = bodyData.replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(base64, 'base64').toString('utf8');
    }
    return '';
}

module.exports = { extractThreadHistory };
