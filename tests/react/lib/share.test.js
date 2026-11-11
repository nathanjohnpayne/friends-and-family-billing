import { describe, it, expect } from 'vitest';
import { getHouseholdFinancials, getHouseholdOpeningBalance } from '@/lib/calculations.js';
import {
    buildShareScopes,
    buildShareTokenDoc,
    buildShareUrl,
    computeExpiryDate,
    isShareTokenStale,
    buildPendingChargesForShare,
    buildServiceCreditsForShare,
    buildPaymentHistoryForShare,
    buildPublicShareData,
    buildCarriedItemsForShare
} from '@/lib/share.js';
// CommonJS mirror used by the resolveShareToken Cloud Function — imported here so the
// cache (React) and CF (fallback) builders can be asserted byte-for-byte identical (#356).
import { buildPaymentHistoryForShare as cfBuildPaymentHistoryForShare, buildCarriedItemsForShare as cfBuildCarriedItemsForShare } from '../../../functions/billing.js';

describe('buildPublicShareData — pendingCharges (#317 reachability)', () => {
    const familyMembers = [{ id: 1, name: 'Alice', linkedMembers: [] }];
    const bills = [{ id: 'b1', name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }];
    const owedAdjustments = [
        { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 12, status: 'deferred', description: 'Roaming', incurredDate: '2025-02-01' }
    ];
    const activeYear = { id: '2026', label: '2026' };

    it('includes pendingCharges in the doc when usageCharges:read is granted', () => {
        const scopes = buildShareScopes(false, false); // now always includes usageCharges:read
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        // The member-facing view is reachable on a normally-generated link.
        expect(data.pendingCharges).toBeDefined();
        expect(data.pendingCharges.count).toBe(1);
        expect(data.pendingCharges.charges[0].id).toBe('o1');
    });

    it('omits pendingCharges when the scope is absent', () => {
        const data = buildPublicShareData(familyMembers, bills, [], 1, ['summary:read'], 'uid', activeYear, {}, owedAdjustments);
        expect(data.pendingCharges).toBeUndefined();
    });
});

describe('buildPublicShareData — service credits reduce owed (#321)', () => {
    // Alice (1) solo on one $100/mo bill → owes 1200/yr. An active service credit must
    // reduce combinedAnnualTotal and balanceRemaining (floored at 0), mirroring
    // getHouseholdFinancials, so the member-facing share summary agrees with the board.
    const familyMembers = [{ id: 1, name: 'Alice', linkedMembers: [] }];
    const bills = [{ id: 'b1', name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }];
    const activeYear = { id: '2026', label: '2026' };
    const scopes = ['summary:read'];

    it('reduces combinedAnnualTotal and balanceRemaining by the active service-credit total', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 200, status: 'active' }
        ];
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        expect(data.paymentSummary.combinedAnnualTotal).toBeCloseTo(1000, 5); // 1200 − 200
        expect(data.paymentSummary.balanceRemaining).toBeCloseTo(1000, 5);
        expect(data.paymentSummary.combinedMonthlyTotal).toBeCloseTo(1000 / 12, 2);
    });

    it('reduces balanceRemaining net of payments', () => {
        const payments = [{ id: 'fixture-1', memberId: 1, amount: 400 }];
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 200, status: 'active' }
        ];
        const data = buildPublicShareData(familyMembers, bills, payments, 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        expect(data.paymentSummary.combinedAnnualTotal).toBeCloseTo(1000, 5);
        expect(data.paymentSummary.balanceRemaining).toBeCloseTo(600, 5); // 1000 − 400
    });

    it('floors the reduced owed at 0 for an over-large credit', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 5000, status: 'active' }
        ];
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        expect(data.paymentSummary.combinedAnnualTotal).toBe(0);
        expect(data.paymentSummary.balanceRemaining).toBe(0);
    });

    it('ignores voided credits and the +owed usage-charge direction; defaults to no reduction', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, kind: 'service_credit', amount: 40, status: 'voided' },
            { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 70, status: 'billed' }
        ];
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        expect(data.paymentSummary.combinedAnnualTotal).toBeCloseTo(1200, 5);
        // No owedAdjustments at all → unchanged.
        const baseline = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {});
        expect(baseline.paymentSummary.combinedAnnualTotal).toBeCloseTo(1200, 5);
    });
});

describe('buildServiceCreditsForShare (#337)', () => {
    const bills = [
        { id: 'b1', name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1, 2] },
        { id: 'b2', name: 'Streaming', amount: 20, billingFrequency: 'monthly', members: [1] }
    ];

    it('aggregates a bill-level split (one record per member) into a single line', () => {
        // A $90 whole-bill credit on b1 split between Alice (1) and Bob (2) → two records.
        const owedAdjustments = [
            { id: 'c1', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 45, reason: 'Outage', status: 'active' },
            { id: 'c2', memberId: 2, billId: 'b1', kind: 'service_credit', amount: 45, reason: 'Outage', status: 'active' }
        ];
        const res = buildServiceCreditsForShare(bills, owedAdjustments, 1, [2]);
        expect(res.items).toHaveLength(1);
        expect(res.items[0]).toEqual({ reason: 'Outage', billName: 'Internet', amount: 90 });
        expect(res.total).toBe(90);
    });

    it('keeps distinct reasons / bills as separate lines and totals them', () => {
        const owedAdjustments = [
            { id: 'c1', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 30, reason: 'Outage', status: 'active' },
            { id: 'c2', memberId: 1, billId: 'b2', kind: 'service_credit', amount: 5, reason: 'Price drop', status: 'active' }
        ];
        const res = buildServiceCreditsForShare(bills, owedAdjustments, 1, []);
        expect(res.items).toHaveLength(2);
        expect(res.total).toBe(35);
    });

    it('includes a linked member credit (household scope) and excludes other households', () => {
        const owedAdjustments = [
            { id: 'c1', memberId: 2, billId: 'b1', kind: 'service_credit', amount: 10, reason: 'Linked', status: 'active' },
            { id: 'c2', memberId: 9, billId: 'b1', kind: 'service_credit', amount: 99, reason: 'Other household', status: 'active' }
        ];
        const res = buildServiceCreditsForShare(bills, owedAdjustments, 1, [2]);
        expect(res.total).toBe(10);
        expect(res.items.map(i => i.reason)).toEqual(['Linked']);
    });

    it('excludes voided credits, usage charges, carry_opening seeds, and non-positive amounts', () => {
        const owedAdjustments = [
            { id: 'c1', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 50, reason: 'Voided', status: 'voided' },
            { id: 'c2', memberId: 1, billId: 'b1', kind: 'usage_charge', amount: 50, reason: 'Charge', status: 'active' },
            { id: 'c3', memberId: 1, kind: 'carry_opening', amount: -50, status: 'active' },
            { id: 'c4', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 0, reason: 'Zero', status: 'active' }
        ];
        const res = buildServiceCreditsForShare(bills, owedAdjustments, 1, []);
        expect(res.items).toHaveLength(0);
        expect(res.total).toBe(0);
    });

    it('exposes only member-safe fields (reason, billName, amount)', () => {
        const owedAdjustments = [
            { id: 'c1', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 25, reason: 'Outage', status: 'active', incurredDate: '2026-02-01' }
        ];
        const [item] = buildServiceCreditsForShare(bills, owedAdjustments, 1, []).items;
        expect(Object.keys(item).sort()).toEqual(['amount', 'billName', 'reason']);
    });

    it('rounds once after aggregation, avoiding per-add cent drift', () => {
        // Two sub-cent credits on the same bill+reason: rounding on each add would give
        // 0.02; rounding once after aggregation gives 0.01, keeping the line item and
        // total in cent-level parity with the raw service-credit sum.
        const owedAdjustments = [
            { id: 'c1', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 0.005, reason: 'Proration', status: 'active' },
            { id: 'c2', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 0.005, reason: 'Proration', status: 'active' }
        ];
        const res = buildServiceCreditsForShare(bills, owedAdjustments, 1, []);
        expect(res.items).toHaveLength(1);
        expect(res.items[0].amount).toBe(0.01);
        expect(res.total).toBe(0.01);
    });
});

