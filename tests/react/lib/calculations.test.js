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
    getHouseholdRecordedRefund,
    getHouseholdFinancials,
    getDeferredUsageChargeTotalForMember,
    getHouseholdDeferredCharges,
    getHouseholdOpeningBalance,
    buildCarryForward,
    getServiceCreditTotalForMember,
    getBilledUsageChargeTotalForMember,
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

    it('counts a zero-balance household (on no bill) as paid so it does not block Ready to Close', () => {
        // Only Alice is on the bill; Bob is assigned to nothing → zero balance.
        const oneOnBill = [{ id: 'b1', amount: 100, billingFrequency: 'annual', members: [1] }];
        const payments = [{ memberId: 1, amount: 100 }];
        const m = calculateSettlementMetrics(members, oneOnBill, payments);
        expect(m.paidCount).toBe(2); // both households count as paid
        expect(m.totalOutstanding).toBe(0);
        expect(m.percentage).toBe(100);
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

describe('getHouseholdRecordedRefund (#331)', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [3] },
        { id: 2, name: 'Bob', linkedMembers: [] },
        { id: 3, name: 'Carol', linkedMembers: [] }
    ];

    it('detects an active refund issued to the primary and reports the total', () => {
        const adjustments = [
            { id: 'c1', memberId: 1, type: 'refund', amount: 50, status: 'recorded' }
        ];
        const { has, total } = getHouseholdRecordedRefund(members[0], adjustments);
        expect(has).toBe(true);
        expect(total).toBeCloseTo(50, 5);
    });

    it('sums refunds across the whole household (primary + linked, ADR 0001 grain)', () => {
        const adjustments = [
            { id: 'c1', memberId: 1, type: 'refund', amount: 50, status: 'recorded' },
            { id: 'c2', memberId: 3, type: 'refund', amount: 12.5, status: 'recorded' } // linked member
        ];
        const { has, total } = getHouseholdRecordedRefund(members[0], adjustments);
        expect(has).toBe(true);
        expect(total).toBeCloseTo(62.5, 5);
    });

    it('excludes cancelled refunds', () => {
        const adjustments = [
            { id: 'c1', memberId: 1, type: 'refund', amount: 999, status: 'cancelled' }
        ];
        expect(getHouseholdRecordedRefund(members[0], adjustments)).toEqual({ has: false, total: 0 });
    });

    it('excludes carried-forward credits — only true refunds count (#316)', () => {
        const adjustments = [
            { id: 'c1', memberId: 1, type: 'carry_forward', amount: 40, status: 'recorded' }
        ];
        expect(getHouseholdRecordedRefund(members[0], adjustments)).toEqual({ has: false, total: 0 });
    });

    it('does not count another household refund', () => {
        const adjustments = [
            { id: 'c1', memberId: 2, type: 'refund', amount: 30, status: 'recorded' }
        ];
        expect(getHouseholdRecordedRefund(members[0], adjustments)).toEqual({ has: false, total: 0 });
    });

    it('is safe for an empty/missing array or missing member', () => {
        expect(getHouseholdRecordedRefund(members[0], [])).toEqual({ has: false, total: 0 });
        expect(getHouseholdRecordedRefund(members[0], undefined)).toEqual({ has: false, total: 0 });
        expect(getHouseholdRecordedRefund(undefined, [{ id: 'c1', memberId: 1, type: 'refund', amount: 5, status: 'recorded' }]))
            .toEqual({ has: false, total: 0 });
    });

    it('keeps total finite when a refund amount is malformed (no NaN/string leakage)', () => {
        const adjustments = [
            { id: 'c1', memberId: 1, type: 'refund', amount: 50, status: 'recorded' },
            { id: 'c2', memberId: 1, type: 'refund', amount: 'not-a-number', status: 'recorded' },
            { id: 'c3', memberId: 1, type: 'refund', status: 'recorded' } // missing amount
        ];
        const { has, total } = getHouseholdRecordedRefund(members[0], adjustments);
        expect(has).toBe(true); // the active refund records still trigger the warning
        expect(Number.isFinite(total)).toBe(true);
        expect(total).toBeCloseTo(50, 5); // only the valid amount contributes
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

    // ── Service Credits (#321, ADR 0005): a −owed adjustment, 6th arg ──
    // Combined signature is getHouseholdFinancials(member, summary, payments,
    // creditAdjustments, reopenedAdjustmentIds, owedAdjustments): the reopen set is
    // 5th (#319) and owedAdjustments is 6th (#321), so these pass null for the 5th.
    it('an active service credit lowers the household owed (6th arg)', () => {
        const payments = [{ memberId: 1, amount: 600 }]; // exactly owed before the credit
        // $90 service credit for Alice → owed 510, she has paid 600 → credit 90
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 90, status: 'active' }
        ];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed).toBeCloseTo(510, 5);
        expect(f.netContribution).toBeCloseTo(600, 5);
        expect(f.credit).toBeCloseTo(90, 5);
    });

    it('produces a Credit on the existing axis when the member has already paid in full', () => {
        const payments = [{ memberId: 1, amount: 600 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 50, status: 'active' }
        ];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        // No new disposition path: the surplus rides netContribution − owed.
        expect(f.credit).toBeCloseTo(50, 5);
    });

    it('only reduces owed (no negative credit) when the member has not paid', () => {
        const payments = []; // nothing paid yet; owed 600 → 540 after a 60 credit
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 60, status: 'active' }
        ];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed).toBeCloseTo(540, 5);
        expect(f.netContribution).toBeCloseTo(0, 5);
        expect(f.credit).toBe(0); // still owed 540, not a credit
    });

    it('floors owed at zero when the service credit exceeds owed (surplus becomes credit)', () => {
        const payments = [{ memberId: 1, amount: 600 }];
        // A credit larger than owed: owed floors at 0, the whole payment is now surplus.
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 750, status: 'active' }
        ];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed).toBe(0); // never negative — owed cannot go below zero
        expect(f.credit).toBeCloseTo(600, 5); // entire payment is owed back
    });

    it('excludes voided service credits (append-only: void via status)', () => {
        const payments = [{ memberId: 1, amount: 600 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 90, status: 'voided' }
        ];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed).toBeCloseTo(600, 5); // voided credit does not reduce owed
        expect(f.credit).toBe(0);
    });

    it('ignores usage charges in the owedAdjustments arg (only service credits reduce owed)', () => {
        const payments = [{ memberId: 1, amount: 600 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'deferred' }
        ];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed).toBeCloseTo(600, 5); // a deferred usage charge never touches owed here
        expect(f.credit).toBe(0);
    });

    it('aggregates service credits across the whole household (ADR 0001 grain)', () => {
        const householdMembers = [
            { id: 1, name: 'Primary', linkedMembers: [3] },
            { id: 3, name: 'Linked', linkedMembers: [] }
        ];
        const hhBills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 3] }];
        const hhSummary = calculateAnnualSummary(householdMembers, hhBills);
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 3, amount: 600 }]; // paid 1200, owed 1200
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 30, status: 'active' },
            { id: 'o2', memberId: 3, kind: 'service_credit', amount: 20, status: 'active' }
        ];
        const f = getHouseholdFinancials(householdMembers[0], hhSummary, payments, [], null, owedAdjustments);
        expect(f.owed).toBeCloseTo(1150, 5); // 1200 − 50
        expect(f.credit).toBeCloseTo(50, 5); // household paid 1200, owes 1150 → 50 back
    });

    it('a service credit and a re-opened refund compose (reopen 5th, owedAdjustments 6th)', () => {
        // #319 ⊕ #321 interaction: owed is reduced by the service credit AND the refund
        // disposition is excluded by the reopen set, so the credit reflects both.
        const payments = [{ memberId: 1, amount: 600 }]; // owed 600 before the credit
        const creditAdjustments = [{ id: 'c1', memberId: 1, type: 'refund', amount: 40, status: 'recorded' }];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 90, status: 'active' }
        ];
        // owed = 600 − 90 = 510. Refund c1 re-opened → netContribution stays 600 (40 not subtracted).
        const f = getHouseholdFinancials(members[0], summary, payments, creditAdjustments, new Set(['c1']), owedAdjustments);
        expect(f.owed).toBeCloseTo(510, 5);
        expect(f.netContribution).toBeCloseTo(600, 5);
        expect(f.credit).toBeCloseTo(90, 5);
    });

    it('defaults owedAdjustments to empty (backward-compatible call unaffected)', () => {
        const payments = [{ memberId: 1, amount: 600 }];
        const f = getHouseholdFinancials(members[0], summary, payments, []);
        expect(f.owed).toBe(600);
        expect(f.credit).toBe(0);
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
        // getHouseholdFinancials does read owedAdjustments (for service credits, #321),
        // but a deferred USAGE CHARGE is a +owed item that is not yet billed, so it must
        // not raise owed. Passing it in explicitly proves the isolation. Reads settled.
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'deferred' }];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed).toBeCloseTo(100, 5);
        expect(f.netContribution).toBeCloseTo(100, 5);
        expect(f.credit).toBe(0);
    });

    it('settlement metrics ignore deferred charges entirely', () => {
        const payments = [{ memberId: 1, amount: 100 }];
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'deferred' }];
        const m = calculateSettlementMetrics(members, bills, payments, [], null, owedAdjustments);
        expect(m.totalOutstanding).toBe(0);
        expect(m.paidCount).toBe(1);
        expect(m.percentage).toBe(100);
    });
});

