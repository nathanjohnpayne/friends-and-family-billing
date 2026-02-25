const fs = require('fs');
fs.writeFileSync('version.json', JSON.stringify({ version: new Date().toISOString() }) + '\n');
