import { describe, it, expect, vi } from 'vitest';
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