// ── Carry-forward seam (#322, ADR 0005/0006/0007) ───────────────────────────
//
// Closing/rolling a year auto-carries UNDISPOSED items into next year:
// undisposed Credits (creditAdjustments) and still-deferred Usage Charges
// (owedAdjustments). buildCarryForward is the single shared seam (ADR 0005):
// it computes, per household, the carryable credit and remaining deferred
// charges, and nets them to ONE opening balance (credits negative, charges
// positive). getHouseholdOpeningBalance reads the SEED records the new year is
// built with, so the carried balance lands in the new year's owed/annual total.

describe('getHouseholdOpeningBalance', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [3] },
        { id: 2, name: 'Bob', linkedMembers: [] },
        { id: 3, name: 'Carol', linkedMembers: [] }
    ];

    it('sums carry-in seed records across the whole household (ADR 0001 grain)', () => {
        // A negative seed is a carried credit (owe less); a positive seed is a
        // carried charge (owe more). They net to one household opening balance.
        const owedAdjustments = [
            { id: 's1', memberId: 1, kind: 'carry_opening', amount: -40, status: 'carried_in', fromYear: '2025' },
            { id: 's2', memberId: 3, kind: 'carry_opening', amount: 10, status: 'carried_in', fromYear: '2025' }
        ];
        expect(getHouseholdOpeningBalance(members[0], owedAdjustments)).toBeCloseTo(-30, 5);
    });

    it('returns 0 when the household has no carry-in records', () => {
        const owedAdjustments = [
            { id: 's1', memberId: 2, kind: 'carry_opening', amount: -15, status: 'carried_in' }
        ];
        expect(getHouseholdOpeningBalance(members[0], owedAdjustments)).toBe(0);
    });

    it('ignores deferred usage charges (those are pending, not opening balance)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 25, status: 'deferred' },
            { id: 's1', memberId: 1, kind: 'carry_opening', amount: -40, status: 'carried_in' }
        ];
        expect(getHouseholdOpeningBalance(members[0], owedAdjustments)).toBeCloseTo(-40, 5);
    });

    it('returns 0 for an undefined or empty array', () => {
        expect(getHouseholdOpeningBalance(members[0], undefined)).toBe(0);
        expect(getHouseholdOpeningBalance(members[0], [])).toBe(0);
    });
});

