import { describe, it, expect } from 'vitest';
import {
    getBillAnnualAmount,
    getBillMonthlyAmount,
    calculateAnnualSummary,
    getPaymentTotalForMember,
    getMemberPayments,
    isLinkedToAnyone,
    getParentMember,
    calculateSettlementMetrics
} from '@/lib/calculations.js';

describe('getBillAnnualAmount', () => {
    it('returns amount directly for annual bills', () => {
        expect(getBillAnnualAmount({ billingFrequency: 'annual', amount: 1200 })).toBe(1200);
    });

    it('multiplies monthly bills by 12', () => {
        expect(getBillAnnualAmount({ billingFrequency: 'monthly', amount: 100 })).toBe(1200);
    });

    it('defaults to monthly when no frequency specified', () => {
        expect(getBillAnnualAmount({ amount: 50 })).toBe(600);
    });
});

describe('getBillMonthlyAmount', () => {
    it('divides annual bills by 12', () => {
        expect(getBillMonthlyAmount({ billingFrequency: 'annual', amount: 1200 })).toBe(100);
    });

    it('returns amount directly for monthly bills', () => {
        expect(getBillMonthlyAmount({ billingFrequency: 'monthly', amount: 100 })).toBe(100);
    });
});

describe('calculateAnnualSummary', () => {
    const members = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
    ];

    it('creates summary entries for each member', () => {
        const summary = calculateAnnualSummary(members, []);
        expect(summary[1]).toBeDefined();
        expect(summary[2]).toBeDefined();
        expect(summary[1].total).toBe(0);
    });

    it('splits bill cost evenly among assigned members', () => {
        const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 2] }];
        const summary = calculateAnnualSummary(members, bills);
        expect(summary[1].total).toBe(600); // 100*12/2
        expect(summary[2].total).toBe(600);
    });

    it('assigns full cost when only one member', () => {
        const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1] }];
        const summary = calculateAnnualSummary(members, bills);
        expect(summary[1].total).toBe(1200);
        expect(summary[2].total).toBe(0);
    });

    it('skips bills with empty members array', () => {
        const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [] }];
        const summary = calculateAnnualSummary(members, bills);
        expect(summary[1].total).toBe(0);
    });
});

describe('getPaymentTotalForMember', () => {
    const payments = [
        { memberId: 1, amount: 200 },
        { memberId: 1, amount: 300 },
        { memberId: 2, amount: 100 }
    ];

    it('sums payments for the specified member', () => {
        expect(getPaymentTotalForMember(payments, 1)).toBe(500);
    });

    it('returns 0 for a member with no payments', () => {
        expect(getPaymentTotalForMember(payments, 99)).toBe(0);
    });
});

describe('getMemberPayments', () => {
    const payments = [
        { memberId: 1, amount: 100, receivedAt: '2026-01-01' },
        { memberId: 1, amount: 200, receivedAt: '2026-03-01' },
        { memberId: 2, amount: 50, receivedAt: '2026-02-01' }
    ];

    it('filters and sorts payments newest-first', () => {
        const result = getMemberPayments(payments, 1);
        expect(result).toHaveLength(2);
        expect(result[0].amount).toBe(200); // March first
    });

    it('returns empty array for unknown member', () => {
        expect(getMemberPayments(payments, 99)).toEqual([]);
    });
});

describe('isLinkedToAnyone', () => {
    const members = [
        { id: 1, name: 'Parent', linkedMembers: [2] },
        { id: 2, name: 'Child', linkedMembers: [] }
    ];

    it('returns true if another member links to this one', () => {
        expect(isLinkedToAnyone(members, 2)).toBe(true);
    });

    it('returns false if no member links to this one', () => {
        expect(isLinkedToAnyone(members, 1)).toBe(false);
    });
});

describe('getParentMember', () => {
    const members = [
        { id: 1, name: 'Parent', linkedMembers: [2] },
        { id: 2, name: 'Child', linkedMembers: [] }
    ];

    it('returns the parent member', () => {
        expect(getParentMember(members, 2)).toEqual(members[0]);
    });

    it('returns undefined for unlinked members', () => {
        expect(getParentMember(members, 1)).toBeUndefined();
    });
});

describe('calculateSettlementMetrics', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 2] }];

    it('calculates total annual, payments, and outstanding', () => {
        const payments = [{ memberId: 1, amount: 600 }];
        const m = calculateSettlementMetrics(members, bills, payments);
        expect(m.totalAnnual).toBe(1200);
        expect(m.totalPayments).toBe(600);
        expect(m.totalOutstanding).toBe(600);
        expect(m.totalMembers).toBe(2);
    });

    it('caps percentage at 100', () => {
        const payments = [
            { memberId: 1, amount: 1000 },
            { memberId: 2, amount: 1000 }
        ];
        const m = calculateSettlementMetrics(members, bills, payments);
        expect(m.percentage).toBe(100);
    });

    it('counts fully paid members', () => {
        const payments = [
            { memberId: 1, amount: 600 },
            { memberId: 2, amount: 600 }
        ];
        const m = calculateSettlementMetrics(members, bills, payments);
        expect(m.paidCount).toBe(2);
    });

    it('handles linked members — combines totals under parent', () => {
        const linked = [
            { id: 1, name: 'Parent', linkedMembers: [3] },
            { id: 2, name: 'Solo', linkedMembers: [] },
            { id: 3, name: 'Child', linkedMembers: [] }
        ];
        const linkedBills = [{ id: 'b1', amount: 120, billingFrequency: 'annual', members: [1, 2, 3] }];
        const payments = [{ memberId: 1, amount: 80 }]; // parent pays 80 of combined 80 (40+40)
        const m = calculateSettlementMetrics(linked, linkedBills, payments);
        expect(m.totalMembers).toBe(2); // only parent + solo (child is linked)
    });
});
