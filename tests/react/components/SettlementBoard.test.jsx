import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettlementBoard from '@/app/components/SettlementBoard.jsx';

const members = [
    { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [3], paymentReceived: 0 },
    { id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
    { id: 3, name: 'Carol', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
];

const bills = [
    { id: 101, name: 'Internet', amount: 120, billingFrequency: 'monthly', members: [1, 2, 3] }
];

/** Expand a card by clicking its header row */
function expandCard(name) {
    const card = screen.getByText(name).closest('.settlement-card-main');
    fireEvent.click(card);
}

describe('SettlementBoard', () => {
    it('renders nothing when no members', () => {
        const { container } = render(
            <SettlementBoard familyMembers={[]} bills={[]} payments={[]} readOnly={false} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders settlement header and filter chips', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expect(screen.getByText('Settlement Board')).toBeInTheDocument();
        const filterButtons = screen.getAllByRole('button');
        const chipLabels = filterButtons.map(b => b.textContent);
        expect(chipLabels.some(t => t.includes('All'))).toBe(true);
        expect(chipLabels.some(t => t.includes('Outstanding'))).toBe(true);
        expect(chipLabels.some(t => t.includes('Settled'))).toBe(true);
    });

    it('shows only parent/independent members as top-level cards', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        const cards = screen.getAllByText(/Individual|Household/);
        expect(cards.length).toBe(2);
    });

    it('shows outstanding status when unpaid', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        const badges = screen.getAllByText('Outstanding');
        expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it('shows settled status when fully paid', () => {
        const payments = [
            { memberId: 1, amount: 480, method: 'cash' },
            { memberId: 2, amount: 480, method: 'cash' },
            { memberId: 3, amount: 480, method: 'cash' }
        ];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} readOnly={false} />);
        const badges = screen.getAllByText('Settled');
        expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it('expands card to show bill breakdown', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        // Household members show "Primary Member Calculation" instead of "Bill breakdown for..."
        expect(screen.getByText('Primary Member Calculation')).toBeInTheDocument();
        expect(screen.getByText('Internet')).toBeInTheDocument();
    });

    it('shows linked member details in expanded view', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        const carolElements = screen.getAllByText('Carol');
        expect(carolElements.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by status', () => {
        const payments = [
            { memberId: 1, amount: 480, method: 'cash' },
            { memberId: 3, amount: 480, method: 'cash' }
        ];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} readOnly={false} />);
        const filterButtons = screen.getAllByRole('button');
        const settledChip = filterButtons.find(b => b.textContent.includes('Settled'));
        fireEvent.click(settledChip);
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.queryByText('Bob')).toBeNull();
    });

    it('shows "no households" message when filter has no matches', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        const filterButtons = screen.getAllByRole('button');
        const settledChip = filterButtons.find(b => b.textContent.includes('Settled'));
        fireEvent.click(settledChip);
        expect(screen.getByText('No households match this filter.')).toBeInTheDocument();
    });

    it('shows household label with linked member count', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expect(screen.getByText(/Household includes 1 linked member/)).toBeInTheDocument();
    });

    it('shows Individual label for standalone members', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expect(screen.getByText('Individual')).toBeInTheDocument();
    });

    it('shows +N badge for linked members', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expect(screen.getByText('+1')).toBeInTheDocument();
    });

    it('shows summary boxes (Annual, Paid, Balance) including when settled', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expect(screen.getAllByText('Annual').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Paid').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Balance').length).toBeGreaterThanOrEqual(1);
    });

    it('shows Details/Hide details toggle text', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expect(screen.getAllByText(/Details/).length).toBeGreaterThanOrEqual(1);
        expandCard('Alice');
        expect(screen.getByText(/Hide details/)).toBeInTheDocument();
    });

    it('shows Record Payment in expanded detail for outstanding members', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        const payButtons = screen.getAllByText('Record Payment');
        expect(payButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('hides Record Payment button when readOnly', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={true} />);
        expandCard('Alice');
        expect(screen.queryByText('Record Payment')).toBeNull();
    });

    it('opens payment dialog on Record Payment click', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        const payButtons = screen.getAllByText('Record Payment');
        fireEvent.click(payButtons[0]);
        expect(screen.getByText(/For:/)).toBeInTheDocument();
        expect(screen.getByText('Save Payment')).toBeInTheDocument();
    });

    it('calls onRecordPayment when payment is submitted', () => {
        const onRecordPayment = vi.fn();
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} onRecordPayment={onRecordPayment} />);
        expandCard('Alice');
        const payButtons = screen.getAllByText('Record Payment');
        fireEvent.click(payButtons[0]);
        const amountInput = screen.getByPlaceholderText('0.00');
        fireEvent.change(amountInput, { target: { value: '100' } });
        fireEvent.click(screen.getByText('Save Payment'));
        expect(onRecordPayment).toHaveBeenCalledWith(expect.objectContaining({
            memberId: 1,
            amount: 100,
            method: 'cash',
            note: ''
        }));
    });

    it('shows payment error for invalid amount', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        const payButtons = screen.getAllByText('Record Payment');
        fireEvent.click(payButtons[0]);
        fireEvent.click(screen.getByText('Save Payment'));
        expect(screen.getByText('Enter a valid amount.')).toBeInTheDocument();
    });

    it('hides Record Payment when member is fully settled', () => {
        const payments = [
            { memberId: 1, amount: 10000, method: 'cash' },
            { memberId: 2, amount: 10000, method: 'cash' },
            { memberId: 3, amount: 10000, method: 'cash' }
        ];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} readOnly={false} />);
        expandCard('Alice');
        expect(screen.queryByText('Record Payment')).toBeNull();
    });

    it('shows distribute checkbox for household members in payment dialog', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        const payButtons = screen.getAllByText('Record Payment');
        fireEvent.click(payButtons[0]);
        expect(screen.getByLabelText(/Distribute across household/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Distribute across household/)).toBeChecked();
    });

    it('passes distribute=true to onRecordPayment for household members', () => {
        const onRecordPayment = vi.fn();
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} onRecordPayment={onRecordPayment} />);
        expandCard('Alice');
        const payButtons = screen.getAllByText('Record Payment');
        fireEvent.click(payButtons[0]);
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '200' } });
        fireEvent.click(screen.getByText('Save Payment'));
        expect(onRecordPayment).toHaveBeenCalledWith(expect.objectContaining({
            memberId: 1,
            amount: 200,
            distribute: true
        }));
    });

    it('shows Email Invoice in overflow menu', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        // Open the overflow menu
        const menuTrigger = screen.getByLabelText('More actions for Alice');
        fireEvent.click(menuTrigger);
        expect(screen.getByText('Email Invoice')).toBeInTheDocument();
    });

    it('shows Payment History and share actions in expanded detail', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        // Open overflow menu for share links
        const menuTrigger = screen.getByLabelText('More actions for Alice');
        fireEvent.click(menuTrigger);
        expect(screen.getByText('Generate Share Link')).toBeInTheDocument();
        // Payment History appears in detail actions
        const historyButtons = screen.getAllByText('Payment History');
        expect(historyButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('shows Payment History in expanded detail when settled', () => {
        const payments = [
            { memberId: 1, amount: 10000, method: 'cash' },
            { memberId: 2, amount: 10000, method: 'cash' },
            { memberId: 3, amount: 10000, method: 'cash' }
        ];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} readOnly={false} />);
        expandCard('Alice');
        expect(screen.queryByText('Record Payment')).toBeNull();
        const historyButtons = screen.getAllByText('Payment History');
        expect(historyButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('shows breakdown total and household grand total', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        expect(screen.getByText(/Total \(Alice\)/)).toBeInTheDocument();
        expect(screen.getByText('Household Total')).toBeInTheDocument();
    });

    it('shows formula in bill breakdown', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        // Internet: $120/month × 12 ÷ 3 = $480.00
        expect(screen.getByText(/\$120\.00 \/ month × 12 ÷ 3 = \$480\.00/)).toBeInTheDocument();
    });

    it('shows "Primary Member Calculation" label for households', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        expect(screen.getByText('Primary Member Calculation')).toBeInTheDocument();
    });

    it('shows "Linked Members" section label for households', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        expect(screen.getByText('Linked Members')).toBeInTheDocument();
    });

    it('shows Annual/Paid/Balance boxes on linked member rows', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        // Linked member (Carol) should have the same box layout
        const annualLabels = screen.getAllByText('Annual');
        // At least 2: one in header, one for linked member Carol
        expect(annualLabels.length).toBeGreaterThanOrEqual(2);
    });

    it('shows Linked Groups count', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expect(screen.getByText(/Linked Groups 1/)).toBeInTheDocument();
    });
});