describe('getHouseholdFinancials — opening balance (#322)', () => {
    const members = [{ id: 1, name: 'Alice', linkedMembers: [] }];
    // $50/month → $600/yr owed
    const bills = [{ id: 'b1', amount: 50, billingFrequency: 'monthly', members: [1] }];
    const summary = calculateAnnualSummary(members, bills);

    it('a carried credit (negative opening balance) lowers owed', () => {
        // Opening balance −100 means the household starts owing 600 − 100 = 500.
        // openingBalance is the 7th arg (5th is #319's reopenedAdjustmentIds, 6th is
        // #320/#321's owedAdjustments).
        const f = getHouseholdFinancials(members[0], summary, [], [], null, [], -100);
        expect(f.owed).toBeCloseTo(500, 5);
    });

    it('a carried charge (positive opening balance) raises owed', () => {
        const f = getHouseholdFinancials(members[0], summary, [], [], null, [], 75);
        expect(f.owed).toBeCloseTo(675, 5);
    });

    it('defaults the opening balance to 0 (backward-compatible 5-arg call)', () => {
        const f = getHouseholdFinancials(members[0], summary, [], [], null);
        expect(f.owed).toBeCloseTo(600, 5);
    });

    it('a carried credit makes a household that pays the reduced total read settled', () => {
        // Owed 600, opening −100 → net owed 500. Pay 500 → settled, no credit.
        const payments = [{ memberId: 1, amount: 500 }];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, [], -100);
        expect(f.owed).toBeCloseTo(500, 5);
        expect(f.netContribution).toBeCloseTo(500, 5);
        expect(f.credit).toBe(0);
    });
});

