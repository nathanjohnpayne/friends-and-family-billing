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

// Initialize Analytics
const analytics = firebase.analytics();

// Export auth, firestore, and analytics for use in other files
const auth = firebase.auth();
const db = firebase.firestore();
