import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '@/app/App.jsx';

describe('AppRoutes', () => {
    it('renders the Phase 0 placeholder at /', () => {
        render(
            <MemoryRouter initialEntries={['/']}>
                <AppRoutes />
            </MemoryRouter>
        );
        expect(screen.getByText('Friends & Family Billing')).toBeInTheDocument();
        expect(screen.getByText(/Phase 0 scaffold/)).toBeInTheDocument();
    });

    it('redirects unknown routes to /', () => {
        render(
            <MemoryRouter initialEntries={['/unknown']}>
                <AppRoutes />
            </MemoryRouter>
        );
        expect(screen.getByText(/Dashboard/)).toBeInTheDocument();
    });
});
