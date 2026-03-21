import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock useBillingData with controllable state
const mockState = {
    activeYear: { id: '2026', label: '2026', status: 'open' },
    familyMembers: [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ],
    bills: [
        { id: 'b1', name: 'Internet', amount: 1200, billingFrequency: 'annual', members: [1, 2] }
    ],
    payments: [],
    billingEvents: [],
    settings: null,
    loading: false,
    error: null,
    service: {},
    saveQueue: { subscribe: vi.fn(() => () => {}) }
};

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => mockState)
}));

import DashboardView from '@/app/views/Dashboard/DashboardView.jsx';
import { useBillingData } from '@/app/hooks/useBillingData.js';

describe('DashboardView', () => {
    it('renders year pill and status badge', () => {
        render(<DashboardView />);
        expect(screen.getByText('Billing Year 2026')).toBeInTheDocument();
        // "Open" appears in badge, lifecycle, and KPI — use getAllByText
        const openElements = screen.getAllByText('Open');
        expect(openElements.length).toBeGreaterThanOrEqual(2);
        // Status badge specifically
        expect(screen.getByText('Planning in progress')).toBeInTheDocument();
    });

    it('renders KPI cards', () => {
        render(<DashboardView />);
        expect(screen.getByText('Outstanding')).toBeInTheDocument();
        expect(screen.getByText('Settled')).toBeInTheDocument();
        expect(screen.getByText('Open Reviews')).toBeInTheDocument();
        expect(screen.getByText('Status')).toBeInTheDocument();
        // Open Reviews shows dash (not zero) since disputes aren't loaded yet
        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders lifecycle bar', () => {
        render(<DashboardView />);
        expect(screen.getByText('Settling')).toBeInTheDocument();
        expect(screen.getByText('Closed')).toBeInTheDocument();
        expect(screen.getByText('Archived')).toBeInTheDocument();
    });

    it('renders progress bar and settlement message', () => {
        render(<DashboardView />);
        expect(screen.getByText('0% settled')).toBeInTheDocument();
        expect(screen.getByText(/Review totals/)).toBeInTheDocument();
    });

    it('shows empty state when no members', () => {
        useBillingData.mockReturnValue({ ...mockState, familyMembers: [] });
        render(<DashboardView />);
        expect(screen.getByText(/Add members and bills/)).toBeInTheDocument();
        useBillingData.mockReturnValue(mockState);
    });

    it('shows loading state', () => {
        useBillingData.mockReturnValue({ ...mockState, loading: true });
        render(<DashboardView />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
        useBillingData.mockReturnValue(mockState);
    });

    it('shows settling status with progress', () => {
        useBillingData.mockReturnValue({
            ...mockState,
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [{ memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }]
        });
        render(<DashboardView />);
        expect(screen.getByText('Settlement in progress')).toBeInTheDocument();
        useBillingData.mockReturnValue(mockState);
    });

    it('shows Ready to Close when settling and all members paid', () => {
        // Bill is $1200 annual split 2 ways = $600 each. Pay $600 per member.
        useBillingData.mockReturnValue({
            ...mockState,
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
            ]
        });
        render(<DashboardView />);
        // "Ready to Close" appears in both badge and KPI card — use getAllByText
        const readyElements = screen.getAllByText('Ready to Close');
        expect(readyElements.length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Settlement complete')).toBeInTheDocument();
        useBillingData.mockReturnValue(mockState);
    });
});
