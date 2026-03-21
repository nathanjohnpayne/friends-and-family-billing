import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    base: '/app/',
    root: '.',
    build: {
        outDir: 'dist',
        emptyDirFirst: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'app/index.html')
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
