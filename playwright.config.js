import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:4174',
        headless: true,
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
    webServer: {
        // Serve the production build with SPA fallback for /app/* routes.
        // `npm run test:e2e` builds before running.
        command: 'node scripts/e2e-server.mjs',
        port: 4174,
        reuseExistingServer: true,
        timeout: 10000,
    },
});