describe('buildCarryForward — undisposed items roll to next year (#322)', () => {
    // Two solo households. $50/month each split? No — give each their own bill so
    // owed is independent and easy to reason about.
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    // Alice owes 600 (b1), Bob owes 600 (b2).
    const bills = [
        { id: 'b1', amount: 50, billingFrequency: 'monthly', members: [1] },
        { id: 'b2', amount: 50, billingFrequency: 'monthly', members: [2] }
    ];

    it('carries an undisposed credit as a negative opening balance', () => {
        // Alice overpays by 80 (credit 80, undisposed). Bob exactly pays.
        const payments = [{ memberId: 1, amount: 680 }, { memberId: 2, amount: 600 }];
        const result = buildCarryForward(members, bills, payments, [], []);
        const alice = result.households.find(h => h.primaryMemberId === 1);
        expect(alice.credit).toBeCloseTo(80, 5);
        expect(alice.deferredChargeTotal).toBe(0);
        expect(alice.openingBalance).toBeCloseTo(-80, 5); // credit is negative
        // Bob has nothing undisposed → not in households
        expect(result.households.some(h => h.primaryMemberId === 2)).toBe(false);
    });

    it('carries still-deferred usage charges as a positive opening balance', () => {
        const payments = [{ memberId: 1, amount: 600 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 30, status: 'deferred' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 12.5, status: 'deferred' }
        ];
        const result = buildCarryForward(members, bills, payments, [], owedAdjustments);
        const alice = result.households.find(h => h.primaryMemberId === 1);
        expect(alice.deferredChargeTotal).toBeCloseTo(42.5, 5);
        expect(alice.deferredChargeIds.sort()).toEqual(['o1', 'o2']);
        expect(alice.openingBalance).toBeCloseTo(42.5, 5); // charges are positive
    });

    it('nets a credit and a deferred charge into one opening balance', () => {
        // Alice overpays by 100 (credit 100) AND has a 30 deferred charge.
        // Net opening balance = 30 − 100 = −70.
        const payments = [{ memberId: 1, amount: 700 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 30, status: 'deferred' }
        ];
        const result = buildCarryForward(members, bills, payments, [], owedAdjustments);
        const alice = result.households.find(h => h.primaryMemberId === 1);
        expect(alice.credit).toBeCloseTo(100, 5);
        expect(alice.deferredChargeTotal).toBeCloseTo(30, 5);
        expect(alice.openingBalance).toBeCloseTo(-70, 5);
    });

    it('reports the carried credit-adjustment ids so the close path can mark them', () => {
        // Alice already has a recorded refund of 20 (disposed); remaining credit is carried.
        const payments = [{ memberId: 1, amount: 700 }]; // credit would be 100 gross
        const creditAdjustments = [{ id: 'c1', memberId: 1, type: 'refund', amount: 20, status: 'recorded' }];
        const result = buildCarryForward(members, bills, payments, creditAdjustments, []);
        const alice = result.households.find(h => h.primaryMemberId === 1);
        // Net credit after the 20 refund = 80.
        expect(alice.credit).toBeCloseTo(80, 5);
        expect(alice.openingBalance).toBeCloseTo(-80, 5);
    });

    it('aggregates a total opening balance and member count across households', () => {
        // Alice credit 80 (→ −80); Bob has a 50 deferred charge (→ +50).
        const payments = [{ memberId: 1, amount: 680 }, { memberId: 2, amount: 600 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 2, kind: 'usage_charge', amount: 50, status: 'deferred' }
        ];
        const result = buildCarryForward(members, bills, payments, [], owedAdjustments);
        expect(result.memberCount).toBe(2); // both households carry something
        expect(result.totalOpeningBalance).toBeCloseTo(-30, 5); // −80 + 50
    });

    it('excludes a household with nothing undisposed', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const result = buildCarryForward(members, bills, payments, [], []);
        expect(result.households).toHaveLength(0);
        expect(result.memberCount).toBe(0);
        expect(result.totalOpeningBalance).toBe(0);
    });

    it('does not carry a sub-cent rounding credit (epsilon)', () => {
        const payments = [{ memberId: 1, amount: 600.004 }, { memberId: 2, amount: 600 }];
        const result = buildCarryForward(members, bills, payments, [], []);
        expect(result.households).toHaveLength(0);
    });

    it('operates at the household grain (ADR 0001): linked-member items roll under the primary', () => {
        const hh = [
            { id: 1, name: 'Primary', linkedMembers: [3] },
            { id: 3, name: 'Linked', linkedMembers: [] }
        ];
        const hhBills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 3] }]; // 600 each, 1200 household
        // Household overpays by 90 net; linked member also has a 10 deferred charge.
        const payments = [{ memberId: 1, amount: 700 }, { memberId: 3, amount: 590 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 3, kind: 'usage_charge', amount: 10, status: 'deferred' }
        ];
        const result = buildCarryForward(hh, hhBills, payments, [], owedAdjustments);
        expect(result.households).toHaveLength(1);
        const household = result.households[0];
        expect(household.primaryMemberId).toBe(1);
        expect(household.credit).toBeCloseTo(90, 5);          // 1290 net − 1200 owed
        expect(household.deferredChargeTotal).toBeCloseTo(10, 5);
        expect(household.openingBalance).toBeCloseTo(-80, 5); // 10 − 90
    });

    it('honors the #319 reopened-credit seam: only genuine surplus carries, the re-opened refund is held back this year', () => {
        // ADR 0003/0006: an active not_received re-opens a credit — it is owed back
        // THIS year, not undisposed surplus, so it must NOT be carried forward.
        // #319 is not in this base; the seam accepts reopenedAdjustmentIds and treats
        // a re-opened recorded refund as still-effective FOR THE CARRY (it does not
        // inflate the carried amount), so the resurfaced credit stays live this year.
        //
        // Alice owes 600, pays 800 → gross credit 200. A 120 refund (c1) is recorded.
        const payments = [{ memberId: 1, amount: 800 }];
        const creditAdjustments = [
            { id: 'c1', memberId: 1, type: 'refund', amount: 120, status: 'recorded' }
        ];
        // Net credit after the refund = 80 (genuine undisposed surplus).
        const baseline = buildCarryForward(members, bills, payments, creditAdjustments, []);
        expect(baseline.households.find(h => h.primaryMemberId === 1).credit).toBeCloseTo(80, 5);

        // With c1 re-opened (not_received): the 120 is owed back this year and must
        // NOT be added to the carry. The carried surplus is still exactly 80, never 200.
        const reopened = buildCarryForward(members, bills, payments, creditAdjustments, [], {
            reopenedAdjustmentIds: new Set(['c1'])
        });
        const alice = reopened.households.find(h => h.primaryMemberId === 1);
        expect(alice.credit).toBeCloseTo(80, 5);
        expect(alice.openingBalance).toBeCloseTo(-80, 5);
    });

    it('defaults reopenedAdjustmentIds to empty (backward-compatible call)', () => {
        const payments = [{ memberId: 1, amount: 680 }, { memberId: 2, amount: 600 }];
        const result = buildCarryForward(members, bills, payments, [], []);
        expect(result.households).toHaveLength(1);
    });
});

