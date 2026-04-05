/**
 * Minimal static server with SPA fallback for E2E tests.
 * Serves the built app from app/ (the Firebase public directory).
 * All paths that don't match a static file fall back to
 * app/index.html (the React SPA entry point).
 */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = process.env.PORT || 4174;
const ROOT = join(process.cwd(), 'app');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

const SPA_INDEX = join(ROOT, 'index.html');

createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let filePath;

    // Try to serve the exact file from app/
    filePath = join(ROOT, url.pathname);
    if (existsSync(filePath) && !filePath.endsWith('/')) {
        const ext = extname(filePath);
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(readFileSync(filePath));
        return;
    }

    // SPA fallback: any path → app/index.html
    if (existsSync(SPA_INDEX)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(readFileSync(SPA_INDEX));
        return;
    }

    // 404 if index.html doesn't exist (build not run)
    res.writeHead(404);
    res.end('Not Found — run npm run build first');
}).listen(PORT, () => {
    console.log(`E2E server running at http://localhost:${PORT}/`);
});
