const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'bff', 'routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && f !== 'compose.js');

for (const file of files) {
    const filePath = path.join(routesDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace the SELECT line
    const searchString = "SELECT internal_thread_id, sender_name, sender_email, subject, timestamp as date, snippet, ai_categories, is_draft";
    const replacementString = "SELECT internal_thread_id, sender_name, sender_email, subject, timestamp as date, snippet, ai_categories, is_draft, is_starred, is_trash";
    
    if (content.includes(searchString)) {
        content = content.replace(searchString, replacementString);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${file}`);
    } else {
        console.log(`Could not find search string in ${file}`);
    }
}