describe('settlement surfaces reflect the carried opening balance (#322)', () => {
    // New year: Alice owes 600 on a $50/mo bill, seeded with a −100 carried credit
    // (carry_opening) so her effective owed is 500. Bob owes 600, seeded with a +60
    // carried charge so his effective owed is 660.
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    const bills = [
        { id: 'b1', amount: 50, billingFrequency: 'monthly', members: [1] },
        { id: 'b2', amount: 50, billingFrequency: 'monthly', members: [2] }
    ];
    const owedAdjustments = [
        { id: 's1', memberId: 1, kind: 'carry_opening', amount: -100, status: 'carried_in', fromYear: '2025' },
        { id: 's2', memberId: 2, kind: 'carry_opening', amount: 60, status: 'carried_in', fromYear: '2025' }
    ];

    it('calculateSettlementMetrics folds the opening balance into the annual total', () => {
        // No payments yet. totalAnnual = (600 − 100) + (600 + 60) = 1160.
        // owedAdjustments is the 6th arg (5th is #319's reopenedAdjustmentIds).
        const m = calculateSettlementMetrics(members, bills, [], [], null, owedAdjustments);
        expect(m.totalAnnual).toBeCloseTo(1160, 5);
    });

    it('calculateSettlementMetrics reflects the opening balance in outstanding', () => {
        // Pay Alice's reduced 500 (settled) and Bob's base 600 (still owes 60).
        const payments = [{ memberId: 1, amount: 500 }, { memberId: 2, amount: 600 }];
        const m = calculateSettlementMetrics(members, bills, payments, [], null, owedAdjustments);
        expect(m.totalOutstanding).toBeCloseTo(60, 5); // Bob's carried charge is now due
        expect(m.paidCount).toBe(1);                   // only Alice settled
    });

    it('defaults owedAdjustments to empty (backward-compatible 4-arg call)', () => {
        const m = calculateSettlementMetrics(members, bills, []);
        expect(m.totalAnnual).toBeCloseTo(1200, 5); // no opening balance applied
    });
});

