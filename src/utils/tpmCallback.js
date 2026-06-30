const { BaseCallbackHandler } = require("@langchain/core/callbacks/base");
const { metricsDb } = require("../config/database");

class TpmCallback extends BaseCallbackHandler {
    constructor() {
        super();
        this.name = "tpm_callback_handler";
    }

    async handleLLMEnd(output) {
        if (!output || !output.llmOutput || !output.llmOutput.tokenUsage) return;
        
        const totalTokens = output.llmOutput.tokenUsage.totalTokens || 0;
        
        // Get the current minute as a string, e.g., '12:05'
        const now = new Date();
        const currentMinuteString = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

        // Execute the atomic single-row upsert
        metricsDb.prepare(`
            UPDATE tpm_state 
            SET 
              current_tokens = CASE 
                WHEN current_minute = ? THEN current_tokens + ? 
                ELSE ? 
              END,
              current_requests = CASE 
                WHEN current_minute = ? THEN current_requests + 1 
                ELSE 1 
              END,
              current_minute = ?,
              max_tpm = MAX(max_tpm, CASE WHEN current_minute = ? THEN current_tokens + ? ELSE ? END),
              max_rpm = MAX(max_rpm, CASE WHEN current_minute = ? THEN current_requests + 1 ELSE 1 END)
            WHERE id = 'singleton'
        `).run(
            currentMinuteString, totalTokens, totalTokens,
            currentMinuteString,
            currentMinuteString,
            currentMinuteString, totalTokens, totalTokens,
            currentMinuteString
        );
    }
}

module.exports = { TpmCallback };
