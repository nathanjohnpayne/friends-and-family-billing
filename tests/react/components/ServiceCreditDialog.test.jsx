import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import ServiceCreditDialog from '@/app/components/ServiceCreditDialog.jsx';

// A bill with two assigned members (Alice, Bob). The dialog is bill-scoped (#321,
// ADR 0005): it confirms the bill, captures amount/reason, and offers a bill-level
// split (default) vs a per-member variant.
const bill = { id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1, 2] };
const billMembers = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
];

describe('ServiceCreditDialog', () => {
    it('renders nothing when closed', () => {
        const { container } = render(
            <ServiceCreditDialog open={false} bill={bill} billMembers={billMembers} onSubmit={vi.fn()} onClose={vi.fn()} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('confirms the bill and renders amount, reason, and incurred date fields', () => {
        render(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('Issue Service Credit')).toBeInTheDocument();
        // The bill being credited is shown so the admin confirms the target.
        expect(screen.getByText('Internet')).toBeInTheDocument();
        expect(screen.getByLabelText('Amount ($)')).toBeInTheDocument();
        expect(screen.getByLabelText('Reason')).toBeInTheDocument();
        expect(screen.getByLabelText('Incurred date')).toBeInTheDocument();
    });

    it('defaults to the bill-level split among the bill members (no memberId)', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={onSubmit} onClose={vi.fn()} />);

        await user.type(screen.getByLabelText('Amount ($)'), '90');
        await user.type(screen.getByLabelText('Reason'), 'Outage');
        fireEvent.change(screen.getByLabelText('Incurred date'), { target: { value: '2026-02-01' } });
        await user.click(screen.getByRole('button', { name: 'Save Credit' }));

        expect(onSubmit).toHaveBeenCalledWith({
            amount: 90,
            reason: 'Outage',
            incurredDate: '2026-02-01'
        });
    });

    it('explains that the bill itself is unchanged (Option B)', () => {
        render(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText(/bill.*unchanged|does not change the bill/i)).toBeInTheDocument();
    });

    it('submits a per-member variant with the chosen memberId when "specific member" is selected', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={onSubmit} onClose={vi.fn()} />);

        // Switch from bill-level to a single member.
        await user.click(screen.getByLabelText(/specific member/i));
        await user.selectOptions(screen.getByLabelText('Member'), '2');
        await user.type(screen.getByLabelText('Amount ($)'), '40');
        await user.type(screen.getByLabelText('Reason'), 'Bob-only issue');
        fireEvent.change(screen.getByLabelText('Incurred date'), { target: { value: '2026-03-01' } });
        await user.click(screen.getByRole('button', { name: 'Save Credit' }));

        expect(onSubmit).toHaveBeenCalledWith({
            amount: 40,
            reason: 'Bob-only issue',
            incurredDate: '2026-03-01',
            memberId: 2
        });
    });

    it('blocks submit and shows an error for a non-positive amount', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={onSubmit} onClose={vi.fn()} />);

        await user.type(screen.getByLabelText('Reason'), 'X');
        await user.click(screen.getByRole('button', { name: 'Save Credit' }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByText(/amount greater than zero/i)).toBeInTheDocument();
    });

    it('blocks submit and shows an error for a missing reason', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={onSubmit} onClose={vi.fn()} />);

        await user.type(screen.getByLabelText('Amount ($)'), '50');
        await user.click(screen.getByRole('button', { name: 'Save Credit' }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByText('Enter a reason.')).toBeInTheDocument();
    });

    it('calls onClose on Cancel', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={vi.fn()} onClose={onClose} />);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose on Escape', () => {
        const onClose = vi.fn();
        render(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={vi.fn()} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('preserves in-progress input when the parent rerenders with a fresh billMembers array', async () => {
        // BillsTab passes `familyMembers.filter(...)` — a NEW array identity every
        // render. The reset effect must key off open / bill identity only, so an
        // unrelated parent rerender does not wipe the fields (CodeRabbit #329).
        const user = userEvent.setup();

        function Harness() {
            const [, setTick] = useState(0);
            // A fresh array on every render (identity churn), same logical members.
            const freshBillMembers = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
            return (
                <>
                    <button onClick={() => setTick(t => t + 1)}>rerender parent</button>
                    <ServiceCreditDialog
                        open
                        bill={bill}
                        billMembers={freshBillMembers}
                        onSubmit={vi.fn()}
                        onClose={vi.fn()}
                    />
                </>
            );
        }

        render(<Harness />);
        await user.type(screen.getByLabelText('Amount ($)'), '42');
        await user.type(screen.getByLabelText('Reason'), 'Outage credit');

        // Trigger a parent rerender that hands the dialog a brand-new array identity.
        await user.click(screen.getByRole('button', { name: 'rerender parent' }));

        // Fields must still hold the in-progress input.
        expect(screen.getByLabelText('Amount ($)')).toHaveValue(42);
        expect(screen.getByLabelText('Reason')).toHaveValue('Outage credit');
    });

    it('still resets fields when the dialog reopens', async () => {
        // Closing and reopening (open false → true) must clear, proving the reset
        // still fires on the intended trigger after the dependency narrowing.
        const { rerender } = render(
            <ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={vi.fn()} onClose={vi.fn()} />
        );
        fireEvent.change(screen.getByLabelText('Amount ($)'), { target: { value: '77' } });
        expect(screen.getByLabelText('Amount ($)')).toHaveValue(77);

        rerender(<ServiceCreditDialog open={false} bill={bill} billMembers={billMembers} onSubmit={vi.fn()} onClose={vi.fn()} />);
        rerender(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={vi.fn()} onClose={vi.fn()} />);

        expect(screen.getByLabelText('Amount ($)')).toHaveValue(null); // empty after reopen
    });

    it('surfaces a throwing onSubmit as an inline error and keeps the dialog open', () => {
        // The host (BillsTab) lets service errors propagate; the dialog must show the
        // message inline and NOT close (so input is preserved). Mirrors UsageChargeDialog
        // and the #318 refund dialog — errors are never swallowed.
        const onSubmit = vi.fn(() => { throw new Error('This bill has no members to credit.'); });
        const onClose = vi.fn();
        render(<ServiceCreditDialog open bill={bill} billMembers={billMembers} onSubmit={onSubmit} onClose={onClose} />);
        fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '9.02' } });
        fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Outage' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Credit' }));
        expect(onSubmit).toHaveBeenCalled();
        expect(screen.getByText(/no members to credit/i)).toBeInTheDocument(); // inline error
        expect(onClose).not.toHaveBeenCalled();                                // dialog stays open
    });
});