// ── Service Credits (#321, ADR 0005): the −owed mirror of a Usage Charge ──
//
// A Service Credit is a bill-level reduction stored in owedAdjustments[]
// (kind: 'service_credit', status: 'active'). Unlike a deferred Usage Charge it
// takes effect immediately: it LOWERS the affected members' owed and, when the
// member has already paid, the surplus surfaces as a household Credit on the
// existing refund/carry axis (no new disposition path).

describe('getServiceCreditTotalForMember', () => {
    it('sums only active service credits for the given member', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 10, status: 'active' },
            { id: 'o2', memberId: 1, kind: 'service_credit', amount: 5.5, status: 'active' },
            { id: 'o3', memberId: 2, kind: 'service_credit', amount: 99, status: 'active' }
        ];
        expect(getServiceCreditTotalForMember(owedAdjustments, 1)).toBeCloseTo(15.5, 5);
    });

    it('excludes voided service credits (append-only: void via status, never delete)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 10, status: 'active' },
            { id: 'o2', memberId: 1, kind: 'service_credit', amount: 7, status: 'voided' }
        ];
        expect(getServiceCreditTotalForMember(owedAdjustments, 1)).toBeCloseTo(10, 5);
    });

    it('ignores usage charges (the +owed direction is a different kind)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 10, status: 'active' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 30, status: 'deferred' }
        ];
        expect(getServiceCreditTotalForMember(owedAdjustments, 1)).toBeCloseTo(10, 5);
    });

    it('returns 0 for an undefined or empty array', () => {
        expect(getServiceCreditTotalForMember(undefined, 1)).toBe(0);
        expect(getServiceCreditTotalForMember([], 1)).toBe(0);
    });

    it('ignores malformed amounts (string, NaN, negative, missing) and sums only finite positives', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 10, status: 'active' },
            { id: 'o2', memberId: 1, kind: 'service_credit', amount: 'oops', status: 'active' },
            { id: 'o3', memberId: 1, kind: 'service_credit', amount: NaN, status: 'active' },
            { id: 'o4', memberId: 1, kind: 'service_credit', amount: -5, status: 'active' },
            { id: 'o5', memberId: 1, kind: 'service_credit', status: 'active' }
        ];
        // Only the 10 counts; the string/NaN/negative/missing are dropped, not coerced.
        expect(getServiceCreditTotalForMember(owedAdjustments, 1)).toBeCloseTo(10, 5);
    });

    // Boundary lock for the amount parser (#366). The guard is Number.parseFloat-based,
    // so a *leading-numeric* string is parsed to its leading number — '10abc' → 10,
    // '12.50 USD' → 12.5 — NOT dropped. This pins that exact behavior: a future swap to
    // a stricter parser (Number()/validated parse that rejects trailing garbage) or a
    // looser one would flip these numbers and trip the suite, forcing a conscious choice.
    it('parses leading-numeric strings via parseFloat (10 + 12.5 from "10abc"/"12.50 USD")', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: '10abc', status: 'active' },
            { id: 'o2', memberId: 1, kind: 'service_credit', amount: '12.50 USD', status: 'active' }
        ];
        expect(getServiceCreditTotalForMember(owedAdjustments, 1)).toBeCloseTo(22.5, 5);
    });
});

