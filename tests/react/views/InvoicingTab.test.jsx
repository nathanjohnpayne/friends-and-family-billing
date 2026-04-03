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

    it('renders hint text and tab bar', () => {
        renderTab();
        expect(screen.getByText(/insert billing fields/i)).toBeInTheDocument();
        expect(screen.getByText('Edit')).toBeInTheDocument();
        expect(screen.getByText('Preview')).toBeInTheDocument();
    });

    it('does not render payment methods section (moved to Settings)', () => {
        renderTab();
        expect(screen.queryByText('Add Payment Method')).toBeNull();
    });

    it('shows TipTap editor', () => {
        renderTab();
        const prosemirror = document.querySelector('.ProseMirror');
        expect(prosemirror).toBeInTheDocument();
    });

    it('shows unified token insert chips', () => {
        renderTab();
        expect(screen.getAllByText('Billing Year').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Household Total').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Payment Methods').length).toBeGreaterThanOrEqual(1);
    });

    it('shows Edit and Preview tabs', () => {
        renderTab();
        expect(screen.getByText('Edit')).toBeInTheDocument();
        expect(screen.getByText('Preview')).toBeInTheDocument();
    });

    it('shows preview metadata when Preview tab is clicked', () => {
        renderTab();
        fireEvent.click(screen.getByText('Preview'));
        // Preview metadata grid has To and Link labels
        const previewMeta = document.querySelector('.template-preview-meta');
        expect(previewMeta).toBeInTheDocument();
        expect(previewMeta.textContent).toContain('To');
        expect(previewMeta.textContent).toContain('Link');
    });

    it('shows save button in edit tab', () => {
        renderTab();
        expect(screen.getByText('Save template')).toBeInTheDocument();
    });

    it('hides save button when year is read-only', () => {
        renderTab({ activeYear: { id: '2024', label: '2024', status: 'archived' } });
        expect(screen.queryByText('Save template')).toBeNull();
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
        const selector = document.querySelector('.template-preview-member-sel');
        expect(selector).toBeInTheDocument();
        const options = selector.querySelectorAll('option');
        expect(options.length).toBe(2);
    });

    it('shows send test email button in preview tab', () => {
        renderTab();
        fireEvent.click(screen.getByText('Preview'));
        expect(screen.getByText('Send test email')).toBeInTheDocument();
    });

    it('does not show dirty indicator initially', () => {
        renderTab();
        expect(screen.queryByText('Unsaved changes')).toBeNull();
    });
});
