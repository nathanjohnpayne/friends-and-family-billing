const fs = require('fs');
const path = require('path');

const version = JSON.stringify({ version: new Date().toISOString() }) + '\n';

// Write to repo root (legacy)
fs.writeFileSync('version.json', version);

// Write to dist/ (React) if it exists
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
    fs.writeFileSync(path.join(distDir, 'version.json'), version);
}
