import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockService = {
    addBill: vi.fn(),
    updateBill: vi.fn(),
    removeBill: vi.fn(),
    toggleBillMember: vi.fn(),
    recordServiceCredit: vi.fn()
};

const mockState = {
    familyMembers: [
        { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
        { id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
    ],
    bills: [
        { id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1, 2], logo: '', website: 'https://isp.com' }
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
import BillsTab from '@/app/views/Manage/BillsTab.jsx';

function renderTab(overrides = {}) {
    if (Object.keys(overrides).length > 0) {
        useBillingData.mockReturnValue({ ...mockState, ...overrides });
    }
    return render(<ToastProvider><BillsTab /></ToastProvider>);
}

describe('BillsTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useBillingData.mockReturnValue(mockState);
    });

    it('renders bill count in header', () => {
        renderTab();
        expect(screen.getByText('Bills (1)')).toBeInTheDocument();
    });

    it('renders bill card with name and amount', () => {
        renderTab();
        expect(screen.getByText('Internet')).toBeInTheDocument();
        expect(screen.getByText('$100.00 / month')).toBeInTheDocument();
    });

    it('shows cadence summary', () => {
        renderTab();
        expect(screen.getByText(/Annualized.*\$1200\.00/)).toBeInTheDocument();
    });

    it('shows split summary with member count', () => {
        renderTab();
        expect(screen.getByText(/2 members/)).toBeInTheDocument();
    });

    it('shows Add Bill button when year is open', () => {
        renderTab();
        expect(screen.getByText('+ Add Bill')).toBeInTheDocument();
    });

    it('hides Add Bill button when year is read-only', () => {
        renderTab({ activeYear: { id: '2024', label: '2024', status: 'archived' } });
        expect(screen.queryByText('+ Add Bill')).toBeNull();
    });

    it('shows View History in action menu when year is read-only', () => {
        renderTab({ activeYear: { id: '2024', label: '2024', status: 'archived' } });
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        expect(screen.getByText('View History')).toBeInTheDocument();
    });

    it('hides mutation actions when year is read-only', () => {
        renderTab({ activeYear: { id: '2024', label: '2024', status: 'archived' } });
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        expect(screen.getByText('View History')).toBeInTheDocument();
        expect(screen.getByText('Open Website')).toBeInTheDocument();
        expect(screen.queryByText('Convert to Annual')).toBeNull();
        expect(screen.queryByText('Edit Website')).toBeNull();
        expect(screen.queryByText('Remove Bill')).toBeNull();
    });

    it('opens composer on Add Bill click', () => {
        renderTab();
        fireEvent.click(screen.getByText('+ Add Bill'));
        expect(screen.getByPlaceholderText('Bill name *')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Amount *')).toBeInTheDocument();
    });

    it('calls service.addBill on form submit', () => {
        mockService.addBill.mockReturnValue({ id: 102, name: 'Electric', amount: 80 });
        renderTab();
        fireEvent.click(screen.getByText('+ Add Bill'));
        fireEvent.change(screen.getByPlaceholderText('Bill name *'), { target: { value: 'Electric' } });
        fireEvent.change(screen.getByPlaceholderText('Amount *'), { target: { value: '80' } });
        fireEvent.click(screen.getByText('Add Bill'));
        expect(mockService.addBill).toHaveBeenCalledWith({
            name: 'Electric', amount: 80, billingFrequency: 'monthly', website: ''
        });
    });

    it('shows error when addBill throws', () => {
        mockService.addBill.mockImplementation(() => { throw new Error('name is required'); });
        renderTab();
        fireEvent.click(screen.getByText('+ Add Bill'));
        fireEvent.click(screen.getByText('Add Bill'));
        expect(screen.getByText('name is required')).toBeInTheDocument();
    });

    it('expands split section to show member checkboxes', () => {
        renderTab();
        fireEvent.click(screen.getByText('Edit split'));
        expect(screen.getByText('Split with:')).toBeInTheDocument();
        expect(screen.getByLabelText('Alice')).toBeChecked();
        expect(screen.getByLabelText('Bob')).toBeChecked();
    });

    it('calls service.toggleBillMember when checkbox toggled', () => {
        renderTab();
        fireEvent.click(screen.getByText('Edit split'));
        fireEvent.click(screen.getByLabelText('Alice'));
        expect(mockService.toggleBillMember).toHaveBeenCalledWith(101, 1);
    });

    it('shows delete confirmation dialog', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        fireEvent.click(screen.getByText('Remove Bill'));
        expect(screen.getByText('Remove Internet?')).toBeInTheDocument();
    });

    it('calls service.removeBill on confirm', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        fireEvent.click(screen.getByText('Remove Bill'));
        // Click the "Remove" button in the dialog
        const removeButtons = screen.getAllByText('Remove');
        fireEvent.click(removeButtons[removeButtons.length - 1]);
        expect(mockService.removeBill).toHaveBeenCalledWith(101);
    });

    it('shows empty state when no bills', () => {
        renderTab({ bills: [] });
        expect(screen.getByText('No bills yet')).toBeInTheDocument();
    });

    it('shows Open Website in action menu when bill has website', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        expect(screen.getByText('Open Website')).toBeInTheDocument();
    });

    it('shows Convert to Annual option in action menu for monthly bill', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        expect(screen.getByText('Convert to Annual')).toBeInTheDocument();
    });

    it('shows Convert to Monthly for annual bill', () => {
        renderTab({
            bills: [
                { id: 101, name: 'Insurance', amount: 1200, billingFrequency: 'annual', members: [1], logo: '', website: '' }
            ]
        });
        fireEvent.click(screen.getByLabelText('Actions for Insurance'));
        expect(screen.getByText('Convert to Monthly')).toBeInTheDocument();
    });

    it('opens frequency conversion dialog on click', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        fireEvent.click(screen.getByText('Convert to Annual'));
        expect(screen.getByText('Convert Billing Frequency')).toBeInTheDocument();
        expect(screen.getByText(/from monthly to annual/)).toBeInTheDocument();
    });

    it('calls service.updateBill with converted frequency on confirm', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        fireEvent.click(screen.getByText('Convert to Annual'));
        fireEvent.click(screen.getByText('Convert to annual'));
        expect(mockService.updateBill).toHaveBeenCalledWith(101, {
            billingFrequency: 'annual',
            amount: 1200
        });
    });

    it('shows Edit Website option in action menu', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        expect(screen.getByText('Edit Website')).toBeInTheDocument();
    });

    it('shows Add Website for bill without website', () => {
        renderTab({
            bills: [
                { id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1], logo: '', website: '' }
            ]
        });
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        expect(screen.getByText('Add Website')).toBeInTheDocument();
    });

    it('opens website edit dialog on click', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        fireEvent.click(screen.getByText('Edit Website'));
        expect(screen.getByText('Edit Website for Internet')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument();
    });

    it('calls service.updateBill with new website on save', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        fireEvent.click(screen.getByText('Edit Website'));
        const urlInput = screen.getByPlaceholderText('https://example.com');
        fireEvent.change(urlInput, { target: { value: 'https://newsite.com' } });
        fireEvent.click(screen.getByText('Save Website'));
        expect(mockService.updateBill).toHaveBeenCalledWith(101, { website: 'https://newsite.com' });
    });
});

