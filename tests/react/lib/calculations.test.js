import { describe, it, expect } from 'vitest';
import {
    getBillAnnualAmount,
    getBillMonthlyAmount,
    calculateAnnualSummary,
    getPaymentTotalForMember,
    getMemberPayments,
    isLinkedToAnyone,
    getParentMember,
    calculateSettlementMetrics,
    getCreditAdjustmentTotalForMember,
    getHouseholdFinancials,
    getDeferredUsageChargeTotalForMember,
    getHouseholdDeferredCharges,
    CREDIT_EPSILON
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

// ──────────────── Off-cycle credits (#316) ────────────────
//
// Net Contribution = gross paid − recorded refunds/carry-forwards. A household's
// Credit is the net amount overpaid, computed at the household grain (ADR 0001).
// These are read-only display calculations — no mutations are introduced here.

describe('CREDIT_EPSILON', () => {
    it('is a small sub-cent threshold (about half a cent)', () => {
        expect(CREDIT_EPSILON).toBeGreaterThan(0);
        expect(CREDIT_EPSILON).toBeLessThan(0.01);
    });
});

describe('getCreditAdjustmentTotalForMember', () => {
    const adjustments = [
        { id: 'c1', memberId: 1, type: 'refund', amount: 50, status: 'recorded' },
        { id: 'c2', memberId: 1, type: 'carry_forward', amount: 20, status: 'recorded' },
        { id: 'c3', memberId: 1, type: 'refund', amount: 999, status: 'cancelled' },
        { id: 'c4', memberId: 2, type: 'refund', amount: 10, status: 'recorded' }
    ];

    it('sums active refunds and carry-forwards for the member', () => {
        expect(getCreditAdjustmentTotalForMember(adjustments, 1)).toBe(70); // 50 + 20
    });

    it('excludes cancelled adjustments', () => {
        // c3 (999, cancelled) must not be counted
        expect(getCreditAdjustmentTotalForMember(adjustments, 1)).toBe(70);
    });

    it('returns 0 for a member with no adjustments', () => {
        expect(getCreditAdjustmentTotalForMember(adjustments, 99)).toBe(0);
    });

    it('returns 0 for an empty or missing array', () => {
        expect(getCreditAdjustmentTotalForMember([], 1)).toBe(0);
        expect(getCreditAdjustmentTotalForMember(undefined, 1)).toBe(0);
    });

    it('excludes an adjustment whose id is in the reopened set (#319, ADR 0003)', () => {
        // c1 (the 50 refund) re-opened by an active not_received — only c2 (20) remains.
        expect(getCreditAdjustmentTotalForMember(adjustments, 1, new Set(['c1']))).toBe(20);
    });

    it('counts every active adjustment when the reopened set is null or empty', () => {
        expect(getCreditAdjustmentTotalForMember(adjustments, 1, null)).toBe(70);
        expect(getCreditAdjustmentTotalForMember(adjustments, 1, new Set())).toBe(70);
    });
});

describe('getHouseholdFinancials', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    // $100/month split two ways → $600/yr owed each
    const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 2] }];
    const summary = calculateAnnualSummary(members, bills);

    it('net contribution equals gross paid when there are no adjustments', () => {
        const payments = [{ memberId: 1, amount: 600 }];
        const f = getHouseholdFinancials(members[0], summary, payments, []);
        expect(f.owed).toBe(600);
        expect(f.grossPaid).toBe(600);
        expect(f.netContribution).toBe(600);
        expect(f.credit).toBe(0);
    });

    it('derives a credit from an overpayment (gross paid exceeds owed)', () => {
        const payments = [{ memberId: 1, amount: 668.98 }]; // owed 600
        const f = getHouseholdFinancials(members[0], summary, payments, []);
        expect(f.credit).toBeCloseTo(68.98, 5);
    });

    it('a recorded refund reduces net contribution so the household reads settled (zero credit)', () => {
        const payments = [{ memberId: 1, amount: 668.98 }];
        const creditAdjustments = [{ id: 'c1', memberId: 1, type: 'refund', amount: 68.98, status: 'recorded' }];
        const f = getHouseholdFinancials(members[0], summary, payments, creditAdjustments);
        expect(f.netContribution).toBeCloseTo(600, 5);
        expect(f.credit).toBe(0);
    });

    it('a carried-forward credit also reduces net contribution', () => {
        const payments = [{ memberId: 1, amount: 650 }];
        const creditAdjustments = [{ id: 'c1', memberId: 1, type: 'carry_forward', amount: 50, status: 'recorded' }];
        const f = getHouseholdFinancials(members[0], summary, payments, creditAdjustments);
        expect(f.netContribution).toBe(600);
        expect(f.credit).toBe(0);
    });

    it('treats a sub-cent rounding credit as zero (epsilon)', () => {
        const payments = [{ memberId: 1, amount: 600.004 }]; // 0.004 < CREDIT_EPSILON
        const f = getHouseholdFinancials(members[0], summary, payments, []);
        expect(f.credit).toBe(0);
    });

    it('nets internal member imbalance out at the household grain (ADR 0001)', () => {
        const householdMembers = [
            { id: 1, name: 'Primary', linkedMembers: [3] },
            { id: 3, name: 'Linked', linkedMembers: [] }
        ];
        // $100/month split two ways → $600/yr owed each, household owes $1200
        const hhBills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 3] }];
        const hhSummary = calculateAnnualSummary(householdMembers, hhBills);
        // Primary overpays by 50, Linked underpays by 50 → household nets to exactly owed
        const payments = [{ memberId: 1, amount: 650 }, { memberId: 3, amount: 550 }];
        const f = getHouseholdFinancials(householdMembers[0], hhSummary, payments, []);
        expect(f.owed).toBe(1200);
        expect(f.grossPaid).toBe(1200);
        expect(f.netContribution).toBe(1200);
        expect(f.credit).toBe(0); // internal imbalance is invisible to the household credit
    });

    it('re-opens the credit when its refund is in the reopened set (#319, ADR 0003)', () => {
        const payments = [{ memberId: 1, amount: 668.98 }]; // owed 600
        const creditAdjustments = [{ id: 'c1', memberId: 1, type: 'refund', amount: 68.98, status: 'recorded' }];
        // Without re-open the refund disposes the credit (net 600, credit 0). With c1
        // re-opened, the disposition is excluded: net climbs back and the credit is owed again.
        const f = getHouseholdFinancials(members[0], summary, payments, creditAdjustments, new Set(['c1']));
        expect(f.netContribution).toBeCloseTo(668.98, 5);
        expect(f.credit).toBeCloseTo(68.98, 5);
    });
});

