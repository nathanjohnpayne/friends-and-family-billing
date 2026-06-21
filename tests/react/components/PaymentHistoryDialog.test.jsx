import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/firebase.js', () => ({ storage: {} }));
vi.mock('firebase/storage', () => ({
    ref: vi.fn(), getDownloadURL: vi.fn()
}));

import PaymentHistoryDialog from '@/app/components/PaymentHistoryDialog.jsx';

const members = [
    { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
];
const bills = [
    { id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }
];
const payments = [
    { id: 'p1', memberId: 1, amount: 50, receivedAt: '2026-01-15T00:00:00Z', method: 'venmo', note: 'Q1' },
    { id: 'p2', memberId: 1, amount: 30, receivedAt: '2026-02-15T00:00:00Z', method: 'cash', note: '' }
];

const baseProps = {
    open: true,
    memberId: 1,
    memberName: 'Alice',
    familyMembers: members,
    bills,
    payments,
    readOnly: false,
    onReverse: vi.fn(),
    onClose: vi.fn()
};

describe('PaymentHistoryDialog', () => {
    it('renders payment list', () => {
        render(<PaymentHistoryDialog {...baseProps} />);
        expect(screen.getByText('Payment History for Alice')).toBeInTheDocument();
        expect(screen.getByText('Venmo')).toBeInTheDocument();
        expect(screen.getByText('Cash')).toBeInTheDocument();
    });

    it('shows total paid and balance', () => {
        render(<PaymentHistoryDialog {...baseProps} />);
        expect(screen.getByText('Total Paid')).toBeInTheDocument();
        expect(screen.getByText('Remaining Balance')).toBeInTheDocument();
    });

    it('shows reverse button for non-reversed payments', () => {
        render(<PaymentHistoryDialog {...baseProps} />);
        // Each payment gets a reverse (×) button
        const reverseButtons = screen.getAllByTitle('Reverse this payment');
        expect(reverseButtons.length).toBe(2);
    });

    it('hides reverse button when readOnly', () => {
        render(<PaymentHistoryDialog {...baseProps} readOnly={true} />);
        expect(screen.queryByTitle('Reverse this payment')).toBeNull();
    });

    it('shows empty state when no payments', () => {
        render(<PaymentHistoryDialog {...baseProps} payments={[]} />);
        expect(screen.getByText('No payments recorded yet.')).toBeInTheDocument();
    });

    it('renders nothing when not open', () => {
        const { container } = render(<PaymentHistoryDialog {...baseProps} open={false} />);
        expect(container.innerHTML).toBe('');
    });
});

describe('PaymentHistoryDialog — reversal-after-refund warning (#331)', () => {
    // owed $100 (annual bill), gross paid $150 ($120 + $30), $40 refund recorded →
    // Net Contribution $110 (small credit). Reversing the $30 payment drops Net to $80
    // → Outstanding by $20. Three distinct figures: refund $40, reversed $30, owed-back $20.
    const members = [{ id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }];
    const bills = [{ id: 101, name: 'Subscription', amount: 100, billingFrequency: 'annual', members: [1] }];
    const payments = [
        { id: 'pay-a', memberId: 1, amount: 120, receivedAt: '2026-01-15T00:00:00Z', method: 'venmo', note: '' },
        { id: 'pay-b', memberId: 1, amount: 30, receivedAt: '2026-02-15T00:00:00Z', method: 'cash', note: '' }
    ];
    const refundAdjustments = [{ id: 'r1', memberId: 1, type: 'refund', amount: 40, status: 'recorded' }];

    function renderDialog(overrides = {}) {
        const onReverse = vi.fn();
        const props = {
            open: true, memberId: 1, memberName: 'Alice',
            familyMembers: members, bills, payments,
            readOnly: false, onReverse, onClose: vi.fn(),
            ...overrides
        };
        render(<PaymentHistoryDialog {...props} />);
        return { onReverse };
    }

    // getMemberPayments sorts by receivedAt desc → the $30 Feb payment is the first reverse button.
    async function openReverseConfirmForLatestPayment(user) {
        await user.click(screen.getAllByTitle('Reverse this payment')[0]);
    }

    it('warns naming the refund amount and resulting Outstanding, and still lets the admin proceed', async () => {
        const user = userEvent.setup();
        const { onReverse } = renderDialog({ creditAdjustments: refundAdjustments });

        await openReverseConfirmForLatestPayment(user);

        const dialog = screen.getByRole('dialog', { name: 'Reverse Payment — Refund on Record' });
        const message = dialog.querySelector('.confirmation-message').textContent;
        expect(message).toContain('$40.00 refund');           // recorded refund amount
        expect(message).toContain('Reversing the $30.00 payment');
        expect(message).toContain('Outstanding by $20.00');   // resulting balance
        expect(message).toContain('not automatically clawed back');

        // Non-blocking: the Reverse button is present and proceeds.
        await user.click(screen.getByRole('button', { name: 'Reverse' }));
        expect(onReverse).toHaveBeenCalledWith('pay-b');
    });

    it('shows no refund warning for a household with no recorded refund (existing flow unchanged)', async () => {
        const user = userEvent.setup();
        const { onReverse } = renderDialog({ creditAdjustments: [] });

        await openReverseConfirmForLatestPayment(user);

        const dialog = screen.getByRole('dialog', { name: 'Reverse Payment' });
        const message = dialog.querySelector('.confirmation-message').textContent;
        expect(message).toBe('Reverse the $30.00 payment from ' + new Date('2026-02-15T00:00:00Z').toLocaleDateString() + '? This creates a reversal entry in the audit trail.');
        expect(message).not.toContain('refund');
        expect(message).not.toContain('clawed back');

        await user.click(screen.getByRole('button', { name: 'Reverse' }));
        expect(onReverse).toHaveBeenCalledWith('pay-b');
    });

    it('does not warn when the only credit adjustment is a carried-forward credit, not a refund', async () => {
        const user = userEvent.setup();
        renderDialog({ creditAdjustments: [{ id: 'cf1', memberId: 1, type: 'carry_forward', amount: 40, status: 'recorded' }] });

        await openReverseConfirmForLatestPayment(user);

        expect(screen.getByRole('dialog', { name: 'Reverse Payment' })).toBeInTheDocument();
        expect(screen.getByText(/This creates a reversal entry in the audit trail\./).textContent).not.toContain('refund');
    });

    it('does not warn when the household refund has been cancelled', async () => {
        const user = userEvent.setup();
        renderDialog({ creditAdjustments: [{ id: 'r1', memberId: 1, type: 'refund', amount: 40, status: 'cancelled' }] });

        await openReverseConfirmForLatestPayment(user);

        expect(screen.getByRole('dialog', { name: 'Reverse Payment' })).toBeInTheDocument();
    });

    it('avoids a false "$0.00 Outstanding" when a partial refund leaves the household in credit', async () => {
        const user = userEvent.setup();
        // owed $100, gross paid $230 ($200 + $30), $80 refund → Net $150 (credit $50).
        // Reversing the $30 payment drops Net to $120 — still $20 of credit, not Outstanding.
        renderDialog({
            payments: [
                { id: 'pay-a', memberId: 1, amount: 200, receivedAt: '2026-01-15T00:00:00Z', method: 'venmo', note: '' },
                { id: 'pay-b', memberId: 1, amount: 30, receivedAt: '2026-02-15T00:00:00Z', method: 'cash', note: '' }
            ],
            creditAdjustments: [{ id: 'r1', memberId: 1, type: 'refund', amount: 80, status: 'recorded' }]
        });

        await openReverseConfirmForLatestPayment(user);

        const dialog = screen.getByRole('dialog', { name: 'Reverse Payment — Refund on Record' });
        const message = dialog.querySelector('.confirmation-message').textContent;
        expect(message).toContain('$80.00 refund');
        expect(message).toContain('leaves the household in credit');
        expect(message).not.toContain('Outstanding by');
        expect(message).toContain('not automatically clawed back');
    });
});
