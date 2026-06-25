/**
 * Universal Email Object (UEO) constructor and validator
 */
class UniversalEmailObject {
    constructor({ internal_thread_id, live_version, latest_message, historical_thread_messages, source, provider_thread_id, has_draft, sender_email, is_spam }) {
        if (!internal_thread_id || live_version == null || latest_message == null || !Array.isArray(historical_thread_messages)) {
            throw new Error('Invalid UEO parameters');
        }
        
        this.internal_thread_id = internal_thread_id;
        this.live_version = live_version;
        this.latest_message = latest_message;
        this.historical_thread_messages = historical_thread_messages;
        this.source = source || 'gmail'; // Default to gmail for backward compatibility
        this.provider_thread_id = provider_thread_id || internal_thread_id.split('_').pop(); // Attempt to extract if missing
        this.has_draft = has_draft || false;
        this.sender_email = sender_email || '';
        this.is_spam = is_spam || false;
    }

    toJSON() {
        return {
            internal_thread_id: this.internal_thread_id,
            live_version: this.live_version,
            latest_message: this.latest_message,
            historical_thread_messages: this.historical_thread_messages,
            source: this.source,
            provider_thread_id: this.provider_thread_id,
            has_draft: this.has_draft,
            sender_email: this.sender_email,
            is_spam: this.is_spam
        };
    }
}

module.exports = UniversalEmailObject;
