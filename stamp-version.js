const fs = require('fs');
const path = require('path');

const version = JSON.stringify({ version: new Date().toISOString() }) + '\n';

const appDir = path.join(__dirname, 'app');

// Write to app/ root (React)
if (fs.existsSync(appDir)) {
    fs.writeFileSync(path.join(appDir, 'version.json'), version);
}

// Write to app/site/ (legacy)
const siteDir = path.join(appDir, 'site');
if (fs.existsSync(siteDir)) {
    fs.writeFileSync(path.join(siteDir, 'version.json'), version);
}
