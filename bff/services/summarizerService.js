const { statusDb, summariesDb } = require('../../src/config/database');

/**
 * Retrieves the 1-sentence AI summary for the frontend popup.
 * Follows the UI Polling pattern.
 * @param {string} internal_thread_id - The unique ID of the thread
 * @returns {Object} { isPending: boolean, summary: string | null }
 */
function getSummary(internal_thread_id) {
    // 1. Status Lookup
    const statusRow = statusDb.prepare("SELECT status FROM status WHERE internal_thread_id = ?").get(internal_thread_id);

    if (!statusRow) {
        throw new Error("Thread not found in status database.");
    }

    // 2. Pending Hand-off (Trigger the React Loading Spinner)
    if (statusRow.status === 'pending' || statusRow.status === 'processing') {
        return { isPending: true, summary: null };
    }

    // 3. Summary Retrieval
    const summaryRow = summariesDb.prepare("SELECT ui_summary FROM ui_summaries WHERE internal_thread_id = ?").get(internal_thread_id);

    // 4. Final Payload
    return {
        isPending: false,
        summary: summaryRow && summaryRow.ui_summary ? summaryRow.ui_summary : "No summary available."
    };
}

module.exports = { getSummary };
