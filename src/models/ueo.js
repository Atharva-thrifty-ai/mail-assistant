/**
 * Universal Email Object (UEO) constructor and validator
 */
class UniversalEmailObject {
    constructor({ internal_thread_id, live_version, latest_message, historical_thread_messages }) {
        if (!internal_thread_id || live_version == null || latest_message == null || !Array.isArray(historical_thread_messages)) {
            throw new Error('Invalid UEO parameters');
        }
        
        this.internal_thread_id = internal_thread_id;
        this.live_version = live_version;
        this.latest_message = latest_message;
        this.historical_thread_messages = historical_thread_messages;
    }

    toJSON() {
        return {
            internal_thread_id: this.internal_thread_id,
            live_version: this.live_version,
            latest_message: this.latest_message,
            historical_thread_messages: this.historical_thread_messages
        };
    }
}

module.exports = UniversalEmailObject;
