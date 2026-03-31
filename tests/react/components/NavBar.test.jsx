import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/firebase.js', () => ({ auth: {}, db: {}, storage: {}, analytics: null }));
vi.mock('firebase/auth', () => ({
    onAuthStateChanged: vi.fn((auth, cb) => {
        cb({ uid: 'u1', email: 'alice@test.com' });
        return () => {};
    }),
    signOut: vi.fn()
}));

import NavBar from '@/app/components/NavBar.jsx';
import { AuthProvider } from '@/app/contexts/AuthContext.jsx';

function renderNavBar(route = '/') {
    return render(
        <AuthProvider>
            <MemoryRouter initialEntries={[route]}>
                <NavBar />
            </MemoryRouter>
        </AuthProvider>
    );
}

describe('NavBar', () => {
    it('renders brand, nav links, and user email', () => {
        renderNavBar();
        expect(screen.getByText('FFB')).toBeInTheDocument();
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Manage')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
        expect(screen.getByText('alice@test.com')).toBeInTheDocument();
        expect(screen.getByText('Sign Out')).toBeInTheDocument();
    });

    it('renders Dashboard link at /dashboard', () => {
        renderNavBar('/dashboard');
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        // The link has aria-current="page" when active
        const link = screen.getByText('Dashboard').closest('a');
        expect(link).toHaveAttribute('aria-current', 'page');
    });

    it('renders Manage link at /manage', () => {
        renderNavBar('/manage');
        const link = screen.getByText('Manage').closest('a');
        expect(link).toHaveAttribute('aria-current', 'page');
    });
});
