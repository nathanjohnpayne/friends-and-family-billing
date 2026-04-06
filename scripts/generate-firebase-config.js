/**
 * generate-firebase-config.js — generates firebase-config.local.js from
 * VITE_FIREBASE_* environment variables in .env.local.
 *
 * This ensures deploying from a clean worktree or fresh checkout still
 * produces a valid firebase-config.local.js for the React app's
 * window.__FIREBASE_CONFIG__ bridge.
 *
 * Run order: called by assemble-deploy.js when the file is missing.
 * Can also be run standalone: node scripts/generate-firebase-config.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');
const OUT_PATH = path.join(ROOT, 'firebase-config.local.js');

function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const vars = {};
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        vars[key] = val;
    }
    return vars;
}

function generate() {
    // If firebase-config.local.js already exists, skip
    if (fs.existsSync(OUT_PATH)) {
        console.log('  firebase-config.local.js already exists, skipping generation.');
        return true;
    }

    // E2E / CI: firebase.js already uses a dummy config when VITE_E2E_MODE is
    // set, but the HTML still loads firebase-config.local.js via <script>.
    // Write a stub so the <script> tag doesn't 404 and get rewritten to HTML.
    if (process.env.VITE_E2E_MODE) {
        const stub = 'window.__FIREBASE_CONFIG__ = { apiKey: "e2e-test-key", authDomain: "e2e-test.firebaseapp.com", projectId: "e2e-test", storageBucket: "e2e-test.appspot.com", messagingSenderId: "000000000000", appId: "1:000000000000:web:0000000000000000" };\n';
        fs.writeFileSync(OUT_PATH, stub, 'utf8');
        console.log('  Generated E2E stub firebase-config.local.js');
        return true;
    }

    const env = parseEnvFile(ENV_PATH);
    if (!env) {
        console.error('ERROR: Neither firebase-config.local.js nor .env.local found.');
        console.error('Run ./scripts/bootstrap.sh or copy firebase-config.local.example.js');
        return false;
    }

    const apiKey = env.VITE_FIREBASE_API_KEY;
    if (!apiKey || apiKey.startsWith('{{')) {
        console.error('ERROR: .env.local has unresolved VITE_FIREBASE_API_KEY.');
        console.error('Run: op inject -i .env.tpl -o .env.local -f');
        return false;
    }

    // Build config object — include logodevKey for the legacy app (src/main.js)
    const lines = [
        `    apiKey: ${JSON.stringify(apiKey)}`,
        `    authDomain: ${JSON.stringify(env.VITE_FIREBASE_AUTH_DOMAIN || '')}`,
        `    projectId: ${JSON.stringify(env.VITE_FIREBASE_PROJECT_ID || '')}`,
        `    storageBucket: ${JSON.stringify(env.VITE_FIREBASE_STORAGE_BUCKET || '')}`,
        `    messagingSenderId: ${JSON.stringify(env.VITE_FIREBASE_MESSAGING_SENDER_ID || '')}`,
        `    appId: ${JSON.stringify(env.VITE_FIREBASE_APP_ID || '')}`,
        `    measurementId: ${JSON.stringify(env.VITE_FIREBASE_MEASUREMENT_ID || '')}`,
    ];
    if (env.VITE_LOGODEV_KEY) {
        lines.push(`    logodevKey: ${JSON.stringify(env.VITE_LOGODEV_KEY)}`);
    }
    const content = `window.__FIREBASE_CONFIG__ = {\n${lines.join(',\n')}\n};\n`;

    fs.writeFileSync(OUT_PATH, content, 'utf8');
    console.log('  Generated firebase-config.local.js from .env.local');
    return true;
}

// Run if called directly
if (require.main === module) {
    const ok = generate();
    process.exit(ok ? 0 : 1);
}

module.exports = { generate };
