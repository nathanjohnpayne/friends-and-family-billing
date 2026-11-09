import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ChargeNoticeDialog from '@/app/components/ChargeNoticeDialog.jsx';

// Two June charges + one May charge for the same member; "this month" is June 2026.
const JUNE = new Date(2026, 5, 15);
const charges = [
    { id: 'o1', description: 'Roaming', amount: 10, incurredDate: '2026-06-03' },
    { id: 'o2', description: 'Overage', amount: 5, incurredDate: '2026-06-20' },
    { id: 'o3', description: 'Old item', amount: 7, incurredDate: '2026-05-15' }
];

function renderDialog(props = {}) {
    return render(
        <ChargeNoticeDialog
            open
            memberName="Alice"
            charges={charges}
            now={JUNE}
            onConfirm={vi.fn()}
            onClose={vi.fn()}
            {...props}
        />
    );
}

describe('ChargeNoticeDialog', () => {
    it('renders nothing when closed', () => {
        const { container } = render(
            <ChargeNoticeDialog open={false} memberName="Alice" charges={charges} onConfirm={vi.fn()} onClose={vi.fn()} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('shows the member name and a Charge Notice title', () => {
        renderDialog();
        expect(screen.getByText('Bill Charges')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('defaults to ALL deferred charges and shows the combined total', () => {
        renderDialog();
        // Default = all deferred → 10 + 5 + 7 = 22
        expect(screen.getByText(/\$22\.00/)).toBeInTheDocument();
        // Each candidate charge line is listed
        expect(screen.getByText('Roaming')).toBeInTheDocument();
        expect(screen.getByText('Overage')).toBeInTheDocument();
        expect(screen.getByText('Old item')).toBeInTheDocument();
    });

    it('the "This month" preset narrows the preview to this calendar month', () => {
        renderDialog();
        fireEvent.click(screen.getByLabelText('This month'));
        // June charges only → 10 + 5 = 15; the May "Old item" drops out.
        expect(screen.getByText(/\$15\.00/)).toBeInTheDocument();
        expect(screen.queryByText('Old item')).toBeNull();
        expect(screen.getByText('Roaming')).toBeInTheDocument();
    });

    it('confirms with the selected charge ids and closes (default = all)', () => {
        const onConfirm = vi.fn();
        const onClose = vi.fn();
        renderDialog({ onConfirm, onClose });
        fireEvent.click(screen.getByText('Bill & Notify'));
        expect(onConfirm).toHaveBeenCalledWith(['o3', 'o1', 'o2']); // sorted by incurred date
        expect(onClose).toHaveBeenCalled();
    });

    it('confirms with only this-month ids when the preset is active', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });
        fireEvent.click(screen.getByLabelText('This month'));
        fireEvent.click(screen.getByText('Bill & Notify'));
        expect(onConfirm).toHaveBeenCalledWith(['o1', 'o2']);
    });

    it('calls onClose on Cancel', () => {
        const onClose = vi.fn();
        renderDialog({ onClose });
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
    });

    it('closes on the document-level Escape key handler (#366)', () => {
        // The dialog binds a keydown listener on `document` while open; pressing Escape
        // anywhere must close it. fireEvent is the sanctioned tool for Escape handling
        // (testing-requirements.md § Interaction testing).
        const onClose = vi.fn();
        renderDialog({ onClose });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('shows an empty state and disables Bill & Notify when there are no charges', () => {
        render(
            <ChargeNoticeDialog open memberName="Alice" charges={[]} now={JUNE} onConfirm={vi.fn()} onClose={vi.fn()} />
        );
        expect(screen.getByText(/No deferred charges/i)).toBeInTheDocument();
        const btn = screen.getByText('Bill & Notify').closest('button');
        expect(btn).toBeDisabled();
    });

    it('reads the household member total when billing a household primary', () => {
        // A primary + linked member's charges arrive pre-aggregated by the caller; the
        // dialog simply previews whatever candidate list it is given.
        const householdCharges = [
            { id: 'a1', description: 'Primary item', amount: 10, incurredDate: '2026-06-03' },
            { id: 'c1', description: 'Linked item', amount: 5, incurredDate: '2026-06-04' }
        ];
        render(
            <ChargeNoticeDialog open memberName="Alice household" charges={householdCharges} now={JUNE} onConfirm={vi.fn()} onClose={vi.fn()} />
        );
        const total = screen.getByText('Total to bill').closest('.charge-notice-total');
        expect(within(total).getByText(/\$15\.00/)).toBeInTheDocument();
    });
});


describe('selected Notice canonical preview', () => {
    it('renders allocated half-cent rows and one-cent total without changing the confirmation ids', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({ charges: [{ id: 'a', description: 'January', amount: .005, incurredDate: '2026-01-01' },
            { id: 'b', description: 'February', amount: .005, incurredDate: '2026-02-01' }], onConfirm });
        expect(screen.getByText('January').closest('li')).toHaveTextContent('$0.01');
        expect(screen.getByText('February').closest('li')).toHaveTextContent('$0.00');
        await user.click(screen.getByRole('button', { name: 'Bill & Notify' }));
        expect(onConfirm).toHaveBeenCalledWith(['a', 'b']);
    });

    it('disables a zero-cent selection and withholds an invalid preview', () => {
        const { rerender } = renderDialog({ charges: [{ id: 'a', amount: .004 }] });
        expect(screen.getByRole('button', { name: 'Bill & Notify' })).toBeDisabled();
        rerender(<ChargeNoticeDialog open memberName="Alice" charges={[{ id: 'a', amount: NaN }]}
            onConfirm={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('Financial data unavailable')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Bill & Notify' })).not.toBeInTheDocument();
    });
});


describe('raw-zero visibility without blocking a valid positive selection', () => {
    it('shows excluded zero rows and confirms only the explicitly previewed positive set', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({ charges: [{ id: 'zero', description: 'Legacy zero', amount: 0 },
            { id: 'positive', description: 'Roaming', amount: 1.005 }], onConfirm });
        const excluded = screen.getByRole('region', { name: 'Not billable charges' });
        expect(excluded).toHaveTextContent('Legacy zero — Not billable');
        expect(excluded).toHaveTextContent('not included in this Notice');
        expect(excluded).toHaveTextContent('Correct the affected record before settling this household.');
        expect(screen.getByText('1 charge selected for this Notice.')).toBeInTheDocument();
        expect(screen.getByText('Roaming').closest('li')).toHaveTextContent('$1.01');
        await user.click(screen.getByRole('button', { name: 'Bill & Notify' }));
        expect(onConfirm).toHaveBeenCalledWith(['positive']);
    });

    it('explains a zero-only selection without creating an integrity hold', () => {
        renderDialog({ charges: [{ id: 'zero', description: 'Legacy zero', amount: 0 }] });
        expect(screen.getByRole('region', { name: 'Not billable charges' })).toHaveTextContent('Not billable');
        expect(screen.getByRole('button', { name: 'Bill & Notify' })).toBeDisabled();
        expect(screen.queryByText('Financial data unavailable')).not.toBeInTheDocument();
        expect(screen.getByText('No billable charges in this period.')).toBeInTheDocument();
        expect(screen.queryByText('No deferred charges in this period.')).not.toBeInTheDocument();
    });

    it('keeps both positive .004 source rows in the confirmation even when one displays zero cents', async () => {
        const user = userEvent.setup();
        const onConfirm = vi.fn();
        renderDialog({ charges: [{ id: 'a', description: 'First positive', amount: .004 },
            { id: 'b', description: 'Second positive', amount: .004 }], onConfirm });
        expect(screen.getByText('Second positive').closest('li')).toHaveTextContent('$0.00');
        expect(screen.queryByRole('region', { name: 'Not billable charges' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Bill & Notify' }));
        expect(onConfirm).toHaveBeenCalledWith(['a', 'b']);
    });
});
