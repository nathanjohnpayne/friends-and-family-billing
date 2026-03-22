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
        // Filter chips exist as buttons
        const filterButtons = screen.getAllByRole('button');
        const chipLabels = filterButtons.map(b => b.textContent);
        expect(chipLabels.some(t => t.includes('All'))).toBe(true);
        expect(chipLabels.some(t => t.includes('Outstanding'))).toBe(true);
        expect(chipLabels.some(t => t.includes('Settled'))).toBe(true);
    });

    it('shows only parent/independent members as top-level cards', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        // Alice (parent) and Bob (independent) should appear, but not Carol (child of Alice)
        const cards = screen.getAllByText(/Individual|Household/);
        expect(cards.length).toBe(2); // Alice household + Bob individual
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
        // Click on Alice's card to expand
        const aliceCard = screen.getByText('Alice').closest('.settlement-card-main');
        fireEvent.click(aliceCard);
        expect(screen.getByText(/Bill breakdown for Alice/)).toBeInTheDocument();
        expect(screen.getByText('Internet')).toBeInTheDocument();
    });

    it('shows linked member details in expanded view', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        const aliceCard = screen.getByText('Alice').closest('.settlement-card-main');
        fireEvent.click(aliceCard);
        // Carol should appear as a linked member
        // Carol appears in both the card list and the linked detail
        const carolElements = screen.getAllByText('Carol');
        expect(carolElements.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by status', () => {
        const payments = [
            { memberId: 1, amount: 480, method: 'cash' },
            { memberId: 3, amount: 480, method: 'cash' }
        ];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} readOnly={false} />);
        // Click "Settled" filter chip (class-based selector to avoid ambiguity with status badges)
        const chips = document.querySelectorAll('.settlement-filter-chip');
        const settledChip = Array.from(chips).find(c => c.textContent.includes('Settled'));
        fireEvent.click(settledChip);
        // Alice (with Carol) is settled, Bob is not
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.queryByText('Bob')).toBeNull();
    });

    it('shows "no households" message when filter has no matches', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        // Click "Settled" filter — nobody is settled
        const chips = document.querySelectorAll('.settlement-filter-chip');
        const settledChip = Array.from(chips).find(c => c.textContent.includes('Settled'));
        fireEvent.click(settledChip);
        expect(screen.getByText('No households match this filter.')).toBeInTheDocument();
    });

    it('shows household label for members with linked members', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expect(screen.getByText(/Household.*1 linked/)).toBeInTheDocument();
    });

    it('shows Individual label for standalone members', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expect(screen.getByText('Individual')).toBeInTheDocument();
    });

    it('shows Record Payment button for outstanding members', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        const payButtons = screen.getAllByText('Record Payment');
        expect(payButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('hides Record Payment button when readOnly', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={true} />);
        expect(screen.queryByText('Record Payment')).toBeNull();
    });

    it('opens payment dialog on Record Payment click', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        const payButtons = screen.getAllByText('Record Payment');
        fireEvent.click(payButtons[0]);
        expect(screen.getByText(/For:/)).toBeInTheDocument();
        expect(screen.getByText('Save Payment')).toBeInTheDocument();
    });

    it('calls onRecordPayment when payment is submitted', () => {
        const onRecordPayment = vi.fn();
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} onRecordPayment={onRecordPayment} />);
        const payButtons = screen.getAllByText('Record Payment');
        fireEvent.click(payButtons[0]);
        // Fill in amount
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
        expect(screen.queryByText('Record Payment')).toBeNull();
    });

    it('shows distribute checkbox for household members in payment dialog', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        // Alice has linked members — open her payment dialog
        const payButtons = screen.getAllByText('Record Payment');
        fireEvent.click(payButtons[0]);
        expect(screen.getByLabelText(/Distribute across household/)).toBeInTheDocument();
        // Should be checked by default
        expect(screen.getByLabelText(/Distribute across household/)).toBeChecked();
    });

    it('passes distribute=true to onRecordPayment for household members', () => {
        const onRecordPayment = vi.fn();
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} onRecordPayment={onRecordPayment} />);
        const payButtons = screen.getAllByText('Record Payment');
        fireEvent.click(payButtons[0]); // Alice (has linked members)
        fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '200' } });
        fireEvent.click(screen.getByText('Save Payment'));
        expect(onRecordPayment).toHaveBeenCalledWith(expect.objectContaining({
            memberId: 1,
            amount: 200,
            distribute: true
        }));
    });

    it('shows Email Invoice button on card', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        const invoiceButtons = screen.getAllByText('Email Invoice');
        expect(invoiceButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('shows Payment History and share actions in expanded detail', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        const aliceCard = screen.getByText('Alice').closest('.settlement-card-main');
        fireEvent.click(aliceCard);
        expect(screen.getByText('New Share Link')).toBeInTheDocument();
        // Payment History appears in detail actions
        const historyButtons = screen.getAllByText('Payment History');
        expect(historyButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('shows Payment History instead of Record Payment when settled', () => {
        const payments = [
            { memberId: 1, amount: 10000, method: 'cash' },
            { memberId: 2, amount: 10000, method: 'cash' },
            { memberId: 3, amount: 10000, method: 'cash' }
        ];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} readOnly={false} />);
        // Record Payment should be gone, Payment History should appear
        expect(screen.queryByText('Record Payment')).toBeNull();
        const historyButtons = screen.getAllByText('Payment History');
        expect(historyButtons.length).toBeGreaterThanOrEqual(1);
    });
});