describe('buildPublicShareData — service credit line items (#337)', () => {
    const familyMembers = [{ id: 1, name: 'Alice', linkedMembers: [] }];
    const bills = [{ id: 'b1', name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }];
    const activeYear = { id: '2026', label: '2026' };
    const scopes = ['summary:read'];

    it('exposes serviceCredits whose total equals the combinedAnnualTotal reduction', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 200, reason: 'Outage', status: 'active' }
        ];
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        expect(data.serviceCredits).toBeDefined();
        expect(data.serviceCredits.total).toBe(200);
        expect(data.serviceCredits.items).toEqual([{ reason: 'Outage', billName: 'Internet', amount: 200 }]);
        // 1200 gross − 200 credit = 1000 net: the line item total reconciles the reduction.
        expect(data.paymentSummary.combinedAnnualTotal).toBeCloseTo(1000, 5);
    });

    it('omits serviceCredits when there are no active credits', () => {
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, []);
        expect(data.serviceCredits).toBeUndefined();
    });

    it('omits serviceCredits when summary:read is absent', () => {
        const owedAdjustments = [
            { id: 'o1', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 50, reason: 'Outage', status: 'active' }
        ];
        const data = buildPublicShareData(familyMembers, bills, [], 1, ['paymentMethods:read'], 'uid', activeYear, {}, owedAdjustments);
        expect(data.serviceCredits).toBeUndefined();
    });
});

describe('buildPublicShareData — carried opening balance folds into owed (#322)', () => {
    // Alice (1) solo on one $50/mo bill → owes 600/yr. A carried opening balance
    // (carry_opening seed) must adjust combinedAnnualTotal/balanceRemaining the same
    // way the invoice and settlement board do: a carried CREDIT (negative amount)
    // lowers owed, a carried CHARGE (positive amount) raises it, the combined
    // (after service credits) figure floored at 0.
    const familyMembers = [{ id: 1, name: 'Alice', linkedMembers: [] }];
    const bills = [{ id: 'b1', name: 'Internet', amount: 50, billingFrequency: 'monthly', members: [1] }];
    const activeYear = { id: '2027', label: '2027' };
    const scopes = ['summary:read'];

    it('lowers combinedAnnualTotal by a carried credit (negative carry_opening)', () => {
        const owedAdjustments = [
            { id: 'coadj_2026_1', memberId: 1, kind: 'carry_opening', amount: -80, status: 'carried_in' }
        ];
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        expect(data.paymentSummary.combinedAnnualTotal).toBeCloseTo(520, 5); // 600 − 80
        expect(data.paymentSummary.balanceRemaining).toBeCloseTo(520, 5);
    });

    it('raises combinedAnnualTotal by a carried charge (positive carry_opening)', () => {
        const owedAdjustments = [
            { id: 'coadj_2026_1', memberId: 1, kind: 'carry_opening', amount: 30, status: 'carried_in' }
        ];
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        expect(data.paymentSummary.combinedAnnualTotal).toBeCloseTo(630, 5); // 600 + 30
        expect(data.paymentSummary.balanceRemaining).toBeCloseTo(630, 5);
    });

    it('composes a service credit and a carried credit, floored at 0 (matches getHouseholdFinancials)', () => {
        const owedAdjustments = [
            { id: 's1', memberId: 1, kind: 'service_credit', amount: 100, status: 'active' },
            { id: 'coadj_2026_1', memberId: 1, kind: 'carry_opening', amount: -80, status: 'carried_in' }
        ];
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        // 600 − 100 (service credit) − 80 (carried credit) = 420.
        expect(data.paymentSummary.combinedAnnualTotal).toBeCloseTo(420, 5);
    });

    it('floors at 0 when an over-large carried credit would drive owed negative', () => {
        const owedAdjustments = [
            { id: 'coadj_2026_1', memberId: 1, kind: 'carry_opening', amount: -5000, status: 'carried_in' }
        ];
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        expect(data.paymentSummary.combinedAnnualTotal).toBe(0);
        expect(data.paymentSummary.balanceRemaining).toBe(0);
    });

    it('sums carry_opening across the household (primary + linked) and ignores voided seeds', () => {
        const fm = [
            { id: 1, name: 'Alice', linkedMembers: [2] },
            { id: 2, name: 'Bob', linkedMembers: [] }
        ];
        const householdBills = [
            { id: 'b1', name: 'Internet', amount: 50, billingFrequency: 'monthly', members: [1] },
            { id: 'b2', name: 'Phone', amount: 50, billingFrequency: 'monthly', members: [2] }
        ];
        const owedAdjustments = [
            { id: 'coadj_2026_1', memberId: 1, kind: 'carry_opening', amount: -80, status: 'carried_in' },
            { id: 'coadj_2026_2', memberId: 2, kind: 'carry_opening', amount: 30, status: 'carried_in' },
            { id: 'coadj_void', memberId: 1, kind: 'carry_opening', amount: -999, status: 'voided' }
        ];
        const data = buildPublicShareData(fm, householdBills, [], 1, scopes, 'uid', activeYear, {}, owedAdjustments);
        // Household owes 1200; net carried −80 + 30 = −50 → 1150. Voided seed ignored.
        expect(data.paymentSummary.combinedAnnualTotal).toBeCloseTo(1150, 5);
    });

    it('leaves owed unchanged when there is no carry_opening seed', () => {
        const data = buildPublicShareData(familyMembers, bills, [], 1, scopes, 'uid', activeYear, {}, []);
        expect(data.paymentSummary.combinedAnnualTotal).toBeCloseTo(600, 5);
    });
});

