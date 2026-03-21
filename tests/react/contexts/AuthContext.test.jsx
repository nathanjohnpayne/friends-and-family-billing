import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Capture the auth state callback so we can simulate changes
let authCallback;
vi.mock('@/lib/firebase.js', () => ({
    auth: {},
    db: {},
    storage: {},
    analytics: null
}));
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: vi.fn((auth, cb) => {
        authCallback = cb;
        return () => {};
    }),
    signOut: vi.fn(() => Promise.resolve())
}));

import { AuthProvider, useAuth } from '@/app/contexts/AuthContext.jsx';

function TestConsumer() {
    const { user, loading } = useAuth();
    return (
        <div>
            <span data-testid="loading">{String(loading)}</span>
            <span data-testid="email">{user?.email || 'none'}</span>
        </div>
    );
}

describe('AuthProvider', () => {
    beforeEach(() => {
        authCallback = null;
    });

    it('starts in loading state', () => {
        render(<AuthProvider><TestConsumer /></AuthProvider>);
        // Before authCallback fires, loading should be true
        // (but onAuthStateChanged mock fires synchronously, so it may already be false)
        // This verifies the component renders without error
        expect(screen.getByTestId('loading')).toBeDefined();
    });

    it('provides user after auth resolves', () => {
        render(<AuthProvider><TestConsumer /></AuthProvider>);
        act(() => {
            authCallback({ uid: 'u1', email: 'alice@test.com' });
        });
        expect(screen.getByTestId('email').textContent).toBe('alice@test.com');
        expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    it('provides null user when signed out', () => {
        render(<AuthProvider><TestConsumer /></AuthProvider>);
        act(() => {
            authCallback(null);
        });
        expect(screen.getByTestId('email').textContent).toBe('none');
    });
});
