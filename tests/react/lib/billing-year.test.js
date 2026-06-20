import { describe, it, expect } from 'vitest';
import {
    calculateOutstandingBalance,
    buildCloseYearMessage,
    buildCarryForwardSummary,
    suggestNextYearLabel,
    isYearLabelDuplicate,
    buildNewYearData
} from '@/lib/billing-year.js';
import { getHouseholdOpeningBalance, calculateAnnualSummary, getHouseholdFinancials } from '@/lib/calculations.js';

describe('calculateOutstandingBalance', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 2] }];

    it('returns outstanding balance across all households', () => {
        const payments = [{ memberId: 1, amount: 300 }];
        const balance = calculateOutstandingBalance(members, bills, payments);
        // Alice owes 600, paid 300 → 300 outstanding
        // Bob owes 600, paid 0 → 600 outstanding
        expect(balance).toBe(900);
    });

    it('returns 0 when everyone is paid up', () => {
        const payments = [
            { memberId: 1, amount: 600 },
            { memberId: 2, amount: 600 }
        ];
        expect(calculateOutstandingBalance(members, bills, payments)).toBe(0);
    });

    it('uses Net Contribution — a recorded disposition that nets a household below owed surfaces a shortfall', () => {
        // Bob paid 600 (= owed) but a recorded carry-forward of 100 nets him to 500.
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const creditAdjustments = [{ id: 'c1', memberId: 2, type: 'carry_forward', amount: 100, status: 'recorded' }];
        expect(calculateOutstandingBalance(members, bills, payments, creditAdjustments)).toBeCloseTo(100, 5);
    });

    // ── Close-gate: blocks only on present-tense money (#322, ADR 0006) ──────
    it('does NOT count an undisposed credit as outstanding (a surplus never blocks the close)', () => {
        // Alice overpaid by 100 (undisposed credit), Bob is fully paid. Nothing is owed.
        const payments = [{ memberId: 1, amount: 700 }, { memberId: 2, amount: 600 }];
        expect(calculateOutstandingBalance(members, bills, payments)).toBe(0);
    });

    it('does NOT count a deferred usage charge as outstanding (it is not present-tense money)', () => {
        // Everyone paid their bills; a deferred charge is pending, not billed, so the
        // close gate ignores it (it auto-carries instead of blocking, ADR 0006).
        const payments = [{ memberId: 1, amount: 600 }, { memberId: 2, amount: 600 }];
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 250, status: 'deferred' }];
        // owedAdjustments are not an input to calculateOutstandingBalance — confirm 0.
        expect(calculateOutstandingBalance(members, bills, payments, [], owedAdjustments)).toBe(0);
    });

    it('still blocks on a genuine unpaid balance (Outstanding present-tense money)', () => {
        const payments = [{ memberId: 1, amount: 600 }]; // Bob underpaid by 600
        expect(calculateOutstandingBalance(members, bills, payments)).toBeCloseTo(600, 5);
    });

    it('applies a carried opening balance to the outstanding figure (#322)', () => {
        // Alice (600 owed) carries a −100 credit → owes 500 net; pays 500 → settled.
        // Bob (600 owed) carries a +60 charge → owes 660; pays 600 → owes 60.
        const payments = [{ memberId: 1, amount: 500 }, { memberId: 2, amount: 600 }];
        const owedAdjustments = [
            { id: 's1', memberId: 1, kind: 'carry_opening', amount: -100, status: 'carried_in' },
            { id: 's2', memberId: 2, kind: 'carry_opening', amount: 60, status: 'carried_in' }
        ];
        expect(calculateOutstandingBalance(members, bills, payments, [], owedAdjustments)).toBeCloseTo(60, 5);
    });
});

