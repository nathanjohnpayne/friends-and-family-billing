import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:5174',
        headless: true,
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
    webServer: {
        command: 'npx vite --port 5174 --mode e2e',
        port: 5174,
        reuseExistingServer: false,
        timeout: 15000,
    },
});