describe('calculateSettlementMetrics — service credits (#321)', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 2] }]; // 600 each

    it('a service credit for a fully-paid household surfaces as a credit owed back', () => {
        // Alice paid 600 (exactly owed). A 90 service credit lowers her owed to 510,
        // so 90 is now owed back to her — totalCreditsOwed reflects it, outstanding stays 0.
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 90, status: 'active' }
        ];
        const m = calculateSettlementMetrics(members, bills, payments, [], null, owedAdjustments);
        expect(m.totalCreditsOwed).toBeCloseTo(90, 5);
        expect(m.totalOutstanding).toBe(0);
        expect(m.paidCount).toBe(2);
    });

    it('a service credit reduces a partially-paid household outstanding shortfall', () => {
        // Bob owes 600, paid 500 (100 short). A 40 service credit lowers his owed to 560,
        // so his shortfall shrinks to 60. Alice is settled.
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 500 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 2, kind: 'service_credit', amount: 40, status: 'active' }
        ];
        const m = calculateSettlementMetrics(members, bills, payments, [], null, owedAdjustments);
        expect(m.totalOutstanding).toBeCloseTo(60, 5);
        expect(m.totalCreditsOwed).toBe(0);
        expect(m.paidCount).toBe(1);
    });

    it('lowers totalAnnual by the active service-credit amount', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 90, status: 'active' }
        ];
        const m = calculateSettlementMetrics(members, bills, payments, [], null, owedAdjustments);
        expect(m.totalAnnual).toBeCloseTo(1110, 5); // 1200 − 90
    });

    it('defaults owedAdjustments to empty (backward-compatible 4-arg call unaffected)', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const m = calculateSettlementMetrics(members, bills, payments, []);
        expect(m.totalAnnual).toBe(1200);
        expect(m.totalCreditsOwed).toBe(0);
    });
});

// ── Billed Usage Charges (Charge Notice, #320) ──────────────────────────────
//
// Off-cycle billing a member's deferred Usage Charges (via a Charge Notice for a
// period) flips them deferred → billed. A BILLED charge is present-tense money: it
// raises the household's owed (ADR 0005), so unpaid → Outstanding → blocks close
// (ADR 0006). A still-deferred charge does NOT. The household grain (ADR 0001) is
// preserved: the billed total is summed across the primary and linked members.

describe('getBilledUsageChargeTotalForMember', () => {
    it('sums only billed usage charges for the given member', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'billed' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 5.5, status: 'billed' },
            { id: 'o3', memberId: 2, kind: 'usage_charge', amount: 99, status: 'billed' }
        ];
        expect(getBilledUsageChargeTotalForMember(owedAdjustments, 1)).toBeCloseTo(15.5, 5);
    });

    it('excludes deferred charges (not yet billed, so not yet owed)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'billed' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 20, status: 'deferred' }
        ];
        expect(getBilledUsageChargeTotalForMember(owedAdjustments, 1)).toBeCloseTo(10, 5);
    });

    it('excludes voided charges (append-only: void via status, never delete)', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'billed' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 7, status: 'voided' }
        ];
        expect(getBilledUsageChargeTotalForMember(owedAdjustments, 1)).toBeCloseTo(10, 5);
    });

    it('returns 0 for an undefined or empty array', () => {
        expect(getBilledUsageChargeTotalForMember(undefined, 1)).toBe(0);
        expect(getBilledUsageChargeTotalForMember([], 1)).toBe(0);
    });

    it('ignores malformed amounts (string, NaN, negative, missing) and sums only finite positives', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'billed' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 'oops', status: 'billed' },
            { id: 'o3', memberId: 1, kind: 'usage_charge', amount: NaN, status: 'billed' },
            { id: 'o4', memberId: 1, kind: 'usage_charge', amount: -5, status: 'billed' },
            { id: 'o5', memberId: 1, kind: 'usage_charge', status: 'billed' }
        ];
        expect(getBilledUsageChargeTotalForMember(owedAdjustments, 1)).toBeCloseTo(10, 5);
    });

    // Boundary lock for the amount parser (#366) — same parseFloat semantics as the
    // service-credit total. A leading-numeric string is parsed to its leading number
    // ('10abc' → 10, '12.50 USD' → 12.5), not dropped; pinning it makes any future
    // change to the parser's strictness fail the suite rather than silently shift money.
    it('parses leading-numeric strings via parseFloat (10 + 12.5 from "10abc"/"12.50 USD")', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: '10abc', status: 'billed' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: '12.50 USD', status: 'billed' }
        ];
        expect(getBilledUsageChargeTotalForMember(owedAdjustments, 1)).toBeCloseTo(22.5, 5);
    });
});

