const { createGmailDraft } = require('./src/utils/gmailApi');

async function test() {
    try {
        console.log("Calling create...");
        const res = await createGmailDraft('19efe0ec85de9f5c', "Test draft text");
        console.log("Create result:", res);
    } catch(e) {
        console.log("ERROR TYPE:", typeof e);
        console.log("ERROR CLASS:", e.constructor.name);
        console.log("ERROR MSG:", e.message);
    }
}
test();
