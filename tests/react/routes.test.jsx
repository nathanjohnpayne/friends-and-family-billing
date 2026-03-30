import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Shared mocks ────────────────────────────────────────────────────
vi.mock('@/lib/firebase.js', () => ({
    auth: {}, db: {}, storage: {}, analytics: null
}));
vi.mock('firebase/analytics', () => ({ logEvent: vi.fn() }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), doc: vi.fn(), getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
    setDoc: vi.fn(() => Promise.resolve()), serverTimestamp: vi.fn(),
    query: vi.fn(), where: vi.fn(), deleteDoc: vi.fn()
}));
vi.mock('firebase/storage', () => ({
    ref: vi.fn(), deleteObject: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn()
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

        expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
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

        expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    });
});

// ── Authenticated user suite ────────────────────────────────────────

describe('Routes — authenticated user', () => {
    beforeEach(() => { vi.resetModules(); });

    function mockAuthenticatedUser(email = 'a@b.com') {
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => {
                cb({ uid: 'u1', email }); return () => {};
            }),
            signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(),
            createUserWithEmailAndPassword: vi.fn(), sendPasswordResetEmail: vi.fn(),
            signInWithPopup: vi.fn(), GoogleAuthProvider: vi.fn()
        }));
    }

    async function renderAuthenticatedRoute(entries) {
        mockAuthenticatedUser();
        const { AppRoutes } = await import('@/app/App.jsx');
        const { AuthProvider } = await import('@/app/contexts/AuthContext.jsx');
        const { ToastProvider } = await import('@/app/contexts/ToastContext.jsx');

        return render(
            <AuthProvider>
                <ToastProvider>
                    <MemoryRouter initialEntries={entries}>
                        <AppRoutes />
                    </MemoryRouter>
                </ToastProvider>
            </AuthProvider>
        );
    }

    it('redirects /login to /dashboard when signed in (GuestRoute)', async () => {
        await renderAuthenticatedRoute(['/login']);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
    });

    it('shows dashboard with nav bar when signed in', async () => {
        await renderAuthenticatedRoute(['/dashboard']);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('a@b.com')).toBeInTheDocument();
        expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });

    it('redirects / to /dashboard and renders nav', async () => {
        await renderAuthenticatedRoute(['/']);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Manage')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('redirects unknown routes to /dashboard', async () => {
        await renderAuthenticatedRoute(['/unknown']);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    });

    it('renders manage view with tab navigation', async () => {
        await renderAuthenticatedRoute(['/manage/members']);
        expect(await screen.findByText('Members')).toBeInTheDocument();
        expect(screen.getByText('Bills')).toBeInTheDocument();
        expect(screen.getByText('Invoicing')).toBeInTheDocument();
        expect(screen.getByText('Review Requests')).toBeInTheDocument();
    });

    it('renders settings view', async () => {
        await renderAuthenticatedRoute(['/settings']);
        expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    });
});
