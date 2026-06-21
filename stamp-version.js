const fs = require('fs');
const path = require('path');

const version = JSON.stringify({ version: new Date().toISOString() }) + '\n';

const appDir = path.join(__dirname, 'app');

// Write to app/ root (React)
if (fs.existsSync(appDir)) {
    fs.writeFileSync(path.join(appDir, 'version.json'), version);
}