describe('calculateSettlementMetrics — credits (Net Contribution)', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 2] }]; // 600 each

    it('reports zero credits owed when no household has overpaid', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const m = calculateSettlementMetrics(members, bills, payments);
        expect(m.totalCreditsOwed).toBe(0);
    });

    it('tracks totalCreditsOwed on a separate axis from outstanding', () => {
        // Alice overpays (credit 68.98), Bob pays exactly. Nothing is outstanding,
        // yet 68.98 is owed back to members — the two figures are independent.
        const payments = [{ memberId: 1, amount: 668.98 }, { memberId: 2, amount: 600 }];
        const m = calculateSettlementMetrics(members, bills, payments);
        expect(m.totalCreditsOwed).toBeCloseTo(68.98, 5);
        expect(m.totalOutstanding).toBe(0);
    });

    it('a recorded refund clears the credit and the household still counts as settled', () => {
        const payments = [
            { memberId: 1, amount: 668.98 },
            { memberId: 2, amount: 600 }
        ];
        const creditAdjustments = [{ id: 'c1', memberId: 1, type: 'refund', amount: 68.98, status: 'recorded' }];
        const m = calculateSettlementMetrics(members, bills, payments, creditAdjustments);
        expect(m.totalCreditsOwed).toBe(0);
        expect(m.paidCount).toBe(2); // both households settled
    });

    it('an overpaid household counts as settled but still surfaces its credit', () => {
        const payments = [
            { memberId: 1, amount: 668.98 },
            { memberId: 2, amount: 600 }
        ];
        const m = calculateSettlementMetrics(members, bills, payments);
        expect(m.paidCount).toBe(2); // overpaid does not block settlement
        expect(m.totalCreditsOwed).toBeCloseTo(68.98, 5);
    });

    it('excludes sub-cent rounding credits from totalCreditsOwed (epsilon)', () => {
        const payments = [{ memberId: 1, amount: 600.004 }, { memberId: 2, amount: 600 }];
        const m = calculateSettlementMetrics(members, bills, payments);
        expect(m.totalCreditsOwed).toBe(0);
    });

    it('defaults creditAdjustments to an empty array (backward-compatible 3-arg call)', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const m = calculateSettlementMetrics(members, bills, payments);
        expect(m.totalCreditsOwed).toBe(0);
        expect(m.paidCount).toBe(2);
    });

    it('does not let a recorded refund mask another household shortfall', () => {
        // Alice paid 668.98 with a 68.98 refund (net 600, settled); Bob paid 500 (owes 100).
        // The refunded money left the ledger and must not offset Bob's debt.
        const payments = [
            { memberId: 1, amount: 668.98 },
            { memberId: 2, amount: 500 }
        ];
        const creditAdjustments = [{ id: 'c1', memberId: 1, type: 'refund', amount: 68.98, status: 'recorded' }];
        const m = calculateSettlementMetrics(members, bills, payments, creditAdjustments);
        expect(m.totalOutstanding).toBeCloseTo(100, 5); // Bob's real shortfall, not 31.02
        expect(m.totalCreditsOwed).toBe(0);
        expect(m.paidCount).toBe(1);
    });

    it('does not let an overpayment mask another household shortfall or count as progress', () => {
        // Alice overpaid (668.98 of 600, unrefunded); Bob paid 500 (owes 100). Per-household
        // net shortfalls keep Alice's surplus from masking Bob's debt or inflating progress.
        const payments = [
            { memberId: 1, amount: 668.98 },
            { memberId: 2, amount: 500 }
        ];
        const m = calculateSettlementMetrics(members, bills, payments);
        expect(m.totalOutstanding).toBeCloseTo(100, 5);       // not the global 31.02
        expect(m.totalCreditsOwed).toBeCloseTo(68.98, 5);      // Alice's credit, separate axis
        expect(m.percentage).toBe(92);                         // (1200 − 100) / 1200, not gross 97
    });

    it('re-opens a not-received refund into totalCreditsOwed without touching outstanding (#319, ADR 0003)', () => {
        // Alice's 68.98 refund was recorded (credit disposed), but she reported not_received.
        // While the year is open the refund re-opens: the credit is owed again, yet outstanding
        // stays zero (a re-opened credit is overpayment owed back, never a shortfall) and the
        // household still counts as settled.
        const payments = [{ memberId: 1, amount: 668.98 }, { memberId: 2, amount: 600 }];
        const creditAdjustments = [{ id: 'c1', memberId: 1, type: 'refund', amount: 68.98, status: 'recorded' }];
        const m = calculateSettlementMetrics(members, bills, payments, creditAdjustments, new Set(['c1']));
        expect(m.totalCreditsOwed).toBeCloseTo(68.98, 5);
        expect(m.totalOutstanding).toBe(0);
        expect(m.paidCount).toBe(2);
    });

    it('keeps the refund disposed when the reopened set is empty (closed year / no active not_received)', () => {
        const payments = [{ memberId: 1, amount: 668.98 }, { memberId: 2, amount: 600 }];
        const creditAdjustments = [{ id: 'c1', memberId: 1, type: 'refund', amount: 68.98, status: 'recorded' }];
        const m = calculateSettlementMetrics(members, bills, payments, creditAdjustments, new Set());
        expect(m.totalCreditsOwed).toBe(0);
    });
});

