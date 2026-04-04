/**
 * Modular Firebase initialization for the React app.
 *
 * Reads config from window.__FIREBASE_CONFIG__ (set by firebase-config.local.js
 * loaded via <script> tag in index.html). This keeps firebase-config.local.js
 * as the single source of truth for both the legacy and React apps.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';

function getConfig() {
    // E2E tests run without firebase-config.local.js — use a dummy config
    if (import.meta.env.VITE_E2E_MODE) {
        return {
            apiKey: 'e2e-test-key',
            authDomain: 'e2e-test.firebaseapp.com',
            projectId: 'e2e-test',
            storageBucket: 'e2e-test.appspot.com',
            messagingSenderId: '000000000000',
            appId: '1:000000000000:web:0000000000000000',
        };
    }
    const config = window.__FIREBASE_CONFIG__;
    if (!config || !config.apiKey || config.apiKey === 'YOUR_API_KEY') {
        throw new Error(
            'Missing Firebase config. Ensure firebase-config.local.js is loaded ' +
            'before the React app and sets window.__FIREBASE_CONFIG__.'
        );
    }
    return config;
}

const app = initializeApp(getConfig());

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Analytics — guarded for environments where it's unsupported (SSR, tests, E2E)
export let analytics = null;
if (!import.meta.env.VITE_E2E_MODE) {
    isAnalyticsSupported().then(supported => {
        if (supported) analytics = getAnalytics(app);
    }).catch(() => {});
}

// Emulator support — connect when running locally with emulators
if (import.meta.env?.DEV && import.meta.env?.VITE_USE_EMULATORS === 'true') {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectStorageEmulator(storage, 'localhost', 9199);
}

export default app;
