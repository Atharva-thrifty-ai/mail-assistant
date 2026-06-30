require('dotenv').config();
const { ChatOpenAI } = require('@langchain/openai');
const { BaseCallbackHandler } = require("@langchain/core/callbacks/base");

class TestCallback extends BaseCallbackHandler {
    constructor() {
        super();
        this.name = "test_cb";
    }
    async handleLLMEnd(output) {
        console.log("\n[CALLBACK] handleLLMEnd output.llmOutput:");
        console.log(JSON.stringify(output.llmOutput, null, 2));
        console.log("\n[CALLBACK] handleLLMEnd output.generations[0][0].message.response_metadata:");
        console.log(JSON.stringify(output.generations[0][0].message.response_metadata, null, 2));
        console.log("\n[CALLBACK] handleLLMEnd output.generations[0][0].message.usage_metadata:");
        console.log(JSON.stringify(output.generations[0][0].message.usage_metadata, null, 2));
    }
}

async function test() {
    const llmInvoke = new ChatOpenAI({
        modelName: "gpt-4o-mini",
        temperature: 0,
        callbacks: [new TestCallback()]
    });
    
    console.log("Testing INVOKE...");
    const res = await llmInvoke.invoke("Say hello");
    console.log("\n[INVOKE] res.response_metadata:", JSON.stringify(res.response_metadata));
    console.log("[INVOKE] res.usage_metadata:", JSON.stringify(res.usage_metadata));

    console.log("\n=====================\nTesting STREAM...");
    const llmStream = new ChatOpenAI({
        modelName: "gpt-4o-mini",
        temperature: 0,
        streamUsage: true,
        callbacks: [new TestCallback()]
    });
    
    const stream = await llmStream.stream("Say hello");
    for await (const chunk of stream) {
        if (chunk.response_metadata || chunk.usage_metadata) {
            console.log("\n[STREAM CHUNK] response_metadata:", JSON.stringify(chunk.response_metadata));
            console.log("[STREAM CHUNK] usage_metadata:", JSON.stringify(chunk.usage_metadata));
        }
    }
}

test().catch(console.error);
