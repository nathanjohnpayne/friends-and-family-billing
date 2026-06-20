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
    getHouseholdOpeningBalance,
    buildCarryForward,
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
        // openingBalance is the 6th arg (5th is #319's reopenedAdjustmentIds).
        const f = getHouseholdFinancials(members[0], summary, [], [], null, -100);
        expect(f.owed).toBeCloseTo(500, 5);
    });

    it('a carried charge (positive opening balance) raises owed', () => {
        const f = getHouseholdFinancials(members[0], summary, [], [], null, 75);
        expect(f.owed).toBeCloseTo(675, 5);
    });

    it('defaults the opening balance to 0 (backward-compatible 5-arg call)', () => {
        const f = getHouseholdFinancials(members[0], summary, [], [], null);
        expect(f.owed).toBeCloseTo(600, 5);
    });

    it('a carried credit makes a household that pays the reduced total read settled', () => {
        // Owed 600, opening −100 → net owed 500. Pay 500 → settled, no credit.
        const payments = [{ memberId: 1, amount: 500 }];
        const f = getHouseholdFinancials(members[0], summary, payments, [], null, -100);
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
