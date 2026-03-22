import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
