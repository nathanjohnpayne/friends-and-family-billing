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
    it('renders brand, nav links, and user menu', () => {
        renderNavBar();
        expect(screen.getByRole('link', { name: /^Friends & Family Billing/ })).toBeInTheDocument();
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Manage')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
        // User menu shows display name (falls back to email username)
        expect(screen.getByText('alice')).toBeInTheDocument();
        // Sign Out is inside a dropdown, not visible until menu is opened
        expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument();
    });

    it('names the brand link by the full wordmark and keeps the visible FFB label in the name', () => {
        renderNavBar();
        // jsdom applies no shell.css, so both wordmark spans render: the name
        // then reads as the phone-width link does, full name plus the visible
        // "FFB" (WCAG 2.5.3 label in name). At wider widths "FFB" is
        // display: none and drops out. The logo mark stays decorative.
        const brand = screen.getByRole('link', { name: 'Friends & Family Billing FFB' });
        expect(brand).toHaveAttribute('href', '/');
        expect(screen.getByText('FFB')).not.toHaveAttribute('aria-hidden');
        expect(brand.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
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
