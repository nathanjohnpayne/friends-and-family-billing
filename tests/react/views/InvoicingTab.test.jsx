import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock Firebase (needed by InvoicingTab for publicQrCodes sync)
vi.mock('@/lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn(), serverTimestamp: vi.fn()
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

    it('renders payment methods section', () => {
        renderTab();
        // "Payment Methods" appears as both section heading and token chip — use getAllByText
        expect(screen.getAllByText('Payment Methods').length).toBeGreaterThanOrEqual(1);
    });

    it('shows template content in contenteditable editor', () => {
        renderTab();
        const editor = screen.getByRole('textbox');
        // The editor renders token chips with labels, so "Household Total" chip should be present
        expect(editor).toBeInTheDocument();
        expect(editor.textContent).toContain('Household Total');
    });

    it('shows token insert buttons', () => {
        renderTab();
        // Token chips appear as buttons AND in editor content — use getAllByText
        expect(screen.getAllByText('Billing Year').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Household Total').length).toBeGreaterThanOrEqual(1);
        // "Payment Methods" also serves as token chip — confirmed by getAllByText
        const pmElements = screen.getAllByText('Payment Methods');
        expect(pmElements.length).toBeGreaterThanOrEqual(2); // heading + chip
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

    it('renders existing payment method', () => {
        renderTab();
        // "Venmo" appears in both the payment method card and the type dropdown
        expect(screen.getAllByText('Venmo').length).toBeGreaterThanOrEqual(1);
    });

    it('shows Add Payment Method button', () => {
        renderTab();
        expect(screen.getByText('Add Payment Method')).toBeInTheDocument();
    });

    it('adds a new payment method', () => {
        renderTab();
        fireEvent.click(screen.getByText('Add Payment Method'));
        expect(mockService.updateSettings).toHaveBeenCalled();
        const call = mockService.updateSettings.mock.calls[0][0];
        expect(call.paymentMethods.length).toBe(2);
    });

    it('hides controls when year is read-only', () => {
        renderTab({ activeYear: { id: '2024', label: '2024', status: 'archived' } });
        expect(screen.queryByText('Save Template')).toBeNull();
        expect(screen.queryByText('Add Payment Method')).toBeNull();
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
