import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

/** Toggle a linked member's bill breakdown by clicking their row */
function toggleLinkedMember(name) {
    const all = screen.getAllByText(name);
    const el = all.map(n => n.closest('.settlement-linked-member')).find(Boolean);
    fireEvent.click(el);
}

/** Members with different bill sets: Alice on Internet only, Carol on Streaming only */
const differentBillMembers = [
    { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [3], paymentReceived: 0 },
    { id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
    { id: 3, name: 'Carol', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
];

const differentBills = [
    { id: 101, name: 'Internet', amount: 120, billingFrequency: 'monthly', members: [1, 2] },
    { id: 102, name: 'Streaming', amount: 24, billingFrequency: 'monthly', members: [2, 3] }
];

/** Household with two linked members for independence testing */
const twoLinkedMembers = [
    { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [3, 4], paymentReceived: 0 },
    { id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
    { id: 3, name: 'Carol', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
    { id: 4, name: 'Dave', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
];

const twoLinkedBills = [
    { id: 101, name: 'Internet', amount: 120, billingFrequency: 'monthly', members: [1, 2, 3, 4] }
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
        // Internet: $120/month × 12 ÷ 3 members = $480.00
        expect(screen.getByText(/\$120\.00 \/ month × 12 ÷ 3 members = \$480\.00/)).toBeInTheDocument();
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

    it('sections appear in order: Primary Member Calculation, Linked Members, Household Total', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        const detail = document.querySelector('.settlement-card-detail');
        const html = detail.innerHTML;
        const primaryIdx = html.indexOf('Primary Member Calculation');
        const linkedIdx = html.indexOf('Linked Members');
        const totalIdx = html.indexOf('Household Total');
        expect(primaryIdx).toBeGreaterThan(-1);
        expect(linkedIdx).toBeGreaterThan(-1);
        expect(totalIdx).toBeGreaterThan(-1);
        expect(primaryIdx).toBeLessThan(linkedIdx);
        expect(linkedIdx).toBeLessThan(totalIdx);
    });

    it('linked member row shows expand/collapse toggle indicator', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        const hint = document.querySelector('.settlement-linked-toggle-hint');
        expect(hint).not.toBeNull();
    });

    it('linked member breakdown defaults to collapsed', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        expect(document.querySelector('.settlement-linked-breakdown')).toBeNull();
    });

    it('clicking linked member row expands their bill breakdown', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        toggleLinkedMember('Carol');
        expect(document.querySelector('.settlement-linked-breakdown')).not.toBeNull();
    });

    it('shows "Same bills as [primary]" when bill sets match', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        toggleLinkedMember('Carol');
        expect(screen.getByText('Same bills as Alice')).toBeInTheDocument();
    });

    it('shows individual formulas when bill sets differ', () => {
        render(<SettlementBoard familyMembers={differentBillMembers} bills={differentBills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        toggleLinkedMember('Carol');
        expect(screen.getByText('Streaming')).toBeInTheDocument();
        expect(screen.queryByText(/Same bills as/)).toBeNull();
    });

    it('linked member breakdown total matches Annual figure', () => {
        render(<SettlementBoard familyMembers={differentBillMembers} bills={differentBills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        toggleLinkedMember('Carol');
        // Carol's Streaming: $24/month × 12 ÷ 2 members = $144.00
        const totalRow = screen.getByText(/Total \(Carol\)/).closest('.settlement-breakdown-total');
        expect(totalRow).not.toBeNull();
        expect(totalRow.textContent).toContain('$144.00');
    });

    it('linked member expand/collapse is independent per member', () => {
        render(<SettlementBoard familyMembers={twoLinkedMembers} bills={twoLinkedBills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        toggleLinkedMember('Carol');
        // Carol expanded, Dave still collapsed
        const breakdowns = document.querySelectorAll('.settlement-linked-breakdown');
        expect(breakdowns.length).toBe(1);
    });

    it('all linked breakdowns default to collapsed across cards', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} />);
        expandCard('Alice');
        expandCard('Bob');
        expect(document.querySelectorAll('.settlement-linked-breakdown').length).toBe(0);
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

// ──────────────── Household credit display (#316) ────────────────
//
// Each household here owes $480/yr on Internet ($120/mo × 12 ÷ 3 members).
// Bob is an independent member; Alice + Carol form a household.

describe('SettlementBoard — household credit', () => {
    it('shows a Credit box with the overpaid amount for an overpaid household', () => {
        const payments = [{ memberId: 2, amount: 548.98, method: 'cash' }]; // owed 480 → credit 68.98
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} readOnly={false} />);
        expect(screen.getByText('Credit')).toBeInTheDocument();
        expect(screen.getByText('$68.98')).toBeInTheDocument();
    });

    it('shows an Overpaid badge for a household carrying an unresolved credit', () => {
        const payments = [{ memberId: 2, amount: 600, method: 'cash' }];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} readOnly={false} />);
        expect(screen.getAllByText('Overpaid').length).toBeGreaterThanOrEqual(1);
    });

    it('reads Settled (not Overpaid) when a recorded refund brings Net Contribution down to owed', () => {
        // Bob paid 600 (owed 480) but a recorded refund of 120 nets his contribution back to 480.
        const payments = [{ memberId: 2, amount: 600, method: 'cash' }];
        const creditAdjustments = [{ id: 'c1', memberId: 2, type: 'refund', amount: 120, status: 'recorded' }];
        render(
            <SettlementBoard
                familyMembers={members}
                bills={bills}
                payments={payments}
                creditAdjustments={creditAdjustments}
                readOnly={false}
            />
        );
        expect(screen.getAllByText('Settled').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('Overpaid')).toBeNull();
        expect(screen.queryByText('Credit')).toBeNull(); // credit resolved → no Credit box
    });

    it('nets internal household imbalance out — primary overpaid + linked underpaid shows no household credit', () => {
        // Alice (primary) + Carol (linked) each owe 480. Alice overpays 80, Carol underpays 80.
        // Household Net Contribution (960) equals owed (960): no household-level credit (ADR 0001).
        const payments = [
            { memberId: 1, amount: 560, method: 'cash' },
            { memberId: 3, amount: 400, method: 'cash' }
        ];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} readOnly={false} />);
        expect(screen.queryByText('Credit')).toBeNull();
    });

    it('shows a collectable Balance and Record Payment when Net Contribution falls below owed', () => {
        // Bob owes 480, paid 600, but a recorded carry-forward of 200 nets him to 400 —
        // below owed (an over-disposition later slices must prevent). The board must stay
        // internally consistent: a real Balance and the Record Payment action, never "Paid".
        const payments = [{ memberId: 2, amount: 600, method: 'cash' }];
        const creditAdjustments = [{ id: 'c1', memberId: 2, type: 'carry_forward', amount: 200, status: 'recorded' }];
        render(
            <SettlementBoard
                familyMembers={members}
                bills={bills}
                payments={payments}
                creditAdjustments={creditAdjustments}
                readOnly={false}
            />
        );
        expect(screen.queryByText('Credit')).toBeNull();         // net is below owed, not a credit
        expect(screen.getByText('$80.00')).toBeInTheDocument();   // Balance = owed 480 − net 400
        expandCard('Bob');
        expect(screen.getAllByText('Record Payment').length).toBeGreaterThanOrEqual(1);
    });
});

