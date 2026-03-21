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

// Mock Firestore (used by BillingYearService)
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
    setDoc: vi.fn(() => Promise.resolve()),
    serverTimestamp: vi.fn()
}));

// Import after mocks
import { AppRoutes } from '@/app/App.jsx';
import { AuthProvider } from '@/app/contexts/AuthContext.jsx';

function renderWithAuth(initialEntries = ['/']) {
    return render(
        <AuthProvider>
            <MemoryRouter initialEntries={initialEntries}>
                <AppRoutes />
            </MemoryRouter>
        </AuthProvider>
    );
}

describe('AppRoutes (authenticated)', () => {
    it('redirects / to /dashboard and renders nav', () => {
        renderWithAuth(['/']);
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Manage')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('renders the nav bar with user email', () => {
        renderWithAuth(['/dashboard']);
        expect(screen.getByText('test@example.com')).toBeInTheDocument();
        expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });

    it('redirects authenticated users from /login to /dashboard', () => {
        renderWithAuth(['/login']);
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('redirects unknown routes to /dashboard', () => {
        renderWithAuth(['/unknown']);
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('renders manage view with tab navigation', () => {
        renderWithAuth(['/manage/members']);
        expect(screen.getByText('Members')).toBeInTheDocument();
        expect(screen.getByText('Bills')).toBeInTheDocument();
        expect(screen.getByText('Invoicing')).toBeInTheDocument();
        expect(screen.getByText('Review Requests')).toBeInTheDocument();
    });

    it('renders settings view with billing year selector', () => {
        renderWithAuth(['/settings']);
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });
});
