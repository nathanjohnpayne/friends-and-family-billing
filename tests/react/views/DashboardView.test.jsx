import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// Mock Firebase (needed by ShareLinkDialog and useDisputes)
vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(), setDoc: vi.fn(), getDocs: vi.fn(() => Promise.resolve({ docs: [] })), collection: vi.fn(),
    query: vi.fn(), where: vi.fn(), deleteDoc: vi.fn(), serverTimestamp: vi.fn()
}));
vi.mock('firebase/storage', () => ({
    ref: vi.fn(), deleteObject: vi.fn()
}));

// Mock useBillingData with controllable state
const mockState = {
    activeYear: { id: '2026', label: '2026', status: 'open' },
    familyMembers: [
        { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
        { id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
    ],
    bills: [
        { id: 'b1', name: 'Internet', amount: 1200, billingFrequency: 'annual', members: [1, 2] }
    ],
    payments: [],
    billingEvents: [],
    settings: null,
    loading: false,
    error: null,
    service: { getState: vi.fn(() => ({ settings: {} })), recordPayment: vi.fn(), reversePayment: vi.fn(), setYearStatus: vi.fn() },
    saveQueue: { subscribe: vi.fn(() => () => {}) }
};

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => mockState)
}));

vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'test-user' } }))
}));

import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import DashboardView from '@/app/views/Dashboard/DashboardView.jsx';
import { useBillingData } from '@/app/hooks/useBillingData.js';

function renderDashboard(overrides = {}) {
    useBillingData.mockReturnValue({ ...mockState, ...overrides });
    return render(<MemoryRouter><ToastProvider><DashboardView /></ToastProvider></MemoryRouter>);
}

describe('DashboardView', () => {
    it('renders year pill without status badge', () => {
        renderDashboard();
        expect(screen.getByText('Billing Year 2026')).toBeInTheDocument();
        // "Open" appears once in the lifecycle bar only (badge removed)
        const openElements = screen.getAllByText('Open');
        expect(openElements.length).toBe(1);
        expect(screen.getByText('Planning in progress')).toBeInTheDocument();
    });

    it('renders KPI cards without Status card', () => {
        renderDashboard();
        expect(screen.getAllByText('Outstanding').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Settled').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Open Reviews')).toBeInTheDocument();
        expect(screen.getByText('Review requests')).toBeInTheDocument();
        // Open Reviews KPI shows real dispute count
        expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    });

    it('renders lifecycle bar with checkmarks on completed steps', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' }
        });
        // Open is completed — should have checkmark prefix
        expect(screen.getByText(/✓ Open/)).toBeInTheDocument();
        // Settling is active (current) — no checkmark
        expect(screen.getByText('Settling')).toBeInTheDocument();
        expect(screen.getByText('Closed')).toBeInTheDocument();
        expect(screen.getByText('Archived')).toBeInTheDocument();
    });

    it('renders progress bar and settlement message', () => {
        renderDashboard();
        expect(screen.getByText('0% settled')).toBeInTheDocument();
        expect(screen.getByText(/Review totals/)).toBeInTheDocument();
    });

    it('shows empty state when no members', () => {
        renderDashboard({ familyMembers: [] });
        expect(screen.getByText(/Add members and bills/)).toBeInTheDocument();
    });

    it('shows loading state', () => {
        renderDashboard({ loading: true });
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('shows settling status with progress', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [{ memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }]
        });
        expect(screen.getByText('Settlement in progress')).toBeInTheDocument();
    });

    it('shows Ready to Close when settling and all members paid', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
            ]
        });
        expect(screen.getByText('Settlement complete')).toBeInTheDocument();
    });

    // Lifecycle action button tests

    it('shows Start Settlement button when status is open', () => {
        renderDashboard();
        expect(screen.getByRole('button', { name: 'Start Settlement' })).toBeInTheDocument();
    });

    it('shows Close Year button with ready hint when ready to close', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
            ]
        });
        const btn = screen.getByRole('button', { name: 'Close Year' });
        expect(btn).toBeInTheDocument();
        expect(btn).not.toBeDisabled();
        expect(screen.getByText(/All members settled/)).toBeInTheDocument();
    });

    it('shows disabled Close Year button with hint when settling but not ready', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [{ memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }]
        });
        const btn = screen.getByRole('button', { name: 'Close Year' });
        expect(btn).toBeDisabled();
        expect(screen.getByText('1 member still outstanding')).toBeInTheDocument();
    });

    it('shows Archive Year button when status is closed', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'closed' }
        });
        expect(screen.getByRole('button', { name: 'Archive Year' })).toBeInTheDocument();
    });

    it('shows no action button when status is archived', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'archived' }
        });
        expect(screen.queryByRole('button', { name: 'Start Settlement' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Close Year' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Archive Year' })).not.toBeInTheDocument();
    });

    it('shows corrected headline when open and 100% settled', () => {
        renderDashboard({
            payments: [
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
            ]
        });
        expect(screen.getByText('Ready to start settlement')).toBeInTheDocument();
        expect(screen.queryByText('Planning in progress')).not.toBeInTheDocument();
    });

    // ──────────────── Owed to Members KPI (#316) ────────────────

    it('renders an "Owed to Members" KPI card distinct from Outstanding', () => {
        renderDashboard();
        // Scope to the KPI cards so the test verifies the dashboard KPI path,
        // not the same labels elsewhere on the page ("Outstanding" also appears
        // as settlement-board status badges).
        const owedCard = screen.getByText('Owed to Members').closest('.kpi-card');
        const outstandingCard = screen.getAllByText('Outstanding')
            .map(el => el.closest('.kpi-card'))
            .find(Boolean);
        expect(owedCard).not.toBeNull();
        expect(outstandingCard).not.toBeNull();
        expect(owedCard).not.toBe(outstandingCard);
    });

    it('"Owed to Members" KPI reflects the sum of unresolved household credits', () => {
        // Annual bill 1200 split two ways → 600 owed each. Bob overpays to 668.98 → 68.98 credit.
        renderDashboard({
            payments: [
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
                { memberId: 2, amount: 668.98, method: 'cash', note: '', date: new Date().toISOString() }
            ]
        });
        // Scope to the KPI card so the assertion verifies the dashboard KPI path,
        // not the same credit mirrored on Bob's settlement-board card.
        const owedCard = screen.getByText('Owed to Members').closest('.kpi-card');
        expect(owedCard).not.toBeNull();
        expect(within(owedCard).getByText('$68.98')).toBeInTheDocument();
    });
});