// ── Usage Charges (deferred, #317) ──────────────────────────────────────
//
// A deferred Usage Charge is a +owed per-member adjustment that is recorded and
// visible but NOT yet billed, so it must not affect current-year settlement.
// These helpers surface the running count and total without touching owed/credit.

describe('getDeferredUsageChargeTotalForMember', () => {
    it('sums only deferred usage charges for the given member', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 5.5, status: 'deferred' },
            { id: 'o3', memberId: 2, kind: 'usage_charge', amount: 99, status: 'deferred' }
        ];
        expect(getDeferredUsageChargeTotalForMember(owedAdjustments, 1)).toBeCloseTo(15.5, 5);
    });

    it('excludes voided charges (append-only: void via status, never delete)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 7, status: 'voided' }
        ];
        expect(getDeferredUsageChargeTotalForMember(owedAdjustments, 1)).toBeCloseTo(10, 5);
    });

    it('excludes already-billed charges (only deferred are pending)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 20, status: 'billed' }
        ];
        expect(getDeferredUsageChargeTotalForMember(owedAdjustments, 1)).toBeCloseTo(10, 5);
    });

    it('ignores credit-direction adjustments (service credits are #321, not usage charges)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred' },
            { id: 'o2', memberId: 1, kind: 'service_credit', amount: -30, status: 'deferred' }
        ];
        expect(getDeferredUsageChargeTotalForMember(owedAdjustments, 1)).toBeCloseTo(10, 5);
    });

    it('returns 0 for an undefined or empty array', () => {
        expect(getDeferredUsageChargeTotalForMember(undefined, 1)).toBe(0);
        expect(getDeferredUsageChargeTotalForMember([], 1)).toBe(0);
    });
});

