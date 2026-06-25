const { google } = require('googleapis');

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
        console.log(`[GMAIL API] Pushing draft to provider thread: ${provider_thread_id}...`);
        
        // Construct the RFC 2822 email. 
        // By passing threadId in the API request body below, Gmail automatically assigns the correct To/From/Subject!
        const rawMessage = makeRawEmail('', '', '', draftText);

        const response = await gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
                message: {
                    raw: rawMessage,
                    threadId: provider_thread_id // Attach to existing conversation
                }
            }
        });

        console.log(`[GMAIL API] Successfully created native Draft! Draft ID: ${response.data.id}`);
        return response.data;
    } catch (error) {
        console.error(`[GMAIL API ERROR] Failed to create draft:`, error.message);
        return null;
    }
}

module.exports = { createGmailDraft };
