import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import BillAuditHistoryDialog from '@/app/components/BillAuditHistoryDialog.jsx';
import { buildReviewedRollover } from '@/lib/billing-year.js';

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

    // Year-End Review renderings (#606, specs/year-end-review.md § Bill history).
    describe('Year-End Review events', () => {
        const review = (id, eventType, payload, timestamp = '2026-12-08T14:05:00Z') => ({ id, eventType, timestamp, payload });
        const renderWith = (billingEvents, billId = 101) =>
            render(<BillAuditHistoryDialog open={true} billId={billId} billName="Northline Mobile" billingEvents={billingEvents} onClose={vi.fn()} />);

        it('renders the price set at rollover in the new year', () => {
            renderWith([review('r1', 'BILL_PRICE_ROLLED_OVER', { billId: 101, billName: 'Northline Mobile', previousValue: 180,
                newValue: 198, billingFrequency: 'monthly', fromYear: '2026' })]);
            expect(screen.getByText('Price set at rollover')).toBeInTheDocument();
            expect(screen.getByText('$180.00 → $198.00 (from 2026)')).toBeInTheDocument();
        });

        it('renders a price-change True-up above the shipped events', () => {
            renderWith([...events, review('t1', 'TRUE_UP_RECORDED', { trueUpId: 'tu_2026_101', billId: 101, basis: 'price_change',
                calc: { frequency: 'monthly', fromAmount: 180, toAmount: 198, firstMonth: '2026-07', months: 6, gross: 108 },
                amount: 108, memberCount: 9, memberIds: [1, 2, 3, 4, 5, 6, 7, 8, 9], reconciliationId: 'rec-1' })]);
            expect(screen.getByText('True-up recorded')).toBeInTheDocument();
            const detail = screen.getByText('$180.00 → $198.00 from Jul · $108.00 across 9 members');
            // Newest first: the True-up precedes every earlier event.
            expect(detail.compareDocumentPosition(screen.getByText('Bob left')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('renders a late-start True-up', () => {
            renderWith([review('t2', 'TRUE_UP_RECORDED', { trueUpId: 'tu_2026_new_104', billId: 104, basis: 'late_start',
                calc: { frequency: 'monthly', fromAmount: null, toAmount: 9.99, firstMonth: '2026-09', months: 4, gross: 39.96 },
                amount: 39.96, memberCount: 3, memberIds: [3, 4, 7] })], 104);
            expect(screen.getByText('Started Sep at $9.99 / month · $39.96 across 3 members')).toBeInTheDocument();
        });

        it('renders an ended bill Service Credit, and an ordinary Service Credit as today', () => {
            renderWith([review('s1', 'SERVICE_CREDIT_RECORDED', { billId: 101, amount: 20, basis: 'ended', memberCount: 5,
                calc: { lastMonth: '2026-08', months: 4 } }),
            review('s2', 'SERVICE_CREDIT_RECORDED', { billId: 101, amount: 5, reason: 'Outage', memberCount: 1 }, '2026-04-01T00:00:00Z')]);
            expect(screen.getByText('Ended after Aug · $20.00 across 5 members')).toBeInTheDocument();
            // The ordinary (non-review) credit keeps today's rendering: no detail line.
            expect(screen.getAllByText(/across/)).toHaveLength(1);
            expect(screen.queryByText(/Outage/)).toBeNull();
        });

        it('labels the covered event and leaves malformed review payloads without a detail line', () => {
            renderWith([review('c1', 'SERVICE_CREDIT_COVERED', { billId: 101, basis: 'ended', coveredBy: [] }),
                review('t3', 'TRUE_UP_RECORDED', { billId: 101, basis: 'price_change', calc: { firstMonth: 'July' }, amount: 108, memberCount: 9 })]);
            expect(screen.getByText('Covered by an earlier credit')).toBeInTheDocument();
            expect(screen.getByText('True-up recorded')).toBeInTheDocument();
            expect(screen.queryByText(/across/)).toBeNull();
        });

        it('labels every review event that carries a billId; no row title is a raw event type', () => {
            renderWith([review('s3', 'SERVICE_CREDIT_RECORDED', { billId: 101, amount: 5, reason: 'Outage', memberCount: 1 }),
                review('u1', 'USAGE_CHARGE_RECORDED', { billId: 101, amount: 15, memberId: 2, description: 'Replacement SIM' }),
                review('e1', 'BILL_ENDED_UNASSIGNED', { billId: 101, lastMonth: '2026-08', reconciliationId: 'rec' })]);
            expect(screen.getByText('Service credit recorded')).toBeInTheDocument();
            expect(screen.getByText('Usage charge recorded')).toBeInTheDocument();
            expect(screen.getByText('Bill ended')).toBeInTheDocument();
            expect(screen.queryByText(/^[A-Z_]+$/)).toBeNull();
        });

        it('renders the events the reviewed rollover writes, on both years', () => {
            const source = {
                activeYear: { id: '2026', label: '2026', status: 'open' },
                familyMembers: [1, 2, 3, 4, 5].map(id => ({ id, name: 'M' + id, linkedMembers: [] })),
                bills: [{ id: 101, name: 'Northline Mobile', amount: 180, billingFrequency: 'monthly', members: [1, 2, 3, 4, 5] },
                    { id: 102, name: 'Pinecone Vault', amount: 5, billingFrequency: 'monthly', members: [1, 2, 3, 4, 5] }],
                payments: [1, 2, 3, 4, 5].map(id => ({ id: 'p' + id, memberId: id, amount: 444 })),
                creditAdjustments: [], owedAdjustments: [], billingEvents: [], settings: {}
            };
            let n = 0;
            const result = buildReviewedRollover(source, '2027', { reconciliationId: 'rec-1', sourceYearId: '2026',
                trueUps: [{ billId: 101, newAmount: 198, firstMonth: '2026-07' }], endedBillIds: [102],
                serviceCredits: [{ billId: 102, basis: 'ended', lastMonth: '2026-08' }] },
            { now: '2026-12-08T14:05:00.000Z', userId: 'u', eventId: () => 'evt_' + (++n) });
            const { unmount } = renderWith(result.priorYear.billingEvents);
            expect(screen.getByText('$180.00 → $198.00 from Jul · $108.00 across 5 members')).toBeInTheDocument();
            unmount();
            renderWith(result.priorYear.billingEvents, 102);
            expect(screen.getByText('Ended after Aug · $20.00 across 5 members')).toBeInTheDocument();
            renderWith(result.newYearData.billingEvents);
            expect(screen.getByText('$180.00 → $198.00 (from 2026)')).toBeInTheDocument();
        });
    });

    it('renders nothing when not open', () => {
        const { container } = render(<BillAuditHistoryDialog open={false} billId={101} billName="Internet" billingEvents={events} onClose={vi.fn()} />);
        expect(container.innerHTML).toBe('');
    });
});
