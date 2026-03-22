import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    base: '/app/',
    root: '.',
    build: {
        // Output to app/ so deployed paths match URL paths.
        // Firebase Hosting serves from "public": "." — a file at ./app/assets/foo.js
        // is served at /app/assets/foo.js, which matches Vite's base: '/app/'.
        outDir: 'app',
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'src/app/index.html')
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src')
        }
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./tests/react/setup.js'],
        include: ['tests/react/**/*.test.{js,jsx}']
    }
});
