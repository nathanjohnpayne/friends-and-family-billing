/**
 * assemble-deploy.js — copies static assets into app/ (the Firebase public dir)
 * after Vite and esbuild have finished their builds.
 *
 * Run order: build:react → build:legacy → build:assemble
 *   - Vite builds React into app/ (emptyOutDir clears it first)
 *   - esbuild builds legacy JS to script.js at repo root
 *   - This script copies legacy + shared files into app/
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app');

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function copy(src, dest) {
    const srcPath = path.join(ROOT, src);
    if (!fs.existsSync(srcPath)) {
        console.warn(`  SKIP (not found): ${src}`);
        return;
    }
    fs.copyFileSync(srcPath, dest);
    console.log(`  ${src} → ${path.relative(ROOT, dest)}`);
}

// --- Legacy site → app/site/ ---
const siteDir = path.join(OUT, 'site');
ensureDir(siteDir);

console.log('Assembling legacy site into app/site/:');
const legacyFiles = [
    'index.html',
    'login.html',
    'share.html',
    'check_data.html',
    'auth.js',
    'styles.css',
    'login.css',
    'annual-summary.css',
];
for (const file of legacyFiles) {
    copy(file, path.join(siteDir, file));
}

// Legacy build artifact
copy('script.js', path.join(siteDir, 'script.js'));
if (fs.existsSync(path.join(ROOT, 'script.js.map'))) {
    copy('script.js.map', path.join(siteDir, 'script.js.map'));
}

// --- Shared assets → app/ root ---
console.log('\nCopying shared assets into app/:');
const sharedFiles = [
    'firebase-config.js',
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

// --- React SPA index.html → app/ root ---
// Vite outputs index.html to app/src/app/index.html (mirroring source structure).
// Firebase SPA rewrite needs it at app/index.html (served as /).
const reactIndex = path.join(OUT, 'src', 'app', 'index.html');
if (fs.existsSync(reactIndex)) {
    fs.copyFileSync(reactIndex, path.join(OUT, 'index.html'));
    console.log('\nCopied React index.html → app/index.html (SPA root)');
}

console.log('\nAssembly complete.');
