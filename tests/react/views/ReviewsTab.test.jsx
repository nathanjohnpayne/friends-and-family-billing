import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock Firebase (needed by useDisputes)
vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), doc: vi.fn(), getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
    setDoc: vi.fn(), serverTimestamp: vi.fn(), deleteDoc: vi.fn()
}));
vi.mock('firebase/storage', () => ({
    ref: vi.fn(), deleteObject: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn()
}));

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => ({
        familyMembers: [
            { id: 1, name: 'Alice', email: 'alice@test.com', phone: '+14155551212', avatar: '', linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [] }
        ],
        activeYear: { id: '2026', label: '2026', status: 'settling' },
        loading: false,
        service: { getState: vi.fn(() => ({ settings: {} })) },
        saveQueue: { subscribe: vi.fn(() => () => {}) }
    }))
}));

const mockDisputes = [
    {
        id: 'd1', billName: 'Internet', billId: 'b1', memberId: 1, memberName: 'Alice',
        message: 'Bill seems high', proposedCorrection: '$90 instead of $100',
        status: 'open', createdAt: '2026-03-01T00:00:00Z', evidence: [
            { name: 'receipt.pdf', size: 1024, url: 'https://example.com/receipt.pdf' }
        ]
    },
    {
        id: 'd2', billName: 'Electric', billId: 'b2', memberId: 2, memberName: 'Bob',
        message: 'Wrong amount', status: 'resolved', createdAt: '2026-02-15T00:00:00Z',
        resolvedAt: '2026-02-20T00:00:00Z', resolutionNote: 'Corrected', evidence: []
    },
    {
        id: 'd3', billName: 'Gas', billId: 'b3', memberId: 1, memberName: 'Alice',
        message: 'Not my bill', status: 'in_review', createdAt: '2026-03-10T00:00:00Z',
        evidence: []
    }
];

// Mock useDisputes to return test data
vi.mock('@/app/hooks/useDisputes.js', () => ({
    useDisputes: vi.fn(() => ({
        disputes: mockDisputes,
        loading: false,
        error: null,
        reload: vi.fn(),
        updateDispute: vi.fn(),
        removeEvidence: vi.fn()
    }))
}));

import { useDisputes } from '@/app/hooks/useDisputes.js';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import ReviewsTab from '@/app/views/Manage/ReviewsTab.jsx';

function renderTab() {
    return render(<ToastProvider><ReviewsTab /></ToastProvider>);
}

describe('ReviewsTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useDisputes.mockReturnValue({
            disputes: mockDisputes,
            loading: false,
            error: null,
            reload: vi.fn(),
            updateDispute: vi.fn(),
            removeEvidence: vi.fn()
        });
    });

    it('renders dispute count in header', () => {
        renderTab();
        expect(screen.getByText('Review Requests (3)')).toBeInTheDocument();
    });

    it('renders filter bar with counts', () => {
        renderTab();
        // Actionable: open + in_review = 2
        const buttons = screen.getAllByRole('button');
        const actionableBtn = buttons.find(b => b.textContent.includes('Actionable'));
        expect(actionableBtn).toBeDefined();
    });

    it('shows dispute cards', () => {
        renderTab();
        expect(screen.getByText('Internet')).toBeInTheDocument();
        expect(screen.getByText('Gas')).toBeInTheDocument();
    });

    it('default filter shows actionable disputes only', () => {
        renderTab();
        // Open + In Review shown, Resolved hidden
        expect(screen.getByText('Internet')).toBeInTheDocument(); // open
        expect(screen.getByText('Gas')).toBeInTheDocument(); // in_review
        expect(screen.queryByText('Electric')).toBeNull(); // resolved — filtered out
    });

    it('shows all disputes when All filter clicked', () => {
        renderTab();
        const allBtn = screen.getAllByRole('button').find(b => b.textContent.includes('All'));
        fireEvent.click(allBtn);
        expect(screen.getByText('Internet')).toBeInTheDocument();
        expect(screen.getByText('Electric')).toBeInTheDocument();
        expect(screen.getByText('Gas')).toBeInTheDocument();
    });

    it('shows evidence badge on card', () => {
        renderTab();
        expect(screen.getByText('1 file')).toBeInTheDocument();
    });

    it('shows message excerpt on card', () => {
        renderTab();
        expect(screen.getByText('Bill seems high')).toBeInTheDocument();
    });

    it('shows proposed correction on card', () => {
        renderTab();
        expect(screen.getByText(/\$90 instead of \$100/)).toBeInTheDocument();
    });

    it('opens detail dialog on card click', () => {
        renderTab();
        fireEvent.click(screen.getByText('Internet'));
        // Detail dialog should show resolution note textarea
        expect(screen.getByPlaceholderText('Add a resolution note...')).toBeInTheDocument();
    });

    it('shows empty state when no disputes', () => {
        useDisputes.mockReturnValue({
            disputes: [], loading: false, error: null,
            reload: vi.fn(), updateDispute: vi.fn(), removeEvidence: vi.fn()
        });
        renderTab();
        expect(screen.getByText('No review requests')).toBeInTheDocument();
    });

    it('shows loading state', () => {
        useDisputes.mockReturnValue({
            disputes: [], loading: true, error: null,
            reload: vi.fn(), updateDispute: vi.fn(), removeEvidence: vi.fn()
        });
        renderTab();
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('shows error state', () => {
        useDisputes.mockReturnValue({
            disputes: [], loading: false, error: 'Network error',
            reload: vi.fn(), updateDispute: vi.fn(), removeEvidence: vi.fn()
        });
        renderTab();
        expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
});