// ── Service Credit entry point (#321, ADR 0005) ──
// A Service Credit is bill-level, so its action lives on the bill's own action menu
// (the closest precedent to "where bills are managed"). It opens ServiceCreditDialog
// scoped to that bill and records via service.recordServiceCredit.
describe('BillsTab — Service Credit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useBillingData.mockReturnValue(mockState);
    });

    it('shows "Issue Service Credit" in the bill action menu when the year is open', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        expect(screen.getByText('Issue Service Credit')).toBeInTheDocument();
    });

    it('hides "Issue Service Credit" when the year is read-only', () => {
        renderTab({ activeYear: { id: '2024', label: '2024', status: 'archived' } });
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        expect(screen.queryByText('Issue Service Credit')).toBeNull();
    });

    it('opens the ServiceCreditDialog scoped to the bill', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        fireEvent.click(screen.getByText('Issue Service Credit'));
        expect(screen.getByRole('dialog', { name: 'Issue Service Credit' })).toBeInTheDocument();
        // Bill name appears in the dialog confirmation (the bill card also shows it).
        expect(screen.getAllByText('Internet').length).toBeGreaterThanOrEqual(1);
    });

    it('records a bill-level service credit via the service on submit', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        fireEvent.click(screen.getByText('Issue Service Credit'));
        fireEvent.change(screen.getByLabelText('Amount ($)'), { target: { value: '90' } });
        fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Outage' } });
        fireEvent.change(screen.getByLabelText('Incurred date'), { target: { value: '2026-02-01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Credit' }));
        expect(mockService.recordServiceCredit).toHaveBeenCalledWith({
            billId: 101,
            amount: 90,
            reason: 'Outage',
            incurredDate: '2026-02-01'
        });
    });

    it('records a per-member service credit with the chosen memberId', () => {
        renderTab();
        fireEvent.click(screen.getByLabelText('Actions for Internet'));
        fireEvent.click(screen.getByText('Issue Service Credit'));
        fireEvent.click(screen.getByLabelText(/specific member/i));
        fireEvent.change(screen.getByLabelText('Member'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Amount ($)'), { target: { value: '40' } });
        fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Bob-only issue' } });
        fireEvent.change(screen.getByLabelText('Incurred date'), { target: { value: '2026-03-01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Credit' }));
        expect(mockService.recordServiceCredit).toHaveBeenCalledWith({
            billId: 101,
            amount: 40,
            reason: 'Bob-only issue',
            incurredDate: '2026-03-01',
            memberId: 2
        });
    });
});