describe('buildShareScopes', () => {
    it('always includes summary:read, paymentMethods:read, usageCharges:read, and payments:read', () => {
        const scopes = buildShareScopes(false, false);
        expect(scopes).toContain('summary:read');
        expect(scopes).toContain('paymentMethods:read');
        expect(scopes).toContain('usageCharges:read');
        expect(scopes).toContain('payments:read');
        expect(scopes).toHaveLength(4);
    });

    it('adds disputes:create when allowed', () => {
        const scopes = buildShareScopes(true, false);
        expect(scopes).toContain('disputes:create');
        expect(scopes).not.toContain('disputes:read');
    });

    it('adds disputes:read when allowed', () => {
        const scopes = buildShareScopes(false, true);
        expect(scopes).toContain('disputes:read');
    });

    it('adds both dispute scopes', () => {
        const scopes = buildShareScopes(true, true);
        expect(scopes).toHaveLength(6);
    });

    it('always grants usageCharges:read so the member can reach their own pending charges (#317)', () => {
        // A member always sees their OWN deferred charges on their share page (ADR 0005);
        // the scope must be on every normal link for the feature to be reachable.
        expect(buildShareScopes(false, false)).toContain('usageCharges:read');
        expect(buildShareScopes(true, true)).toContain('usageCharges:read');
    });

    it('always grants payments:read so the member can reach their own payment history (#356)', () => {
        // A member's payment history is their own data — same posture as usageCharges:read.
        expect(buildShareScopes(false, false)).toContain('payments:read');
        expect(buildShareScopes(true, true)).toContain('payments:read');
    });
});

describe('buildPaymentHistoryForShare (#356)', () => {
    const payments = [
        { id: 'p1', memberId: 1, amount: 100, receivedAt: '2026-01-10T00:00:00.000Z', method: 'zelle', note: 'Jan' },
        { id: 'p2', memberId: 1, amount: 50, receivedAt: '2026-03-05T00:00:00.000Z', method: 'venmo', note: 'secret note' },
        { id: 'p3', memberId: 2, amount: 25, receivedAt: '2026-02-01T00:00:00.000Z', method: 'check' }, // linked member
        { id: 'pX', memberId: 9, amount: 999, receivedAt: '2026-04-01T00:00:00.000Z', method: 'zelle' }, // other household
    ];

    it('projects the household (primary + linked) payments newest-first with only safe fields', () => {
        const res = buildPaymentHistoryForShare(payments, [1, 2]);
        expect(res.count).toBe(3);
        // newest first: p2 (Mar) > p3 (Feb) > p1 (Jan)
        expect(res.payments.map(p => p.id)).toEqual(['p2', 'p3', 'p1']);
        // only member-safe fields exposed — the free-text note is never included
        expect(Object.keys(res.payments[0]).sort()).toEqual(['amount', 'date', 'id', 'method']);
        expect(res.payments.find(p => p.id === 'p2')).toMatchObject({ amount: 50, method: 'venmo', date: '2026-03-05T00:00:00.000Z' });
    });

    it('excludes other households (no member-id expansion)', () => {
        const res = buildPaymentHistoryForShare(payments, [1, 2]);
        expect(res.payments.find(p => p.id === 'pX')).toBeUndefined();
    });

    it('excludes reversal entries and reversed originals so items sum to totalPaid', () => {
        const ledger = [
            { id: 'a', memberId: 1, amount: 100, receivedAt: '2026-01-01T00:00:00.000Z', method: 'zelle' },
            { id: 'b', memberId: 1, amount: 40, receivedAt: '2026-02-01T00:00:00.000Z', method: 'venmo', reversed: true },
            { id: 'b-rev', memberId: 1, amount: -40, receivedAt: '2026-02-02T00:00:00.000Z', method: 'venmo', type: 'reversal', reversesPaymentId: 'b' },
        ];
        const res = buildPaymentHistoryForShare(ledger, [1]);
        expect(res.payments.map(p => p.id)).toEqual(['a']); // only the live, non-reversed payment
        // totalPaid = 100 + 40 + (-40) = 100; the live items sum to the same figure.
        expect(res.payments.reduce((s, p) => s + p.amount, 0)).toBe(100);
    });

    it('returns an empty result for no payments or an unknown household', () => {
        expect(buildPaymentHistoryForShare([], [1])).toEqual({ payments: [], count: 0 });
        expect(buildPaymentHistoryForShare(payments, [99])).toEqual({ payments: [], count: 0 });
        expect(buildPaymentHistoryForShare(null, [1])).toEqual({ payments: [], count: 0 });
    });

    it('defaults a missing method to "other"', () => {
        const ledger = [{ id: 'z', memberId: 1, amount: 12.34, receivedAt: '2026-01-01T00:00:00.000Z' }];
        const res = buildPaymentHistoryForShare(ledger, [1]);
        expect(res.payments[0].method).toBe('other');
        expect(res.payments[0].amount).toBe(12.34);
    });

    it('preserves full amount precision (no lossy per-item rounding) so items sum to totalPaid (#356)', () => {
        // Per-item Math.round(x*100)/100 is float-fragile (1.005 -> 1.00) and would drift the
        // items from the raw payment sum totalPaid uses; the projection exposes raw amounts and
        // rounds only on display, so the line items reconcile exactly with the summary.
        const ledger = [
            { id: 'h1', memberId: 1, amount: 1.005, receivedAt: '2026-01-02T00:00:00.000Z', method: 'zelle' },
            { id: 'h2', memberId: 1, amount: 2.005, receivedAt: '2026-01-01T00:00:00.000Z', method: 'venmo' },
        ];
        const res = buildPaymentHistoryForShare(ledger, [1]);
        expect(res.payments.map(p => p.amount)).toEqual([1.005, 2.005]);
        expect(res.payments.reduce((s, p) => s + p.amount, 0)).toBe(1.005 + 2.005);
    });

    it('cache (React) and CF mirror produce byte-for-byte identical output (#356 parity)', () => {
        // The unauthenticated payload must agree whether it comes from the publicShares
        // cache (buildPublicShareData) or the resolveShareToken self-heal (the CF mirror).
        const ledger = [
            { id: 'p1', memberId: 1, amount: 100, receivedAt: '2026-01-10T00:00:00.000Z', method: 'zelle', note: 'a' },
            { id: 'p2', memberId: 2, amount: 50, receivedAt: '2026-03-05T00:00:00.000Z', method: 'venmo' },
            { id: 'b', memberId: 1, amount: 40, receivedAt: '2026-02-01T00:00:00.000Z', method: 'check', reversed: true },
            { id: 'b-rev', memberId: 1, amount: -40, receivedAt: '2026-02-02T00:00:00.000Z', method: 'check', type: 'reversal' },
            { id: 'pX', memberId: 9, amount: 999, receivedAt: '2026-04-01T00:00:00.000Z', method: 'zelle' },
        ];
        const ids = [1, 2];
        expect(buildPaymentHistoryForShare(ledger, ids)).toEqual(cfBuildPaymentHistoryForShare(ledger, ids));
    });
});

