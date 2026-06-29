const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'bff', 'routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && f !== 'compose.js');

for (const file of files) {
    const filePath = path.join(routesDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Add imports if not present
    if (!content.includes('forwardDraftStream')) {
        const importString = "const { forwardDraftStream, forwardSend } = require('../controllers/composeController');\n";
        content = importString + content;
    }
    
    // Add routes if not present
    if (!content.includes('/forward/draft')) {
        const routeString = `
router.post('/:thread_id/forward/draft', forwardDraftStream);
router.post('/:thread_id/forward/send', forwardSend);
module.exports = router;`;
        content = content.replace('module.exports = router;', routeString);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${file}`);
    }
}
