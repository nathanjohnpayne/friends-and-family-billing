import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import BillAuditHistoryDialog from '@/app/components/BillAuditHistoryDialog.jsx';

const events = [
    { id: 'e1', eventType: 'BILL_CREATED', timestamp: '2026-01-01T00:00:00Z', payload: { billId: 101, amount: 100, billingFrequency: 'monthly' } },
    { id: 'e2', eventType: 'BILL_UPDATED', timestamp: '2026-02-01T00:00:00Z', payload: { billId: 101, field: 'amount', previousValue: 100, newValue: 120 } },
    { id: 'e3', eventType: 'MEMBER_ADDED_TO_BILL', timestamp: '2026-02-15T00:00:00Z', payload: { billId: 101, memberName: 'Alice' } },
    { id: 'e4', eventType: 'MEMBER_REMOVED_FROM_BILL', timestamp: '2026-03-01T00:00:00Z', payload: { billId: 101, memberName: 'Bob' } }
];

describe('BillAuditHistoryDialog', () => {
    it('renders event list for the bill', () => {
        render(<BillAuditHistoryDialog open={true} billId={101} billName="Internet" billingEvents={events} onClose={vi.fn()} />);
        expect(screen.getByText('History: Internet')).toBeInTheDocument();
        expect(screen.getByText('Bill created')).toBeInTheDocument();
        expect(screen.getByText('Bill updated')).toBeInTheDocument();
    });

    it('shows detail for amount change', () => {
        render(<BillAuditHistoryDialog open={true} billId={101} billName="Internet" billingEvents={events} onClose={vi.fn()} />);
        expect(screen.getByText('$100.00 \u2192 $120.00')).toBeInTheDocument();
    });

    it('shows member added/removed details', () => {
        render(<BillAuditHistoryDialog open={true} billId={101} billName="Internet" billingEvents={events} onClose={vi.fn()} />);
        expect(screen.getByText('Alice joined')).toBeInTheDocument();
        expect(screen.getByText('Bob left')).toBeInTheDocument();
    });

    it('shows creation detail with frequency', () => {
        render(<BillAuditHistoryDialog open={true} billId={101} billName="Internet" billingEvents={events} onClose={vi.fn()} />);
        expect(screen.getByText('$100.00 / month')).toBeInTheDocument();
    });

    it('shows empty state when no events', () => {
        render(<BillAuditHistoryDialog open={true} billId={101} billName="Internet" billingEvents={[]} onClose={vi.fn()} />);
        expect(screen.getByText('No history recorded yet')).toBeInTheDocument();
    });

    it('filters events to the specific bill', () => {
        const otherEvents = [...events, { id: 'e5', eventType: 'BILL_CREATED', timestamp: '2026-01-01T00:00:00Z', payload: { billId: 999, amount: 50, billingFrequency: 'annual' } }];
        render(<BillAuditHistoryDialog open={true} billId={101} billName="Internet" billingEvents={otherEvents} onClose={vi.fn()} />);
        // Should not show the other bill's event detail
        expect(screen.queryByText('$50.00 / year')).toBeNull();
    });

    it('renders nothing when not open', () => {
        const { container } = render(<BillAuditHistoryDialog open={false} billId={101} billName="Internet" billingEvents={events} onClose={vi.fn()} />);
        expect(container.innerHTML).toBe('');
    });
});
