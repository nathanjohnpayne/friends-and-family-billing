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
        // Simulate authenticated user
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

describe('AppRoutes', () => {
    it('renders the dashboard placeholder when authenticated', () => {
        renderWithAuth(['/']);
        expect(screen.getByText('Friends & Family Billing')).toBeInTheDocument();
        expect(screen.getByText(/Phase 0 scaffold/)).toBeInTheDocument();
    });

    it('redirects authenticated users from /login to /', () => {
        renderWithAuth(['/login']);
        // GuestRoute should redirect to dashboard, not show login
        expect(screen.getByText(/Phase 0 scaffold/)).toBeInTheDocument();
    });

    it('redirects unknown routes to /', () => {
        renderWithAuth(['/unknown']);
        expect(screen.getByText(/Phase 0 scaffold/)).toBeInTheDocument();
    });
});
