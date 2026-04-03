import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
            emailMessage: 'Your total is %annual_total%.',
            paymentMethods: [
                { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, handle: '@test', url: '', email: '', phone: '', instructions: '' }
            ]
        }
    }))
};

const mockState = {
    familyMembers: [
        { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
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
        // Payment Methods heading should not appear as a section heading
        // (it may still appear as a token chip label)
        const pmElements = screen.queryAllByText('Payment Methods');
        // Only the token chip insert button should remain, not a section heading
        expect(pmElements.length).toBeLessThanOrEqual(2);
        expect(screen.queryByText('Add Payment Method')).toBeNull();
    });

    it('shows template content in contenteditable editor', () => {
        renderTab();
        const editors = screen.getAllByRole('textbox');
        // The contenteditable editor is the one with aria-multiline
        const editor = editors.find(el => el.getAttribute('aria-multiline') === 'true');
        expect(editor).toBeInTheDocument();
        expect(editor.textContent).toContain('Household Total');
    });

    it('shows token insert buttons', () => {
        renderTab();
        expect(screen.getAllByText('Billing Year').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Household Total').length).toBeGreaterThanOrEqual(1);
    });

    it('shows live preview with To and Subject', () => {
        renderTab();
        expect(screen.getByText('Live Preview')).toBeInTheDocument();
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
});
