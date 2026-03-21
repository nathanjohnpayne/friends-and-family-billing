import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Shared mocks ────────────────────────────────────────────────────
vi.mock('@/lib/firebase.js', () => ({
    auth: {}, db: {}, storage: {}, analytics: null
}));
vi.mock('firebase/analytics', () => ({ logEvent: vi.fn() }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), doc: vi.fn(), getDocs: vi.fn(),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
    setDoc: vi.fn(() => Promise.resolve()), serverTimestamp: vi.fn()
}));

// ── Unauthenticated user suite ──────────────────────────────────────

describe('Routes — unauthenticated user', () => {
    beforeEach(() => { vi.resetModules(); });

    it('redirects / to /login when not signed in', async () => {
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => { cb(null); return () => {}; }),
            signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(),
            createUserWithEmailAndPassword: vi.fn(), sendPasswordResetEmail: vi.fn(),
            signInWithPopup: vi.fn(), GoogleAuthProvider: vi.fn()
        }));

        const { AppRoutes } = await import('@/app/App.jsx');
        const { AuthProvider } = await import('@/app/contexts/AuthContext.jsx');

        render(
            <AuthProvider>
                <MemoryRouter initialEntries={['/']}>
                    <AppRoutes />
                </MemoryRouter>
            </AuthProvider>
        );

        expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    });

    it('shows login page at /login when not signed in', async () => {
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => { cb(null); return () => {}; }),
            signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(),
            createUserWithEmailAndPassword: vi.fn(), sendPasswordResetEmail: vi.fn(),
            signInWithPopup: vi.fn(), GoogleAuthProvider: vi.fn()
        }));

        const { AppRoutes } = await import('@/app/App.jsx');
        const { AuthProvider } = await import('@/app/contexts/AuthContext.jsx');

        render(
            <AuthProvider>
                <MemoryRouter initialEntries={['/login']}>
                    <AppRoutes />
                </MemoryRouter>
            </AuthProvider>
        );

        expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    });
});

// ── Authenticated user suite ────────────────────────────────────────

describe('Routes — authenticated user', () => {
    beforeEach(() => { vi.resetModules(); });

    it('redirects /login to /dashboard when signed in (GuestRoute)', async () => {
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => {
                cb({ uid: 'u1', email: 'a@b.com' }); return () => {};
            }),
            signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(),
            createUserWithEmailAndPassword: vi.fn(), sendPasswordResetEmail: vi.fn(),
            signInWithPopup: vi.fn(), GoogleAuthProvider: vi.fn()
        }));

        const { AppRoutes } = await import('@/app/App.jsx');
        const { AuthProvider } = await import('@/app/contexts/AuthContext.jsx');

        render(
            <AuthProvider>
                <MemoryRouter initialEntries={['/login']}>
                    <AppRoutes />
                </MemoryRouter>
            </AuthProvider>
        );

        // Should be redirected to dashboard, not see login form
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.queryByText('Sign in to continue')).toBeNull();
    });

    it('shows dashboard with nav bar when signed in', async () => {
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => {
                cb({ uid: 'u1', email: 'a@b.com' }); return () => {};
            }),
            signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(),
            createUserWithEmailAndPassword: vi.fn(), sendPasswordResetEmail: vi.fn(),
            signInWithPopup: vi.fn(), GoogleAuthProvider: vi.fn()
        }));

        const { AppRoutes } = await import('@/app/App.jsx');
        const { AuthProvider } = await import('@/app/contexts/AuthContext.jsx');

        render(
            <AuthProvider>
                <MemoryRouter initialEntries={['/dashboard']}>
                    <AppRoutes />
                </MemoryRouter>
            </AuthProvider>
        );

        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('a@b.com')).toBeInTheDocument();
        expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });
});