// ──────────────── Deferred usage charges (#317) ────────────────
//
// A deferred Usage Charge is recorded + visible but NOT yet billed: it must not
// change Annual/Paid/Balance, but the board surfaces a per-household pending
// count + running total and an "Add Charge" entry point.

describe('SettlementBoard — deferred usage charges', () => {
    it('shows a per-household pending charges total and count', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 2, kind: 'usage_charge', amount: 12.5, status: 'deferred', description: 'Roaming', incurredDate: '2025-02-01' },
            { id: 'o2', memberId: 2, kind: 'usage_charge', amount: 7.5, status: 'deferred', description: 'Add-on', incurredDate: '2025-03-01' }
        ];
        render(
            <SettlementBoard
                familyMembers={members}
                bills={bills}
                payments={[]}
                owedAdjustments={owedAdjustments}
                readOnly={false}
            />
        );
        // "Pending charges: $20.00" surfaced on Bob's card
        expect(screen.getByText(/Pending charges:\s*\$20\.00/)).toBeInTheDocument();
        expect(screen.getByText(/\(2 charges\)/)).toBeInTheDocument();
    });

    it('aggregates pending charges at the household grain (primary + linked)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred', description: 'Alice charge', incurredDate: '2025-02-01' },
            { id: 'o2', memberId: 3, kind: 'usage_charge', amount: 5, status: 'deferred', description: 'Carol charge', incurredDate: '2025-03-01' }
        ];
        render(
            <SettlementBoard
                familyMembers={members}
                bills={bills}
                payments={[]}
                owedAdjustments={owedAdjustments}
                readOnly={false}
            />
        );
        expect(screen.getByText(/Pending charges:\s*\$15\.00/)).toBeInTheDocument();
    });

    it('does not show a pending charges line for a household with no deferred charges', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} owedAdjustments={[]} readOnly={false} />);
        expect(screen.queryByText(/Pending charges:/)).toBeNull();
    });

    it('does NOT change the Annual/Balance figures (a deferred charge is not yet owed)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 2, kind: 'usage_charge', amount: 999, status: 'deferred', description: 'Huge', incurredDate: '2025-02-01' }
        ];
        const payments = [{ memberId: 2, amount: 480, method: 'cash' }]; // Bob fully settled on bills
        render(
            <SettlementBoard
                familyMembers={members}
                bills={bills}
                payments={payments}
                owedAdjustments={owedAdjustments}
                readOnly={false}
            />
        );
        // Bob still reads Settled despite the large deferred charge
        const bobCard = screen.getByText('Bob').closest('.settlement-card');
        expect(bobCard).not.toBeNull();
        expect(within(bobCard).getByText('Settled')).toBeInTheDocument();
    });

    it('renders an Add Charge action in the expanded card and fires onAddCharge', () => {
        const onAddCharge = vi.fn();
        render(
            <SettlementBoard
                familyMembers={members}
                bills={bills}
                payments={[]}
                owedAdjustments={[]}
                readOnly={false}
                onAddCharge={onAddCharge}
            />
        );
        expandCard('Bob');
        const addBtn = screen.getByText('Add Charge');
        fireEvent.click(addBtn);
        expect(onAddCharge).toHaveBeenCalledWith(2);
    });

    it('hides the Add Charge action when readOnly', () => {
        render(
            <SettlementBoard
                familyMembers={members}
                bills={bills}
                payments={[]}
                owedAdjustments={[]}
                readOnly={true}
                onAddCharge={vi.fn()}
            />
        );
        expandCard('Bob');
        expect(screen.queryByText('Add Charge')).toBeNull();
    });
});

