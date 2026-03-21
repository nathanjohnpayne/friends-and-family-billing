const fs = require('fs');
const path = require('path');

const version = JSON.stringify({ version: new Date().toISOString() }) + '\n';

// Write to repo root (legacy)
fs.writeFileSync('version.json', version);

// Write to app/ (React build output) if it exists
const appDir = path.join(__dirname, 'app');
if (fs.existsSync(appDir)) {
    fs.writeFileSync(path.join(appDir, 'version.json'), version);
}