describe('buildPublicShareData — payment history (#356)', () => {
    const familyMembers = [{ id: 1, name: 'A', linkedMembers: [2] }, { id: 2, name: 'B', linkedMembers: [] }];
    const bills = [{ id: 10, name: 'Net', amount: 100, members: [1], billingFrequency: 'monthly' }];
    const activeYear = { id: 'y', label: '2026' };
    const payments = [
        { id: 'p1', memberId: 1, amount: 30, receivedAt: '2026-01-01T00:00:00.000Z', method: 'zelle', note: 'x' },
        { id: 'p2', memberId: 2, amount: 20, receivedAt: '2026-02-01T00:00:00.000Z', method: 'venmo' },
    ];

    it('includes household paymentHistory when payments:read is granted', () => {
        const scopes = buildShareScopes(false, false); // includes payments:read
        const data = buildPublicShareData(familyMembers, bills, payments, 1, scopes, 'uid', activeYear, {}, []);
        expect(data.paymentHistory.count).toBe(2);
        // newest first; includes the linked member's payment (p2)
        expect(data.paymentHistory.payments.map(p => p.id)).toEqual(['p2', 'p1']);
    });

    it('omits paymentHistory when the scope is absent (older links)', () => {
        const data = buildPublicShareData(familyMembers, bills, payments, 1, ['summary:read'], 'uid', activeYear, {}, []);
        expect(data.paymentHistory).toBeUndefined();
    });
});

