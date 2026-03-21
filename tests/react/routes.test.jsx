import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Shared mocks ────────────────────────────────────────────────────
vi.mock('@/lib/firebase.js', () => ({
    auth: {}, db: {}, storage: {}, analytics: null
}));
vi.mock('firebase/analytics', () => ({ logEvent: vi.fn() }));

// ── Unauthenticated user suite ──────────────────────────────────────

describe('Routes — unauthenticated user', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('redirects / to /login when not signed in', async () => {
        // Mock: onAuthStateChanged fires with null user
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => { cb(null); return () => {}; }),
            signOut: vi.fn(),
            signInWithEmailAndPassword: vi.fn(),
            createUserWithEmailAndPassword: vi.fn(),
            sendPasswordResetEmail: vi.fn(),
            signInWithPopup: vi.fn(),
            GoogleAuthProvider: vi.fn()
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

        // ProtectedRoute should redirect to login
        expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    });

    it('shows login page at /login when not signed in', async () => {
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => { cb(null); return () => {}; }),
            signOut: vi.fn(),
            signInWithEmailAndPassword: vi.fn(),
            createUserWithEmailAndPassword: vi.fn(),
            sendPasswordResetEmail: vi.fn(),
            signInWithPopup: vi.fn(),
            GoogleAuthProvider: vi.fn()
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

        // GuestRoute should allow access when not signed in
        expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    });
});

// ── Authenticated user suite ────────────────────────────────────────

describe('Routes — authenticated user', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('redirects /login to / when signed in (GuestRoute)', async () => {
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => {
                cb({ uid: 'u1', email: 'a@b.com' });
                return () => {};
            }),
            signOut: vi.fn(),
            signInWithEmailAndPassword: vi.fn(),
            createUserWithEmailAndPassword: vi.fn(),
            sendPasswordResetEmail: vi.fn(),
            signInWithPopup: vi.fn(),
            GoogleAuthProvider: vi.fn()
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
        expect(screen.getByText(/Phase 0 scaffold/)).toBeInTheDocument();
        expect(screen.queryByText('Sign in to continue')).toBeNull();
    });

    it('shows dashboard at / when signed in', async () => {
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => {
                cb({ uid: 'u1', email: 'a@b.com' });
                return () => {};
            }),
            signOut: vi.fn(),
            signInWithEmailAndPassword: vi.fn(),
            createUserWithEmailAndPassword: vi.fn(),
            sendPasswordResetEmail: vi.fn(),
            signInWithPopup: vi.fn(),
            GoogleAuthProvider: vi.fn()
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

        expect(screen.getByText('Friends & Family Billing')).toBeInTheDocument();
        expect(screen.getByText('a@b.com')).toBeInTheDocument();
    });
});