describe('getHouseholdFinancials — billed usage charges raise owed (#320)', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [3] },
        { id: 3, name: 'Carol', linkedMembers: [] }
    ];
    // $100/month split two ways → $600/yr each, household owes $1200
    const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 3] }];
    const summary = calculateAnnualSummary(members, bills);

    it('a billed usage charge adds to the household owed', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 3, amount: 600 }]; // bills fully paid
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 25, status: 'billed' }];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed).toBeCloseTo(1225, 5);            // 1200 bills + 25 billed charge
        expect(f.netContribution).toBeCloseTo(1200, 5);  // paid the bills, not the new charge
        expect(f.credit).toBe(0);
    });

    it('sums billed charges across the whole household (ADR 0001 grain)', () => {
        const payments = [];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'billed' },
            { id: 'o2', memberId: 3, kind: 'usage_charge', amount: 5, status: 'billed' } // linked member
        ];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed).toBeCloseTo(1215, 5); // 1200 + 10 + 5
    });

    it('a DEFERRED charge does not raise owed (only billed does)', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 3, amount: 600 }];
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 25, status: 'deferred' }];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed).toBeCloseTo(1200, 5); // unchanged by the deferred charge
        expect(f.credit).toBe(0);
    });

    it('defaults owedAdjustments to empty (backward-compatible 4-arg call)', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 3, amount: 600 }];
        const f = getHouseholdFinancials(members[0], summary, payments, []);
        expect(f.owed).toBeCloseTo(1200, 5);
    });

    it('an unpaid billed charge makes an otherwise-settled household carry a balance', () => {
        // Bills fully paid, but a $25 billed charge lands → household now owes $25 net.
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 3, amount: 600 }];
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 25, status: 'billed' }];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, owedAdjustments);
        expect(f.owed - f.netContribution).toBeCloseTo(25, 5); // collectable shortfall
    });
});

describe('calculateSettlementMetrics — billed charges block close (#320, ADR 0006)', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 2] }]; // 600 each

    it('an unpaid billed charge raises owed and makes the household Outstanding', () => {
        // Both fully paid on bills; Alice has a $40 unpaid BILLED charge.
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'billed' }];
        const m = calculateSettlementMetrics(members, bills, payments, [], null, owedAdjustments);
        expect(m.totalAnnual).toBeCloseTo(1240, 5);        // 1200 bills + 40 billed charge
        expect(m.totalOutstanding).toBeCloseTo(40, 5);      // Alice's unpaid billed charge
        expect(m.paidCount).toBe(1);                        // only Bob settled → blocks close
    });

    it('a DEFERRED charge does NOT block close (stays out of settlement)', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'deferred' }];
        const m = calculateSettlementMetrics(members, bills, payments, [], null, owedAdjustments);
        expect(m.totalAnnual).toBeCloseTo(1200, 5);         // unchanged
        expect(m.totalOutstanding).toBe(0);
        expect(m.paidCount).toBe(2);                        // both settled
    });

    it('paying a billed charge settles the household again', () => {
        // Alice pays her bills (600) plus the 40 billed charge = 640.
        const payments = [{ memberId: 1, amount: 640 }, { memberId: 2, amount: 600 }];
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'billed' }];
        const m = calculateSettlementMetrics(members, bills, payments, [], null, owedAdjustments);
        expect(m.totalOutstanding).toBe(0);
        expect(m.paidCount).toBe(2);
        expect(m.percentage).toBe(100);
    });

    it('defaults owedAdjustments to empty (backward-compatible 4-arg call)', () => {
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const m = calculateSettlementMetrics(members, bills, payments, []);
        expect(m.totalAnnual).toBeCloseTo(1200, 5);
        expect(m.paidCount).toBe(2);
    });
});