describe('getHouseholdDeferredCharges', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [3] },
        { id: 2, name: 'Bob', linkedMembers: [] },
        { id: 3, name: 'Carol', linkedMembers: [] }
    ];

    it('aggregates deferred count and total across the whole household (ADR 0001 grain)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred' },
            { id: 'o2', memberId: 3, kind: 'usage_charge', amount: 5, status: 'deferred' }, // linked member
            { id: 'o3', memberId: 3, kind: 'usage_charge', amount: 2.5, status: 'deferred' }
        ];
        const { count, total } = getHouseholdDeferredCharges(members[0], owedAdjustments);
        expect(count).toBe(3);
        expect(total).toBeCloseTo(17.5, 5);
    });

    it('does not count another household charges', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 2, kind: 'usage_charge', amount: 40, status: 'deferred' }
        ];
        const { count, total } = getHouseholdDeferredCharges(members[0], owedAdjustments);
        expect(count).toBe(0);
        expect(total).toBe(0);
    });

    it('excludes voided and billed charges from the running total', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 99, status: 'voided' },
            { id: 'o3', memberId: 1, kind: 'usage_charge', amount: 50, status: 'billed' }
        ];
        const { count, total } = getHouseholdDeferredCharges(members[0], owedAdjustments);
        expect(count).toBe(1);
        expect(total).toBeCloseTo(10, 5);
    });
});

describe('deferred usage charges do not affect settlement', () => {
    const members = [{ id: 1, name: 'Alice', linkedMembers: [] }];
    const bills = [{ id: 101, name: 'Internet', amount: 100, billingFrequency: 'annual', members: [1] }];

    it('a deferred usage charge does NOT change owed, balance, or credit', () => {
        const payments = [{ memberId: 1, amount: 100 }]; // fully settled on bills
        const summary = calculateAnnualSummary(members, bills);
        // owedAdjustments are intentionally not an input to getHouseholdFinancials:
        // a deferred charge must not raise owed. The household reads settled.
        const f = getHouseholdFinancials(members[0], summary, payments, []);
        expect(f.owed).toBeCloseTo(100, 5);
        expect(f.netContribution).toBeCloseTo(100, 5);
        expect(f.credit).toBe(0);
    });

    it('settlement metrics ignore deferred charges entirely', () => {
        const payments = [{ memberId: 1, amount: 100 }];
        const m = calculateSettlementMetrics(members, bills, payments, []);
        expect(m.totalOutstanding).toBe(0);
        expect(m.paidCount).toBe(1);
        expect(m.percentage).toBe(100);
    });
});
