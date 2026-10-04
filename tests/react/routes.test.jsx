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
        expect(screen.queryByText('Sign in to continue')).toBeNull();
    });

    it('shows dashboard with nav bar when signed in', async () => {
        await renderAuthenticatedRoute(['/dashboard']);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
        // User menu shows username derived from email
        expect(screen.getByText('a')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /a/i })).toBeInTheDocument();
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
        expect(screen.getByText('Refund Notices')).toBeInTheDocument();
    });

    it('renders the Refund Notices tab at /manage/refunds', async () => {
        await renderAuthenticatedRoute(['/manage/refunds']);
        // The tab nav renders and the refunds route mounts under ManageView.
        // (The tab body itself depends on async billing state; its content is
        // covered by tests/react/views/RefundNoticesTab.test.jsx.)
        const tab = await screen.findByText('Refund Notices');
        expect(tab).toBeInTheDocument();
        expect(tab.getAttribute('href')).toContain('refunds');
    });

    it('renders settings view', async () => {
        await renderAuthenticatedRoute(['/settings']);
        expect(await screen.findByText('Settings')).toBeInTheDocument();
    });
});

// ── Email/password sign-up → verification notice after redirect ────

describe('Routes — sign-up verification notice survives the auth redirect', () => {
    beforeEach(() => {
        vi.resetModules();
        try { window.sessionStorage.clear(); } catch (_) { /* ignore */ }
    });

    it('shows the failed verification send, with a resend control, on the dashboard after sign-up', async () => {
        const { default: userEvent } = await import('@testing-library/user-event');
        let authCallback = null;
        const newUser = { uid: 'u9', email: 'new@example.com', emailVerified: false };
        vi.doMock('firebase/auth', () => ({
            onAuthStateChanged: vi.fn((_auth, cb) => { authCallback = cb; cb(null); return () => {}; }),
            signOut: vi.fn(), signInWithEmailAndPassword: vi.fn(),
            // Firebase signs the new account in as part of creating it.
            createUserWithEmailAndPassword: vi.fn(async () => { authCallback(newUser); return { user: newUser }; }),
            sendEmailVerification: vi.fn(() => Promise.reject(new Error('auth/network-request-failed'))),
            sendPasswordResetEmail: vi.fn(), signInWithPopup: vi.fn(), GoogleAuthProvider: vi.fn()
        }));

        const { AppRoutes } = await import('@/app/App.jsx');
        const { AuthProvider } = await import('@/app/contexts/AuthContext.jsx');
        const { ToastProvider } = await import('@/app/contexts/ToastContext.jsx');
        const user = userEvent.setup();
        render(
            <AuthProvider>
                <ToastProvider>
                    <MemoryRouter initialEntries={['/login']}>
                        <AppRoutes />
                    </MemoryRouter>
                </ToastProvider>
            </AuthProvider>
        );

        await user.click(screen.getByRole('button', { name: 'Create account' }));
        await user.type(screen.getByLabelText('Email'), 'new@example.com');
        await user.type(screen.getByLabelText('Password'), 'secret123');
        await user.type(screen.getByLabelText('Confirm Password'), 'secret123');
        await user.click(screen.getByRole('button', { name: 'Create Account' }));

        // GuestRoute redirected to the dashboard (LoginView is gone)...
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
        expect(screen.queryByText('Create your account')).toBeNull();
        // ...and the AppShell notice carries the failed-send message and a resend control.
        expect(await screen.findByText(/couldn.t send your verification email when you signed up/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeInTheDocument();
    });
});
