// Firebase Configuration
const firebaseConfig = {
    apiKey: "REDACTED_FIREBASE_API_KEY",
    authDomain: "friends-and-family-billing.firebaseapp.com",
    projectId: "friends-and-family-billing",
    storageBucket: "friends-and-family-billing.firebasestorage.app",
    messagingSenderId: "628192337774",
    appId: "1:628192337774:web:197f510eff349315502b7f",
    measurementId: "G-FEQYRRNF43"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Analytics (guard for pages that don't load the analytics SDK)
window.analytics = (typeof firebase.analytics === 'function') ? firebase.analytics() : null;

// Export auth, firestore, and storage for use in other files
window.auth = (typeof firebase.auth === 'function') ? firebase.auth() : null;
window.db = (typeof firebase.firestore === 'function') ? firebase.firestore() : null;
window.storage = (typeof firebase.storage === 'function') ? firebase.storage() : null;
