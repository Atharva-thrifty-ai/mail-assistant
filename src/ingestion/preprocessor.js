const { htmlToText } = require('html-to-text');
const EmailReplyParserModule = require('email-reply-parser');
const EmailReplyParser = EmailReplyParserModule.EmailReplyParser || EmailReplyParserModule.default || EmailReplyParserModule;

function cleanMessageBody(rawHtmlOrText) {
    if (!rawHtmlOrText) return '';
    // Strip HTML tags using the library
    const plainText = htmlToText(rawHtmlOrText, {
        wordwrap: false,
        ignoreHref: true,
        ignoreImage: true
    });
    
    // Strip quoted history securely instead of manual regex
    const parser = new EmailReplyParser();
    const email = parser.read(plainText);
    return email.getVisibleText().trim();
}

function generateInternalThreadId(source, providerThreadId) {
    return `${source}_${providerThreadId}`;
}

// Helper to extract nested parts from Gmail response
function decodeGmailBody(payload) {
    if (!payload) return '';
    
    let bodyData = '';
    if (payload.body && payload.body.data) {
        bodyData = payload.body.data;
    } else if (payload.parts) {
        // Try to find html part first, then plain text
        const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
        
        if (htmlPart && htmlPart.body && htmlPart.body.data) {
            bodyData = htmlPart.body.data;
        } else if (textPart && textPart.body && textPart.body.data) {
            bodyData = textPart.body.data;
        } else if (payload.parts[0] && payload.parts[0].parts) {
            // Recursively decode if parts are nested (e.g. multipart/alternative inside multipart/mixed)
             return decodeGmailBody(payload.parts[0]);
        }
    }
    
    if (bodyData) {
        // Replace URL-safe base64 characters
        const base64 = bodyData.replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(base64, 'base64').toString('utf8');
    }
    return '';
}

module.exports = {
    cleanMessageBody,
    generateInternalThreadId,
    decodeGmailBody
};
