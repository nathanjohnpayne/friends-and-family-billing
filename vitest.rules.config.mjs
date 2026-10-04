import { defineConfig } from 'vitest/config';

// Firestore security-rules suite. These tests talk to the Firestore emulator
// over the network, so they run in Node (not jsdom) and are kept out of the
// default `npm test` run. Run them with `npm run test:rules`, which wraps this
// config in `firebase emulators:exec` (see scripts/test-rules.sh).
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/rules/**/*.test.js'],
        testTimeout: 20000,
        hookTimeout: 30000,
        // One shared emulator; clearFirestore() in one file must not race another.
        fileParallelism: false,
    },
});
