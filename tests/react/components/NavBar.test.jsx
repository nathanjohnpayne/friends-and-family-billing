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

    it('marks Dashboard as active at /dashboard', () => {
        renderNavBar('/dashboard');
        const link = screen.getByText('Dashboard');
        expect(link.className).toContain('active');
    });

    it('marks Manage as active at /manage', () => {
        renderNavBar('/manage');
        const link = screen.getByText('Manage');
        expect(link.className).toContain('active');
    });
});
