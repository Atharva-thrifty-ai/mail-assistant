const fs = require('fs');
const path = require('path');

const filesToUpdate = [
    { p: 'src/ingestion/server.js', depth: '../' },
    { p: 'src/ingestion/worker.js', depth: '../' },
    { p: 'src/ingestion/adapter.js', depth: '../' },
    { p: 'src/nodes/classifierNode.js', depth: '../' },
    { p: 'src/nodes/drafterNode.js', depth: '../' },
    { p: 'src/nodes/memoryNode.js', depth: '../' },
    { p: 'src/utils/gmailApi.js', depth: '../' },
    { p: 'bff/app.js', depth: '../src/' },
    { p: 'bff/services/drafterService.js', depth: '../../src/' },
    { p: 'bff/services/summarizerService.js', depth: '../../src/' },
    { p: 'bff/services/extractorService.js', depth: '../../src/' },
    { p: 'bff/routes/drafts.js', depth: '../../src/' },
    { p: 'bff/routes/inbox.js', depth: '../../src/' }
];

filesToUpdate.forEach(f => {
    const fullPath = path.join(__dirname, f.p);
    if (!fs.existsSync(fullPath)) {
        console.log("Not found:", fullPath);
        return;
    }
    
    let content = fs.readFileSync(fullPath, 'utf8');
    
    if (content.includes('const logger = require(')) return;

    const importStatement = `const logger = require('${f.depth}utils/logger');\n`;
    
    if (content.startsWith("require('dotenv')")) {
        content = content.replace(/require\('dotenv'\)[^\n]*\n/, match => match + importStatement);
    } else if (content.startsWith("const express")) {
        content = importStatement + content;
    } else {
        content = importStatement + content;
    }

    content = content.replace(/console\.log/g, 'logger.info');
    content = content.replace(/console\.error/g, 'logger.error');
    
    fs.writeFileSync(fullPath, content);
    console.log('Updated ' + f.p);
});
