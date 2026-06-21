/**
 * assemble-deploy.js — copies static assets into app/ (the Firebase public dir)
 * after Vite has finished the React build.
 *
 * Run order: build:react → build:assemble
 *   - Vite builds React into app/ (emptyOutDir clears it first)
 *   - This script generates the runtime Firebase config bridge and copies
 *     shared assets into app/, then relocates the React index.html to app/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app');

function copy(src, dest) {
    const srcPath = path.join(ROOT, src);
    if (!fs.existsSync(srcPath)) {
        console.warn(`  SKIP (not found): ${src}`);
        return;
    }
    fs.copyFileSync(srcPath, dest);
    console.log(`  ${src} → ${path.relative(ROOT, dest)}`);
}

// --- Generate firebase-config.local.js if missing ---
const { generate: generateFirebaseConfig } = require('./generate-firebase-config.js');
console.log('Ensuring firebase-config.local.js exists:');
if (!generateFirebaseConfig()) {
    console.error('\nBuild aborted: firebase-config.local.js is required for deploy.');
    process.exit(1);
}

// --- Shared assets → app/ root ---
console.log('\nCopying shared assets into app/:');
const sharedFiles = [
    'firebase-config.local.js',
    'design-tokens.css',
    'favicon.svg',
    'logo.svg',
    'og-image.png',
    'qr-code.svg',
];
for (const file of sharedFiles) {
    copy(file, path.join(OUT, file));
}

// Vite builds the root index.html directly to app/index.html (served as / by
// Firebase Hosting and the dev server), so no relocation step is needed.

console.log('\nAssembly complete.');