describe('buildCloseYearMessage', () => {
    it('includes outstanding amount when > 0', () => {
        const msg = buildCloseYearMessage('2026', 150);
        expect(msg).toContain('$150.00');
        expect(msg).toContain('still outstanding');
    });

    it('omits outstanding warning when 0', () => {
        const msg = buildCloseYearMessage('2026', 0);
        expect(msg).not.toContain('outstanding');
        expect(msg).toContain('Close billing year 2026');
    });

    it('states the carry-forward amount and member count when items will carry (#322)', () => {
        // carry summary: 2 households carry a net opening balance of −30 (i.e. $30
        // net credit rolling forward). The close message states amount + member count.
        const carry = { totalOpeningBalance: -30, memberCount: 2 };
        const msg = buildCloseYearMessage('2026', 0, carry);
        expect(msg).toContain('2 member');           // member count
        expect(msg).toMatch(/\$30\.00/);             // magnitude of the carry
        expect(msg).toMatch(/carr/i);                // mentions carry-forward
    });

    it('omits the carry-forward sentence when nothing carries (#322)', () => {
        const msg = buildCloseYearMessage('2026', 0, { totalOpeningBalance: 0, memberCount: 0 });
        expect(msg).not.toMatch(/carr/i);
    });

    it('remains backward-compatible with no carry argument', () => {
        const msg = buildCloseYearMessage('2026', 150);
        expect(msg).toContain('$150.00');
        expect(msg).not.toMatch(/carr/i);
    });
});

describe('buildCarryForwardSummary (#322)', () => {
    it('summarizes carried credits and deferred charges as a netted opening balance', () => {
        // One household: Alice owes 600, overpaid by 80 (credit), plus a 30 deferred charge.
        const members = [{ id: 1, name: 'Alice', linkedMembers: [] }];
        const bills = [{ id: 'b1', amount: 50, billingFrequency: 'monthly', members: [1] }];
        const payments = [{ memberId: 1, amount: 680 }];
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 30, status: 'deferred' }];

        const summary = buildCarryForwardSummary(members, bills, payments, [], owedAdjustments);
        // net opening balance = 30 − 80 = −50, one member carrying.
        expect(summary.memberCount).toBe(1);
        expect(summary.totalOpeningBalance).toBeCloseTo(-50, 5);
        expect(summary.households).toHaveLength(1);
    });

    it('reports nothing carrying when all households are disposed and settled', () => {
        const members = [{ id: 1, name: 'Alice', linkedMembers: [] }];
        const bills = [{ id: 'b1', amount: 50, billingFrequency: 'monthly', members: [1] }];
        const payments = [{ memberId: 1, amount: 600 }];
        const summary = buildCarryForwardSummary(members, bills, payments, [], []);
        expect(summary.memberCount).toBe(0);
        expect(summary.totalOpeningBalance).toBe(0);
    });
});

describe('suggestNextYearLabel', () => {
    it('increments the current year label', () => {
        expect(suggestNextYearLabel({ label: '2025' })).toBe('2026');
    });

    it('uses current calendar year when label is not a number', () => {
        const result = suggestNextYearLabel({ label: 'Q1' });
        expect(Number(result)).toBe(new Date().getFullYear());
    });

    it('uses current calendar year when null', () => {
        expect(Number(suggestNextYearLabel(null))).toBe(new Date().getFullYear());
    });
});

describe('isYearLabelDuplicate', () => {
    const years = [{ id: '2025' }, { id: '2026' }];

    it('returns true for existing label', () => {
        expect(isYearLabelDuplicate(years, '2025')).toBe(true);
    });

    it('returns false for new label', () => {
        expect(isYearLabelDuplicate(years, '2027')).toBe(false);
    });

    it('trims whitespace', () => {
        expect(isYearLabelDuplicate(years, ' 2025 ')).toBe(true);
    });
});

