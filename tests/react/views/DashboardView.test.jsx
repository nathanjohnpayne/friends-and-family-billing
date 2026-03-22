import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
    service: { getState: vi.fn(() => ({ settings: {} })), recordPayment: vi.fn(), reversePayment: vi.fn() },
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
    if (Object.keys(overrides).length > 0) {
        useBillingData.mockReturnValue({ ...mockState, ...overrides });
    }
    return render(<MemoryRouter><ToastProvider><DashboardView /></ToastProvider></MemoryRouter>);
}

describe('DashboardView', () => {
    it('renders year pill and status badge', () => {
        renderDashboard();
        expect(screen.getByText('Billing Year 2026')).toBeInTheDocument();
        // "Open" appears in badge, lifecycle, and KPI — use getAllByText
        const openElements = screen.getAllByText('Open');
        expect(openElements.length).toBeGreaterThanOrEqual(2);
        // Status badge specifically
        expect(screen.getByText('Planning in progress')).toBeInTheDocument();
    });

    it('renders KPI cards', () => {
        renderDashboard();
        // "Outstanding" appears in KPI label + filter chip + status badges — use getAllByText
        expect(screen.getAllByText('Outstanding').length).toBeGreaterThanOrEqual(1);
        // "Settled" appears in KPI + filter chip — check KPI label exists
        const kpiLabels = document.querySelectorAll('.kpi-label');
        const labelTexts = Array.from(kpiLabels).map(el => el.textContent);
        expect(labelTexts).toContain('Outstanding');
        expect(labelTexts).toContain('Settled');
        expect(labelTexts).toContain('Open Reviews');
        expect(labelTexts).toContain('Status');
        // Open Reviews now shows real dispute count
        const kpiValues = document.querySelectorAll('.kpi-value');
        const reviewKpiIndex = labelTexts.indexOf('Open Reviews');
        expect(kpiValues[reviewKpiIndex].textContent).toBe('0');
    });

    it('renders lifecycle bar', () => {
        renderDashboard();
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
        const readyElements = screen.getAllByText('Ready to Close');
        expect(readyElements.length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Settlement complete')).toBeInTheDocument();
    });
});
