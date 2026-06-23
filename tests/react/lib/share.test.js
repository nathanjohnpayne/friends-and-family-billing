import { describe, it, expect } from 'vitest';
import {
    buildShareScopes,
    buildShareTokenDoc,
    buildShareUrl,
    computeExpiryDate,
    isShareTokenStale,
    buildPendingChargesForShare,
    buildServiceCreditsForShare,
    buildPaymentHistoryForShare,
    buildPublicShareData
} from '@/lib/share.js';
// CommonJS mirror used by the resolveShareToken Cloud Function — imported here so the
// cache (React) and CF (fallback) builders can be asserted byte-for-byte identical (#356).
import { buildPaymentHistoryForShare as cfBuildPaymentHistoryForShare } from '../../../functions/billing.js';

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
        const payments = [{ memberId: 1, amount: 400 }];
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
