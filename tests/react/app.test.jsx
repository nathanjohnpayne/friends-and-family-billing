import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock Firebase so tests don't need real config
vi.mock('@/lib/firebase.js', () => ({
    auth: {},
    db: {},
    storage: {},
    analytics: null
}));

// Mock Firebase auth functions
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: vi.fn((auth, cb) => {
        cb({ uid: 'test-uid', email: 'test@example.com' });
        return () => {};
    }),
    signOut: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    signInWithPopup: vi.fn(),
    GoogleAuthProvider: vi.fn()
}));

// Mock Firebase analytics
vi.mock('firebase/analytics', () => ({
    logEvent: vi.fn()
}));

// Mock Firestore (used by BillingYearService and useDisputes)
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
    setDoc: vi.fn(() => Promise.resolve()),
    serverTimestamp: vi.fn(),
    query: vi.fn(), where: vi.fn(), deleteDoc: vi.fn()
}));

vi.mock('firebase/storage', () => ({
    ref: vi.fn(), deleteObject: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn()
}));

// Import after mocks
import { AppRoutes } from '@/app/App.jsx';
import { AuthProvider } from '@/app/contexts/AuthContext.jsx';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';

function renderWithAuth(initialEntries = ['/']) {
    return render(
        <AuthProvider>
            <ToastProvider>
                <MemoryRouter initialEntries={initialEntries}>
                    <AppRoutes />
                </MemoryRouter>
            </ToastProvider>
        </AuthProvider>
    );
}

describe('AppRoutes (authenticated)', () => {
    it('redirects / to /dashboard and renders nav', async () => {
        renderWithAuth(['/']);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Manage')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('renders the nav bar with user email', async () => {
        renderWithAuth(['/dashboard']);
        expect(await screen.findByText('test@example.com')).toBeInTheDocument();
        expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });

    it('redirects authenticated users from /login to /dashboard', async () => {
        renderWithAuth(['/login']);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    });

    it('redirects unknown routes to /dashboard', async () => {
        renderWithAuth(['/unknown']);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    });

    it('renders manage view with tab navigation', async () => {
        renderWithAuth(['/manage/members']);
        expect(await screen.findByText('Members')).toBeInTheDocument();
        expect(screen.getByText('Bills')).toBeInTheDocument();
        expect(screen.getByText('Invoicing')).toBeInTheDocument();
        expect(screen.getByText('Review Requests')).toBeInTheDocument();
    });

    it('renders settings view with billing year selector', async () => {
        renderWithAuth(['/settings']);
        expect(await screen.findByText('Settings')).toBeInTheDocument();
    });
});
