/**
 * Modular Firebase initialization for the React app.
 *
 * Reads config from Vite environment variables (VITE_FIREBASE_*).
 * Values come from .env.local (gitignored, created from .env.example).
 */
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';

function getConfig() {
    // Prefer Vite env vars; fall back to window.__FIREBASE_CONFIG__ for backward compat
    const env = import.meta.env || {};
    if (env.VITE_FIREBASE_API_KEY) {
        return {
            apiKey: env.VITE_FIREBASE_API_KEY,
            authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: env.VITE_FIREBASE_APP_ID,
            measurementId: env.VITE_FIREBASE_MEASUREMENT_ID
        };
    }
    // Legacy fallback (window.__FIREBASE_CONFIG__)
    const config = typeof window !== 'undefined' && window.__FIREBASE_CONFIG__;
    if (config && config.apiKey && config.apiKey !== 'YOUR_API_KEY') {
        return config;
    }
    throw new Error(
        'Missing Firebase config. Ensure .env.local exists with VITE_FIREBASE_* variables.'
    );
}

const app = initializeApp(getConfig());

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Analytics — guarded for environments where it's unsupported (SSR, tests)
export let analytics = null;
isAnalyticsSupported().then(supported => {
    if (supported) analytics = getAnalytics(app);
}).catch(() => {});

// Emulator support — connect when running locally with emulators
if (import.meta.env?.DEV && import.meta.env?.VITE_USE_EMULATORS === 'true') {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectStorageEmulator(storage, 'localhost', 9199);
}

export default app;