describe('buildPendingChargesForShare', () => {
    const familyMembers = [
        { id: 1, name: 'Alice', linkedMembers: [3] },
        { id: 2, name: 'Bob', linkedMembers: [] },
        { id: 3, name: 'Carol', linkedMembers: [] }
    ];
    const owedAdjustments = [
        { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred', description: 'Roaming', incurredDate: '2025-02-01' },
        { id: 'o2', memberId: 3, kind: 'usage_charge', amount: 5, status: 'deferred', description: 'Add-on', incurredDate: '2025-01-10' },
        { id: 'o3', memberId: 2, kind: 'usage_charge', amount: 99, status: 'deferred', description: 'Other household', incurredDate: '2025-01-01' },
        { id: 'o4', memberId: 1, kind: 'usage_charge', amount: 77, status: 'voided', description: 'Voided', incurredDate: '2025-01-05' },
        { id: 'o5', memberId: 1, kind: 'usage_charge', amount: 50, status: 'billed', description: 'Already billed', incurredDate: '2025-01-06' },
        { id: 'o6', memberId: 1, kind: 'usage_charge', amount: 20, status: 'deferred', description: 'Earlier roaming', incurredDate: '2025-01-15' }
    ];

    it('returns only this member own deferred charges, sorted by incurred date, with a running total', () => {
        const result = buildPendingChargesForShare(familyMembers, owedAdjustments, 1);
        // Per-member (ADR 0005): Alice's OWN deferred only. Carol's o2 belongs on
        // Carol's own share page, not Alice's; voided (o4), billed (o5), Bob (o3) excluded.
        expect(result.charges.map(c => c.id)).toEqual(['o6', 'o1']); // sorted by incurredDate asc
        expect(result.charges[0].runningTotal).toBeCloseTo(20, 5);
        expect(result.charges[1].runningTotal).toBeCloseTo(30, 5);
        expect(result.total).toBeCloseTo(30, 5);
        expect(result.count).toBe(2);
    });

    it('a linked member sees only their own deferred charges, not the household (ADR 0005)', () => {
        // Carol (3) is linked to Alice but her share shows only her own charge (o2).
        const result = buildPendingChargesForShare(familyMembers, owedAdjustments, 3);
        expect(result.charges.map(c => c.id)).toEqual(['o2']);
        expect(result.total).toBeCloseTo(5, 5);
        expect(result.count).toBe(1);
    });

    it('exposes member-safe fields only (no internal status/kind leakage of other members)', () => {
        const result = buildPendingChargesForShare(familyMembers, owedAdjustments, 1);
        const c = result.charges[0];
        expect(c).toHaveProperty('description');
        expect(c).toHaveProperty('amount');
        expect(c).toHaveProperty('incurredDate');
        expect(c).toHaveProperty('runningTotal');
        expect(c).not.toHaveProperty('status');
        expect(c).not.toHaveProperty('kind');
        expect(c).not.toHaveProperty('memberId');
    });

    it('returns an empty result when the member has no deferred charges', () => {
        const result = buildPendingChargesForShare(familyMembers, [], 2);
        expect(result.charges).toEqual([]);
        expect(result.total).toBe(0);
        expect(result.count).toBe(0);
    });

    it('returns an empty result for an unknown member', () => {
        const result = buildPendingChargesForShare(familyMembers, owedAdjustments, 999);
        expect(result.charges).toEqual([]);
        expect(result.count).toBe(0);
    });

    it('adds refunds:read when allowed (#319)', () => {
        const scopes = buildShareScopes(false, false, true);
        expect(scopes).toContain('refunds:read');
        expect(scopes).not.toContain('disputes:read');
    });

    it('omits refunds:read when the third arg is falsy', () => {
        expect(buildShareScopes(false, false)).not.toContain('refunds:read');
        expect(buildShareScopes(true, true, false)).not.toContain('refunds:read');
    });
});

describe('buildShareTokenDoc', () => {
    const scopes = ['summary:read'];

    it('includes rawToken when truthy', () => {
        const doc = buildShareTokenDoc('uid1', 1, 'Alice', '2026', 'tok123', null, scopes);
        expect(doc.rawToken).toBe('tok123');
        expect(doc.ownerId).toBe('uid1');
        expect(doc.memberId).toBe(1);
        expect(doc.memberName).toBe('Alice');
    });

    it('omits rawToken when null (invoice flow)', () => {
        const doc = buildShareTokenDoc('uid1', 1, 'Alice', '2026', null, null, scopes);
        expect(doc).not.toHaveProperty('rawToken');
    });

    it('sets defaults for revoked, lastAccessedAt, accessCount', () => {
        const doc = buildShareTokenDoc('uid1', 1, 'Alice', '2026', 'tok', null, scopes);
        expect(doc.revoked).toBe(false);
        expect(doc.lastAccessedAt).toBeNull();
        expect(doc.accessCount).toBe(0);
    });
});

describe('buildShareUrl', () => {
    it('constructs the share URL', () => {
        expect(buildShareUrl('https://example.com', 'abc123')).toBe(
            'https://example.com/share?token=abc123'
        );
    });
});

describe('computeExpiryDate', () => {
    it('returns null for 0 or falsy days', () => {
        expect(computeExpiryDate(0)).toBeNull();
        expect(computeExpiryDate(null)).toBeNull();
        expect(computeExpiryDate(-1)).toBeNull();
    });

    it('returns a future date for positive days', () => {
        const result = computeExpiryDate(7);
        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBeGreaterThan(Date.now());
    });
});

describe('isShareTokenStale', () => {
    const now = new Date('2026-03-20T00:00:00Z');

    it('returns true for revoked tokens', () => {
        expect(isShareTokenStale({ revoked: true, expiresAt: null }, now)).toBe(true);
    });

    it('returns false for non-expired, non-revoked tokens', () => {
        expect(isShareTokenStale({
            revoked: false,
            expiresAt: new Date('2026-12-31')
        }, now)).toBe(false);
    });

    it('returns true for expired tokens', () => {
        expect(isShareTokenStale({
            revoked: false,
            expiresAt: new Date('2025-01-01')
        }, now)).toBe(true);
    });

    it('returns false when no expiry set', () => {
        expect(isShareTokenStale({ revoked: false, expiresAt: null }, now)).toBe(false);
    });

    it('handles Firestore Timestamp-like objects with .toDate()', () => {
        const firestoreTimestamp = {
            toDate: () => new Date('2025-01-01')
        };
        expect(isShareTokenStale({
            revoked: false,
            expiresAt: firestoreTimestamp
        }, now)).toBe(true);
    });
});


describe('buildPublicShareData — household rounding (#620)', () => {
    const members = [
        { id: 1, name: 'Ada', linkedMembers: [2] },
        { id: 2, name: 'Kenji', linkedMembers: [] },
        { id: 3, name: 'Other', linkedMembers: [] }, { id: 4, name: 'Fourth', linkedMembers: [] }, { id: 5, name: 'Fifth', linkedMembers: [] }
    ];
    const cents = amount => Math.round(amount * 100) / 100;

    for (const { amount, billingFrequency, expected } of [
        { amount: 100, billingFrequency: 'annual', expected: 66.67 },
        { amount: 7.01, billingFrequency: 'monthly', expected: 33.65 }
    ]) {
        it(`aggregates raw ${billingFrequency} shares while preserving rounded member lines`, () => {
            const bills = [{ id: 'bill', name: 'Subscription', amount, billingFrequency, members: billingFrequency === 'annual' ? [1, 2, 3] : [1, 2, 3, 4, 5] }];
            const data = buildPublicShareData(members, bills, [], 1, ['summary:read'], 'owner', { id: '2027' }, {});
            const financials = getHouseholdFinancials(members[0], { familyMembers: members, bills, payments: [], creditAdjustments: [], owedAdjustments: [] }, { reopenedAdjustmentIds: null });
            expect(data.paymentSummary.combinedAnnualTotal).toBe(expected);
            expect(data.paymentSummary.combinedAnnualTotal).toBe(cents(financials.grossOwed));
            const memberTotal = cents((billingFrequency === 'annual' ? amount : amount * 12) / bills[0].members.length);
            expect(data.summary.annualTotal).toBe(memberTotal);
            expect(data.linkedMembers[0].annualTotal).toBe(memberTotal);
            expect(data.summary.bills[0].annualShare).toBe(memberTotal);
            expect(data.linkedMembers[0].bills[0].annualShare).toBe(memberTotal);
        });
    }

    it('continues to skip bills without assigned members', () => {
        const bills = [
            { id: 'bill', name: 'Subscription', amount: 100, billingFrequency: 'annual', members: [1, 2, 3] },
            { id: 'missing', name: 'Unassigned', amount: 999 },
            { id: 'empty', name: 'Unassigned', amount: 999, members: [] }
        ];
        const data = buildPublicShareData(members, bills, [], 1, ['summary:read'], 'owner', { id: '2027' }, {});
        expect(data.paymentSummary.combinedAnnualTotal).toBe(66.67);
        expect(data.summary.bills).toHaveLength(1);
        expect(data.linkedMembers[0].bills).toHaveLength(1);
    });

    for (const incoming of [-100, -20, 0.001]) {
        it(`keeps raw household precision through credits and opening balance ${incoming}`, () => {
            const bills = [{ id: 'bill', name: 'Subscription', amount: 100, billingFrequency: 'annual', members: [1, 2, 3] }];
            const adjustments = [{ id: 'fixture-2', memberId: 1, kind: 'carry_opening', amount: incoming, status: 'carried_in' }];
            if (incoming > 0) adjustments.push({ id: 'fixture-3', memberId: 2, kind: 'service_credit', amount: 0.004, status: 'active' });
            const payments = incoming < 0 ? [] : [{ id: 'fixture-4', memberId: 2, amount: 0.001 }];
            const data = buildPublicShareData(members, bills, payments, 1, ['summary:read'], 'owner', { id: '2027' }, {}, adjustments);
            const financials = getHouseholdFinancials(members[0], { familyMembers: members, bills, payments, creditAdjustments: [], owedAdjustments: adjustments }, { reopenedAdjustmentIds: null });
            // Legacy public writer parity remains covered separately until M3/M4.
            expect(financials.ok).toBe(true);
            expect(financials.owed).toBe(incoming === -100 ? 0 : incoming === -20 ? 46.67 : 66.67);
            expect(data.paymentSummary.totalPaid).toBe(0);
            expect(data.paymentSummary.combinedMonthlyTotal).toBe(incoming === -100 ? 0 : incoming === -20 ? 3.89 : 5.56);
            expect(data.paymentSummary.combinedAnnualTotal).toBe(incoming === -100 ? 0 : incoming === -20 ? 46.67 : 66.66);
        });
    }
});


describe('carried share projection (#603)', () => {
    const members = [{ id: 1, name: 'Erik', linkedMembers: [2] }, { id: 2, name: 'Maja' }, { id: 3, name: 'Other' }];
    const bills = [{ id: 'b', amount: 100, billingFrequency: 'annual', members: [1, 2, 3] }];
    const seed = (amount, items) => ({ id: 'seed-' + amount, kind: 'carry_opening', status: 'carried_in', memberId: 1, fromYear: '2026', amount, ...(items === undefined ? {} : { items }) });
    const project = (records, sourceBills = bills) => buildCarriedItemsForShare(members, sourceBills, records, 1, [2]);
    const publicData = (records, scopes = ['summary:read'], sourceBills = bills) => buildPublicShareData(members, sourceBills, [], 1, scopes, 'owner', { id: '2027' }, {}, records);
    // The canonical cent authority on main (ADR 0010): G, S, O, owed and U in integer cents.
    const canonical = (records, sourceBills = bills) => {
        const financials = getHouseholdFinancials(members[0], { familyMembers: members, bills: sourceBills, payments: [], creditAdjustments: [], owedAdjustments: records }, { reopenedAdjustmentIds: null });
        expect(financials.ok).toBe(true);
        return financials.cents;
    };
    const cents = dollars => Math.round(dollars * 100);

    it.each([[-100, 0], [-20, 4667], [30, 9667], [0, 6667]])('matches the deployed function and the canonical household cents for net %s', (amount, owedCents) => {
        const records = [seed(amount)];
        const carried = project(records);
        expect(carried).toEqual(cfBuildCarriedItemsForShare(members, bills, records, 1, [2]));
        expect(carried.total).toBe(getHouseholdOpeningBalance(members[0], records));
        const { G, S, O, owed, U } = canonical(records);
        expect(G).toBe(6667);
        expect(owed).toBe(owedCents);
        expect(cents(carried.total)).toBe(O);
        // notApplied stays the whole floor remainder, so a page loaded before #688 still
        // adds up; the "$Y remains" amount is the unused carried-in credit U, which is money.
        expect(cents(carried.notApplied)).toBe(Math.max(0, -(G - S + O)));
        expect(cents(carried.notApplied) - cents(carried.unusedCredit)).toBe(Math.max(0, S - G - Math.max(0, O)));
        expect(cents(carried.remainingCredit)).toBe(U);
        expect(cents(publicData(records).paymentSummary.combinedAnnualTotal)).toBe(owed);
        // Rounded per-member display lines are unchanged.
        expect(publicData(records).summary.annualTotal).toBe(33.33);
        expect(publicData(records).linkedMembers[0].annualTotal).toBe(33.33);
        if (amount === -100) expect(carried).toMatchObject({ notApplied: 33.33, unusedCredit: 33.33, remainingCredit: 33.33 });
    });

    it('distinguishes the forfeited Service Credit excess from unused NET incoming money (10l/10n)', () => {
        const sourceBills = [{ ...bills[0], members: [1] }];
        const credit = { id: 'service-credit', kind: 'service_credit', memberId: 1, status: 'active', amount: 200 };
        const split = [{ sourceId: 'charge', memberId: 1, kind: 'usage_charge', amount: 10 },
            { sourceId: 'credit', memberId: null, kind: 'credit', amount: -10, detail: [{ sourceId: 'credit-detail', memberId: 1, kind: 'service_credit', amount: -10 }] }];
        for (const [opening, items, notApplied, remaining] of [[-20, undefined, 120, 20], [0, split, 100, 0]]) {
            const records = [seed(opening, items), credit];
            const result = project(records, sourceBills);
            expect(result).toMatchObject({ notApplied, remainingCredit: remaining });
            expect(result).toEqual(cfBuildCarriedItemsForShare(members, sourceBills, records, 1, [2]));
            const { G, S, O, U } = canonical(records, sourceBills);
            expect(cents(result.notApplied)).toBe(Math.max(0, -(G - S + O)));
            expect(cents(result.notApplied) - cents(result.unusedCredit)).toBe(Math.max(0, S - G - Math.max(0, O)));
            expect(cents(result.remainingCredit)).toBe(U);
        }
    });

    it('lowers what remains by a billed Usage Charge the household has not paid, identically in both writers (#688, fixture 10h)', () => {
        const sourceBills = [{ ...bills[0], members: [1], amount: 60 }];
        const billed = { id: 'billed', memberId: 2, kind: 'usage_charge', status: 'billed', amount: 50 };
        const records = [seed(-132), billed];
        for (const [payments, remaining] of [[[], 22], [[{ id: 'p', memberId: 1, amount: 30 }], 52], [[{ id: 'p', memberId: 2, amount: 80 }], 72]]) {
            const result = buildCarriedItemsForShare(members, sourceBills, records, 1, [2], payments);
            // The reconciling row stays the whole unused credit; only the promise shrinks.
            expect(result).toMatchObject({ unusedCredit: 72, remainingCredit: remaining, notApplied: 72 });
            expect(result).toEqual(cfBuildCarriedItemsForShare(members, sourceBills, records, 1, [2], payments));
            const financials = getHouseholdFinancials(members[0], { familyMembers: members, bills: sourceBills, payments, creditAdjustments: [], owedAdjustments: records });
            expect(Math.min(financials.cents.U, financials.cents.credit)).toBe(remaining * 100);
            const published = buildPublicShareData(members, sourceBills, payments, 1, ['summary:read'], 'owner', { id: '2027' }, {}, records);
            expect(published.carriedItems.remainingCredit).toBe(remaining);
        }
        // Another household's charge and a deferred charge never touch it.
        const others = [seed(-132), { ...billed, memberId: 3 }, { ...billed, id: 'later', status: 'deferred' }];
        expect(project(others, sourceBills).remainingCredit).toBe(72);
    });

    it('stops promising credit that was already refunded or carried forward, identically in both writers (#688)', () => {
        const sourceBills = [{ ...bills[0], members: [1], amount: 60 }];
        const billed = { id: 'billed', memberId: 2, kind: 'usage_charge', status: 'billed', amount: 50 };
        const refund = (amount, extra = {}) => ({ id: 'r' + amount, type: 'refund', memberId: 1, amount, status: 'recorded', ...extra });
        for (const [records, creditAdjustments, remaining] of [
            [[seed(-132)], [refund(72)], 0],
            [[seed(-132)], [{ ...refund(72), type: 'carry_forward', status: 'carried_forward' }], 0],
            [[seed(-132)], [refund(30, { memberId: 2 })], 42],
            [[seed(-132)], [refund(72, { status: 'cancelled' })], 72],
            [[seed(-132)], [refund(72, { memberId: 3 })], 72],
            [[seed(-132), billed], [refund(22)], 0],
        ]) {
            const result = buildCarriedItemsForShare(members, sourceBills, records, 1, [2], [], creditAdjustments);
            // The reconciling rows are untouched; only the promise changes.
            expect(result).toMatchObject({ unusedCredit: 72, notApplied: 72, remainingCredit: remaining });
            expect(result).toEqual(cfBuildCarriedItemsForShare(members, sourceBills, records, 1, [2], [], creditAdjustments));
            const financials = getHouseholdFinancials(members[0], { familyMembers: members, bills: sourceBills, payments: [], creditAdjustments, owedAdjustments: records });
            expect(Math.min(financials.cents.U, financials.cents.credit)).toBe(remaining * 100);
            const published = buildPublicShareData(members, sourceBills, [], 1, ['summary:read'], 'owner', { id: '2027' }, {}, records, creditAdjustments);
            expect(published.carriedItems.remainingCredit).toBe(remaining);
        }
        // A caller that passes no credit adjustments behaves as before.
        expect(buildPublicShareData(members, sourceBills, [], 1, ['summary:read'], 'owner', { id: '2027' }, {}, [seed(-132)]).carriedItems.remainingCredit).toBe(72);
    });

    it('never states more unused or remaining credit than the cent authority, for cent-valued inputs (#688)', () => {
        // A $100.01 bill split two ways is $50.005 a share: the authority reads 5001 cents.
        const half = [{ id: 'b', name: 'Plan', amount: 100.01, billingFrequency: 'annual', members: [1, 3] }];
        const fixed = buildCarriedItemsForShare(members, half, [seed(-60)], 1, [2]);
        expect(fixed).toMatchObject({ unusedCredit: 9.99, remainingCredit: 9.99, notApplied: 9.99 });
        expect(fixed).toEqual(cfBuildCarriedItemsForShare(members, half, [seed(-60)], 1, [2]));
        let state = 0x688;
        const random = (max) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
        const cents = (value) => Math.round(value * 100);
        for (let run = 0; run < 600; run++) {
            const sourceBills = Array.from({ length: 1 + random(3) }, (_, i) => ({ id: 'b' + i, name: 'Bill ' + i, amount: random(30001) / 100,
                billingFrequency: random(2) ? 'monthly' : 'annual', members: [[1], [1, 3], [1, 2, 3], [2, 3]][random(4)] }));
            const records = [seed(-(1 + random(60000)) / 100),
                ...(random(2) ? [{ id: 'sc', memberId: 1, billId: 'b0', kind: 'service_credit', status: 'active', amount: (1 + random(5000)) / 100 }] : []),
                ...(random(2) ? [{ id: 'uc', memberId: 2, kind: 'usage_charge', status: 'billed', amount: (1 + random(5000)) / 100 }] : [])];
            const payments = random(2) ? [{ id: 'p', memberId: 1, amount: (1 + random(20000)) / 100, receivedAt: '2027-01-05' }] : [];
            const creditAdjustments = random(3) ? [] : [{ id: 'r', type: 'refund', memberId: 1, amount: (1 + random(3000)) / 100, status: 'recorded' }];
            const result = buildCarriedItemsForShare(members, sourceBills, records, 1, [2], payments, creditAdjustments);
            expect(result).toEqual(cfBuildCarriedItemsForShare(members, sourceBills, records, 1, [2], payments, creditAdjustments));
            const financials = getHouseholdFinancials(members[0], { familyMembers: members, bills: sourceBills, payments, creditAdjustments, owedAdjustments: records });
            expect(cents(result.unusedCredit), 'run ' + run).toBe(financials.cents.U);
            expect(cents(result.remainingCredit), 'run ' + run).toBe(Math.min(financials.cents.U, financials.cents.credit));
        }
    });

    it('rounds half-cent refunds, payments and billed charges as the cent authority does (#688)', () => {
        const sourceBills = [{ ...bills[0], members: [1], amount: 60 }];
        const refund = (id, amount) => ({ id, type: 'refund', memberId: 1, amount, status: 'recorded' });
        const billed = (amount) => ({ id: 'billed', memberId: 2, kind: 'usage_charge', status: 'billed', amount });
        const payment = (amount) => ({ id: 'p1', memberId: 1, amount, receivedAt: '2027-01-05' });
        for (const [records, payments, creditAdjustments, remainingCents] of [
            // 4.015 is half a cent: a float sum reads 401, the authority reads 402.
            [[seed(-132)], [], [refund('a', 4.015)], 6798],
            [[seed(-132)], [], [refund('a', 2.005), refund('b', 2.005)], 6799],
            [[seed(-132)], [], [refund('a', 0.1), refund('b', 0.2)], 7170],
            [[seed(-132), billed(4.015)], [], [], 6798],
            [[seed(-132), billed(10)], [payment(5.985)], [], 6799],
        ]) {
            const result = buildCarriedItemsForShare(members, sourceBills, records, 1, [2], payments, creditAdjustments);
            expect(Math.round(result.remainingCredit * 100)).toBe(remainingCents);
            expect(result).toEqual(cfBuildCarriedItemsForShare(members, sourceBills, records, 1, [2], payments, creditAdjustments));
            const financials = getHouseholdFinancials(members[0], { familyMembers: members, bills: sourceBills, payments, creditAdjustments, owedAdjustments: records });
            expect(Math.min(financials.cents.U, financials.cents.credit)).toBe(remainingCents);
        }
    });

    it('keeps the payload additive for a share page loaded before #688: bills, credits, carried and notApplied reach the household total', () => {
        // A page loaded before #688 has no "Unused credit" row. It adds exactly these four terms.
        const credit = { id: 'service-credit', kind: 'service_credit', memberId: 1, status: 'active', amount: 200 };
        for (const [amount, opening, extra] of [[60, -132, []], [60, -40, []], [60, 25, []], [100, -20, [credit]], [60, 0, []]]) {
            const sourceBills = [{ ...bills[0], members: [1], amount }];
            const records = [seed(opening), ...extra];
            for (const carried of [project(records, sourceBills), cfBuildCarriedItemsForShare(members, sourceBills, records, 1, [2])]) {
                const { G, S, owed } = canonical(records, sourceBills);
                expect(G - S + cents(carried.total) + cents(carried.notApplied)).toBe(owed);
                // The current page splits the same remainder into two rows and reaches the same total.
                const forfeited = cents(carried.notApplied) - cents(carried.unusedCredit);
                expect(forfeited).toBeGreaterThanOrEqual(0);
                expect(G - S + cents(carried.total) + forfeited + cents(carried.unusedCredit)).toBe(owed);
            }
        }
    });

    it('states nothing remaining for a seed a pre-#688 rollover stamped carriedForwardTo, in both writers', () => {
        const sourceBills = [{ ...bills[0], members: [1], amount: 60 }];
        const records = [{ ...seed(-132), carriedForwardTo: '2028' }];
        const result = project(records, sourceBills);
        // Its $72 remainder already left with the stamp: not applied here, never a credit.
        expect(result).toMatchObject({ notApplied: 72, remainingCredit: 0, unusedCredit: 0, total: -132 });
        expect(result).toEqual(cfBuildCarriedItemsForShare(members, sourceBills, records, 1, [2]));
        expect(canonical(records, sourceBills)).toMatchObject({ U: 0, credit: 0, balance: 0 });
        expect(project([seed(-132)], sourceBills)).toMatchObject({ remainingCredit: 72 });
    });

    // Known remaining case owned by the public-writer alignment (#636, #672–#676), not #603:
    // annual $1.15 split two ways gives this household raw bills of $0.575. The canonical
    // authority quantizes G once ($0.58), so +$0.01 owes $0.59 and −$0.01 owes $0.57. The
    // legacy public writer still rounds the raw sum after the carry and publishes $0.56
    // for −$0.01. When #636 lands, flip the legacy expectation to the canonical cents.
    it.each([[0.01, 59, 0.59], [-0.01, 57, 0.56]])('documents the half-cent public-writer case for net %s (#636)', (amount, owedCents, legacyTotal) => {
        const sourceBills = [{ id: 'half', amount: 1.15, billingFrequency: 'annual', members: [1, 3] }];
        const records = [seed(amount)];
        const { G, owed } = canonical(records, sourceBills);
        expect(G).toBe(58);
        expect(owed).toBe(owedCents);
        expect(publicData(records, ['summary:read'], sourceBills).paymentSummary.combinedAnnualTotal).toBe(legacyTotal);
        expect(project(records, sourceBills)).toMatchObject({ total: amount, notApplied: 0, remainingCredit: 0 });
    });

    it('projects only safe household attribution and nested detail, preserving snapshot text', () => {
        const records = [seed(12, [{ memberId: 2, kind: 'usage_charge', amount: 12, description: 'Activation fee', billName: 'Original name', id: 'private', note: 'private', detail: [{ memberId: 2, amount: -1, description: 'Safe', email: 'private' }, { memberId: 3, amount: -99, description: 'Other secret' }] }, { memberId: 3, amount: 99, description: 'Other secret' }]), { ...seed(999), memberId: 3 }, { ...seed(999), status: 'voided' }];
        const result = project(records);
        expect(result).toEqual(cfBuildCarriedItemsForShare(members, bills, records, 1, [2]));
        expect(result.total).toBe(12);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({ memberName: 'Maja', description: 'Activation fee', billName: 'Original name' });
        expect(result.items[0].detail).toHaveLength(1);
        expect(JSON.stringify(result)).not.toMatch(/private|Other secret/);
    });

    it('gates carry with summary scope, omits absent carry, preserves zero-net itemization and legacy seeds', () => {
        expect(publicData([seed(30)], [])).not.toHaveProperty('carriedItems');
        expect(publicData([])).not.toHaveProperty('carriedItems');
        expect(publicData([seed(0, [])])).not.toHaveProperty('carriedItems');
        expect(publicData([seed(30)]).carriedItems.items).toEqual([{ kind: 'legacy', description: 'Carried from 2026', amount: 30 }]);
        const records = [seed(0, [{ memberId: 1, amount: 10 }, { memberId: null, kind: 'credit', amount: -10 }])];
        expect(publicData(records).carriedItems.items).toHaveLength(2);
        expect(publicData(records).carriedItems).toEqual(cfBuildCarriedItemsForShare(members, bills, records, 1, [2]));
    });
});
