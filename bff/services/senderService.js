const { metadataDb } = require('../../src/config/database');
const { sendGmailDraft, updateGmailDraft, createGmailDraft } = require('../../src/utils/gmailApi');
const logger = require('../../src/utils/logger');

async function sendDraft(internal_thread_id, draftText) {
    const metadataRow = metadataDb.prepare("SELECT source, provider_thread_id, native_draft_id FROM metadata WHERE internal_thread_id = ?").get(internal_thread_id);
    
    if (!metadataRow) {
        throw new Error("Thread not found.");
    }

    if (metadataRow.source === 'gmail') {
        let draftIdToSend = metadataRow.native_draft_id;
        let updateSuccess = false;

        if (draftIdToSend) {
            // Update the existing draft with final text before sending
            const updateResponse = await updateGmailDraft(draftIdToSend, metadataRow.provider_thread_id, draftText);
            if (updateResponse) updateSuccess = true;
        }
        
        if (!updateSuccess) {
            // Fallback: If no draft exists (e.g. manually written) OR it was deleted externally, create a new one
            const draftResponse = await createGmailDraft(metadataRow.provider_thread_id, draftText);
            if (draftResponse) {
                draftIdToSend = draftResponse.id;
                // Update DB with the new draft ID just in case it fails to send later
                metadataDb.prepare("UPDATE metadata SET native_draft_id = ? WHERE internal_thread_id = ?").run(draftIdToSend, internal_thread_id);
            } else {
                throw new Error("Failed to create draft via Gmail API.");
            }
        }

        // Send it
        const sendResponse = await sendGmailDraft(draftIdToSend);
        if (sendResponse) {
            // Update DB state
            metadataDb.prepare("UPDATE metadata SET is_sent = 1, is_draft = 0 WHERE internal_thread_id = ?").run(internal_thread_id);
            return { success: true };
        } else {
            throw new Error("Failed to send draft via Gmail API.");
        }
    } else if (metadataRow.source === 'microsoft') {
        logger.info(`[BFF SENDER] Microsoft API paused. Skipping send for thread ${internal_thread_id}`);
        return { success: true, note: "Microsoft paused" };
    }
    
    throw new Error("Unsupported provider source.");
}

module.exports = { sendDraft };
