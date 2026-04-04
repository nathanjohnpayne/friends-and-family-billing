import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '@/lib/firebase.js';

const AuthContext = createContext(null);

/**
 * AuthProvider — wraps the app and provides auth state to all children.
 * Listens to Firebase onAuthStateChanged and exposes { user, loading, signOut }.
 */
export function AuthProvider({ children }) {
    const isE2E = typeof window !== 'undefined' && window.__E2E_USER__;
    const [user, setUser] = useState(isE2E ? window.__E2E_USER__ : null);
    const [loading, setLoading] = useState(!isE2E);

    useEffect(() => {
        // E2E mode: user is already set from initial state, skip Firebase auth
        if (isE2E) return;
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    const signOut = () => firebaseSignOut(auth);

    return (
        <AuthContext.Provider value={{ user, loading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

/**
 * useAuth — returns { user, loading, signOut }.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}
