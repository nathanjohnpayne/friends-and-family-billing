import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock Firebase (needed by InvoicingTab for share link generation)
vi.mock('@/lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(), setDoc: vi.fn(), serverTimestamp: vi.fn()
}));

// Mock auth
vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'test-user' } }))
}));

const mockService = {
    updateSettings: vi.fn(),
    getState: vi.fn(() => ({
        settings: {
            emailMessage: 'Your total is %household_total%.',
            paymentMethods: [
                { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, handle: '@test', url: '', email: '', phone: '', instructions: '' }
            ]
        }
    }))
};

const mockState = {
    familyMembers: [
        { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
        { id: 2, name: 'Bob', email: 'bob@test.com', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
    ],
    bills: [
        { id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }
    ],
    payments: [],
    activeYear: { id: '2026', label: '2026', status: 'open' },
    loading: false,
    service: mockService,
    saveQueue: { subscribe: vi.fn(() => () => {}) }
};

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => mockState)
}));

import { useBillingData } from '@/app/hooks/useBillingData.js';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import InvoicingTab from '@/app/views/Manage/InvoicingTab.jsx';

function renderTab(overrides = {}) {
    if (Object.keys(overrides).length > 0) {
        useBillingData.mockReturnValue({ ...mockState, ...overrides });
    }
    return render(<ToastProvider><InvoicingTab /></ToastProvider>);
}

describe('InvoicingTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useBillingData.mockReturnValue(mockState);
    });

    it('renders email template section', () => {
        renderTab();
        expect(screen.getByText('Email Template')).toBeInTheDocument();
    });

    it('does not render payment methods section (moved to Settings)', () => {
        renderTab();
        // Payment Methods may appear as a token chip label but not as a section heading
        expect(screen.queryByText('Add Payment Method')).toBeNull();
    });

    it('shows TipTap editor', () => {
        renderTab();
        // TipTap renders a .ProseMirror contenteditable element inside the editor
        const prosemirror = document.querySelector('.ProseMirror');
        expect(prosemirror).toBeInTheDocument();
    });

    it('shows token insert buttons', () => {
        renderTab();
        expect(screen.getAllByText('Billing Year').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Household Total').length).toBeGreaterThanOrEqual(1);
    });

    it('shows Edit and Preview tabs', () => {
        renderTab();
        expect(screen.getByText('Edit')).toBeInTheDocument();
        expect(screen.getByText('Preview')).toBeInTheDocument();
    });

    it('shows preview with To and Subject when Preview tab is clicked', () => {
        renderTab();
        fireEvent.click(screen.getByText('Preview'));
        expect(screen.getByText('To')).toBeInTheDocument();
        expect(screen.getByText('Subject')).toBeInTheDocument();
    });

    it('shows save button', () => {
        renderTab();
        const saveBtn = screen.getByText('Save Template');
        expect(saveBtn).toBeInTheDocument();
    });

    it('hides save button when year is read-only', () => {
        renderTab({ activeYear: { id: '2024', label: '2024', status: 'archived' } });
        expect(screen.queryByText('Save Template')).toBeNull();
    });

    it('shows duplicate payment text warning', () => {
        mockService.getState.mockReturnValue({
            settings: {
                emailMessage: 'Pay via Venmo %payment_methods%',
                paymentMethods: []
            }
        });
        renderTab();
        expect(screen.getByText(/duplicate payment information/)).toBeInTheDocument();
    });

    it('shows member selector in preview tab', () => {
        renderTab();
        fireEvent.click(screen.getByText('Preview'));
        const selector = screen.getByLabelText('Preview for:');
        expect(selector).toBeInTheDocument();
        // Should have options for each family member
        const options = selector.querySelectorAll('option');
        expect(options.length).toBe(2);
    });

    it('shows dirty indicator when template is modified', () => {
        renderTab();
        // Initially no dirty indicator
        expect(screen.queryByText('Unsaved changes')).toBeNull();
    });
});
