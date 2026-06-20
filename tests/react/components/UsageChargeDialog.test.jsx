import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsageChargeDialog from '@/app/components/UsageChargeDialog.jsx';

describe('UsageChargeDialog', () => {
    it('renders nothing when closed', () => {
        const { container } = render(
            <UsageChargeDialog open={false} memberName="Alice" onSubmit={vi.fn()} onClose={vi.fn()} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders amount, description, and incurred date fields for the member', () => {
        render(<UsageChargeDialog open memberName="Alice" onSubmit={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('Add Usage Charge')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByLabelText('Amount ($)')).toBeInTheDocument();
        expect(screen.getByLabelText('Description')).toBeInTheDocument();
        expect(screen.getByLabelText('Incurred date')).toBeInTheDocument();
    });

    it('signals that the charge is deferred / not yet billed', () => {
        render(<UsageChargeDialog open memberName="Alice" onSubmit={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText(/not billed yet/i)).toBeInTheDocument();
    });

    it('submits amount, description, and incurred date', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<UsageChargeDialog open memberName="Alice" onSubmit={onSubmit} onClose={vi.fn()} />);

        await user.type(screen.getByLabelText('Amount ($)'), '12.50');
        await user.type(screen.getByLabelText('Description'), 'Roaming overage');
        fireEvent.change(screen.getByLabelText('Incurred date'), { target: { value: '2025-03-04' } });
        await user.click(screen.getByRole('button', { name: 'Save Charge' }));

        expect(onSubmit).toHaveBeenCalledWith({
            amount: 12.5,
            description: 'Roaming overage',
            incurredDate: '2025-03-04'
        });
    });

    it('blocks submit and shows an error for a non-positive amount', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<UsageChargeDialog open memberName="Alice" onSubmit={onSubmit} onClose={vi.fn()} />);

        await user.type(screen.getByLabelText('Description'), 'X');
        await user.click(screen.getByRole('button', { name: 'Save Charge' }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByText(/amount greater than zero/i)).toBeInTheDocument();
    });

    it('blocks submit and shows an error for a missing description', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn();
        render(<UsageChargeDialog open memberName="Alice" onSubmit={onSubmit} onClose={vi.fn()} />);

        await user.type(screen.getByLabelText('Amount ($)'), '5');
        await user.click(screen.getByRole('button', { name: 'Save Charge' }));

        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByText(/enter a description/i)).toBeInTheDocument();
    });

    it('calls onClose on Cancel', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(<UsageChargeDialog open memberName="Alice" onSubmit={vi.fn()} onClose={onClose} />);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose on Escape', () => {
        const onClose = vi.fn();
        render(<UsageChargeDialog open memberName="Alice" onSubmit={vi.fn()} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('surfaces a throwing onSubmit as an inline error and keeps the dialog open', () => {
        // The host (DashboardView) lets service errors propagate; the dialog must
        // show the message inline and NOT close (so input is preserved).
        const onSubmit = vi.fn(() => { throw new Error('Year is read-only.'); });
        const onClose = vi.fn();
        render(<UsageChargeDialog open memberName="Alice" onSubmit={onSubmit} onClose={onClose} />);
        fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '9.02' } });
        fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Roaming' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Charge' }));
        expect(onSubmit).toHaveBeenCalled();
        expect(screen.getByText(/read-only/i)).toBeInTheDocument(); // inline error
        expect(onClose).not.toHaveBeenCalled();                     // dialog stays open
    });
});