describe('buildNewYearData', () => {
    const members = [
        { id: 1, name: 'Alice', email: 'a@b.com', phone: '+1234', avatar: '', paymentReceived: 500, linkedMembers: [2] },
        { id: 2, name: 'Bob', email: 'b@c.com', phone: '', avatar: '', paymentReceived: 300, linkedMembers: [] }
    ];
    const bills = [
        { id: 'b1', name: 'Internet', amount: 100, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2] }
    ];
    const settings = {
        emailMessage: 'Hello',
        paymentLinks: [{ label: 'Venmo', url: 'http://venmo.com' }],
        paymentMethods: [{ type: 'venmo', enabled: true }]
    };

    it('resets paymentReceived to 0 for all members', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        data.familyMembers.forEach(m => {
            expect(m.paymentReceived).toBe(0);
        });
    });

    it('preserves bill structure', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        expect(data.bills).toHaveLength(1);
        expect(data.bills[0].name).toBe('Internet');
    });

    it('starts with empty payments and events', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        expect(data.payments).toEqual([]);
        expect(data.billingEvents).toEqual([]);
    });

    it('sets status to open', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        expect(data.status).toBe('open');
    });

    it('deep clones linked members (no reference sharing)', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        data.familyMembers[0].linkedMembers.push(99);
        expect(members[0].linkedMembers).not.toContain(99);
    });

    // ── Carry-forward seeding (#322) ──────────────────────────────────────
    it('initializes empty creditAdjustments and owedAdjustments arrays (parity with buildSavePayload)', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        expect(data.creditAdjustments).toEqual([]);
        expect(data.owedAdjustments).toEqual([]);
    });

    it('seeds a per-household carry_opening record from the carry summary', () => {
        // One household carries a net opening balance of −80 (an $80 credit).
        const carry = {
            totalOpeningBalance: -80,
            memberCount: 1,
            households: [
                { primaryMemberId: 1, credit: 80, deferredChargeTotal: 0, openingBalance: -80,
                  creditAdjustmentIds: [], deferredChargeIds: [] }
            ]
        };
        const data = buildNewYearData(members, bills, settings, '2027', carry, '2026');
        const seeds = data.owedAdjustments.filter(a => a.kind === 'carry_opening');
        expect(seeds).toHaveLength(1);
        expect(seeds[0].memberId).toBe(1);
        expect(seeds[0].amount).toBeCloseTo(-80, 5);
        expect(seeds[0].status).toBe('carried_in');
        expect(seeds[0].fromYear).toBe('2026'); // carried FROM the prior year label
    });

    it('seeded opening balance flows into the new year owed (annual total) and first invoice', () => {
        const carry = {
            totalOpeningBalance: -80,
            memberCount: 1,
            households: [
                { primaryMemberId: 1, credit: 80, deferredChargeTotal: 0, openingBalance: -80,
                  creditAdjustmentIds: [], deferredChargeIds: [] }
            ]
        };
        const data = buildNewYearData(members, bills, settings, '2027', carry, '2026');
        // Re-derive owed for the new year using the seeded opening balance.
        const summary = calculateAnnualSummary(data.familyMembers, data.bills);
        const opening = getHouseholdOpeningBalance(data.familyMembers[0], data.owedAdjustments);
        // openingBalance is the 6th arg (5th is #319's reopenedAdjustmentIds).
        const f = getHouseholdFinancials(data.familyMembers[0], summary, data.payments, data.creditAdjustments, null, opening);
        // Alice's household (Alice + linked Bob) owes summary[1] + summary[2] on the
        // shared Internet bill, minus the carried 80 credit.
        const householdBillsOwed = summary[1].total + summary[2].total;
        expect(opening).toBeCloseTo(-80, 5);
        expect(f.owed).toBeCloseTo(householdBillsOwed - 80, 5);
    });

    it('seeds no carry_opening records when nothing carries', () => {
        const carry = { totalOpeningBalance: 0, memberCount: 0, households: [] };
        const data = buildNewYearData(members, bills, settings, '2027', carry);
        expect(data.owedAdjustments.filter(a => a.kind === 'carry_opening')).toHaveLength(0);
    });

    it('remains backward-compatible with no carry argument (no seeds)', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        expect(data.owedAdjustments).toEqual([]);
    });
});
