const hasInitializedApp = Array.isArray(firebase.apps) && firebase.apps.length > 0;

if (!hasInitializedApp) {
    const firebaseConfig = {
        apiKey: "YOUR_API_KEY",
        authDomain: "friends-and-family-billing.firebaseapp.com",
        projectId: "friends-and-family-billing",
        storageBucket: "friends-and-family-billing.firebasestorage.app",
        messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
        appId: "YOUR_APP_ID",
        measurementId: "YOUR_MEASUREMENT_ID",
        ...(window.__FIREBASE_CONFIG__ || {})
    };

    if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
        throw new Error("Missing Firebase web config. Copy firebase-config.local.example.js to firebase-config.local.js before running or deploying.");
    }

    firebase.initializeApp(firebaseConfig);
}

// Initialize Analytics (guard for pages that don't load the analytics SDK)
window.analytics = (typeof firebase.analytics === 'function') ? firebase.analytics() : null;

// Export auth, firestore, and storage for use in other files
window.auth = (typeof firebase.auth === 'function') ? firebase.auth() : null;
window.db = (typeof firebase.firestore === 'function') ? firebase.firestore() : null;
window.storage = (typeof firebase.storage === 'function') ? firebase.storage() : null;