// ──────────────── Issue Refund action (#318) ────────────────
//
// Bob (independent) owes $480/yr; paying $548.98 leaves a $68.98 household credit.

describe('SettlementBoard — Issue Refund', () => {
    const overpaid = [{ memberId: 2, amount: 548.98, method: 'cash' }];

    it('shows Issue Refund in the expanded card for a household with a credit', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={overpaid} readOnly={false} onIssueRefund={() => {}} />);
        expandCard('Bob');
        expect(screen.getAllByText('Issue Refund').length).toBeGreaterThanOrEqual(1);
    });

    it('does not show Issue Refund for a household with no credit', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={[]} readOnly={false} onIssueRefund={() => {}} />);
        expandCard('Bob');
        expect(screen.queryByText('Issue Refund')).toBeNull();
    });

    it('hides Issue Refund when readOnly', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={overpaid} readOnly={true} onIssueRefund={() => {}} />);
        expandCard('Bob');
        expect(screen.queryByText('Issue Refund')).toBeNull();
    });

    it('opens a refund dialog defaulting the amount to the household credit', () => {
        render(<SettlementBoard familyMembers={members} bills={bills} payments={overpaid} readOnly={false} onIssueRefund={() => {}} />);
        expandCard('Bob');
        fireEvent.click(screen.getByText('Issue Refund'));
        expect(screen.getByText('Save Refund')).toBeInTheDocument();
        expect(screen.getByLabelText(/Refund amount/).value).toBe('68.98');
    });

    it('calls onIssueRefund with memberId, amount, method, and reason', () => {
        const onIssueRefund = vi.fn();
        render(<SettlementBoard familyMembers={members} bills={bills} payments={overpaid} readOnly={false} onIssueRefund={onIssueRefund} />);
        expandCard('Bob');
        fireEvent.click(screen.getByText('Issue Refund'));
        fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Overpaid Q1' } });
        fireEvent.click(screen.getByText('Save Refund'));
        expect(onIssueRefund).toHaveBeenCalledWith(expect.objectContaining({
            memberId: 2, amount: 68.98, method: 'venmo', reason: 'Overpaid Q1'
        }));
    });

    it('requires a reason before submitting', () => {
        const onIssueRefund = vi.fn();
        render(<SettlementBoard familyMembers={members} bills={bills} payments={overpaid} readOnly={false} onIssueRefund={onIssueRefund} />);
        expandCard('Bob');
        fireEvent.click(screen.getByText('Issue Refund'));
        fireEvent.click(screen.getByText('Save Refund'));
        expect(onIssueRefund).not.toHaveBeenCalled();
        expect(screen.getByText(/reason is required/i)).toBeInTheDocument();
    });

    it('surfaces a refund failure as an inline error and keeps the dialog open', () => {
        // A throwing callback (e.g. the service rejecting an over-cap amount) must
        // not close the dialog — the error shows inline and input is preserved.
        const onIssueRefund = vi.fn(() => { throw new Error('Refund cannot exceed the credit.'); });
        render(<SettlementBoard familyMembers={members} bills={bills} payments={overpaid} readOnly={false} onIssueRefund={onIssueRefund} />);
        expandCard('Bob');
        fireEvent.click(screen.getByText('Issue Refund'));
        fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Overpaid' } });
        fireEvent.click(screen.getByText('Save Refund'));
        expect(onIssueRefund).toHaveBeenCalled();
        expect(screen.getByText(/cannot exceed/i)).toBeInTheDocument(); // inline error
        expect(screen.getByText('Save Refund')).toBeInTheDocument();    // dialog still open
    });
});

