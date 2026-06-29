const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'bff', 'routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && f !== 'compose.js');

for (const file of files) {
    const filePath = path.join(routesDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // 1. Add import
    if (!content.includes('actionController')) {
        content = `const { starThread, unstarThread, trashThread, untrashThread } = require('../controllers/actionController');\n` + content;
    }
    
    // 2. Add routes before module.exports
    if (!content.includes('/star')) {
        const routesToAdd = `
// Action Routes
router.post('/:thread_id/star', starThread);
router.post('/:thread_id/unstar', unstarThread);
router.post('/:thread_id/trash', trashThread);
router.post('/:thread_id/untrash', untrashThread);

module.exports = router;`;
        content = content.replace('module.exports = router;', routesToAdd);
    }
    
    // 3. Update SQL queries (except for trash.js which should only show trash)
    if (file === 'trash.js') {
        // trash.js should only show WHERE is_trash = 1
        // It's probably already `WHERE is_trash = 1`, let's just make sure.
    } else {
        // For others, replace WHERE ... = 1 with WHERE ... = 1 AND is_trash = 0
        // Need to be careful with WHERE is_draft = 1, WHERE is_sent = 1, WHERE ai_categories LIKE '%Attention%'
        
        // Regex to find the WHERE clause in the main GET / route
        // Assuming the query is `SELECT ... FROM metadata WHERE ... ORDER BY timestamp DESC`
        content = content.replace(/(WHERE\s+.*?)\s+ORDER BY timestamp DESC/g, (match, p1) => {
            if (!p1.includes('is_trash = 0')) {
                return `${p1} AND is_trash = 0\n            ORDER BY timestamp DESC`;
            }
            return match;
        });
    }
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${file}`);
}