describe('SettlementBoard — carried opening balance (#322)', () => {
    // Each member owes $480/yr ($120/mo ÷ 3). Bob is solo.
    it('a carried credit lowers the household Annual total and settles at the reduced amount', () => {
        // Bob carries a −180 credit → effective owed 300. Pay 250 (< reduced owed)
        // so the Annual box (300) and Paid box (250) differ and the Annual is checkable.
        const owedAdjustments = [
            { id: 's1', memberId: 2, kind: 'carry_opening', amount: -180, status: 'carried_in', fromYear: '2025' }
        ];
        const payments = [{ memberId: 2, amount: 250, method: 'cash' }];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} owedAdjustments={owedAdjustments} readOnly={false} />);
        const card = screen.getByText('Bob').closest('.settlement-card');
        // Annual box shows the reduced 300 (not the full 480); Balance is the 50 shortfall.
        const annualBox = within(card).getByText('Annual').closest('.settlement-summary-box');
        expect(within(annualBox).getByText('$300.00')).toBeInTheDocument();
        const balanceBox = within(card).getByText('Balance').closest('.settlement-summary-box');
        expect(within(balanceBox).getByText('$50.00')).toBeInTheDocument(); // 300 owed − 250 paid
    });

    it('a carried charge raises the household Annual total and surfaces a collectable balance', () => {
        // Bob carries a +120 charge → effective owed 600; pays 480 → owes 120.
        const owedAdjustments = [
            { id: 's1', memberId: 2, kind: 'carry_opening', amount: 120, status: 'carried_in', fromYear: '2025' }
        ];
        const payments = [{ memberId: 2, amount: 480, method: 'cash' }];
        render(<SettlementBoard familyMembers={members} bills={bills} payments={payments} owedAdjustments={owedAdjustments} readOnly={false} />);
        const card = screen.getByText('Bob').closest('.settlement-card');
        const annualBox = within(card).getByText('Annual').closest('.settlement-summary-box');
        expect(within(annualBox).getByText('$600.00')).toBeInTheDocument();   // raised Annual
        const balanceBox = within(card).getByText('Balance').closest('.settlement-summary-box');
        expect(within(balanceBox).getByText('$120.00')).toBeInTheDocument();  // collectable Balance
    });
});
