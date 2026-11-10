import { toExactCents as toCents } from '@/lib/household-money.js';
import { describe, it, expect, vi } from 'vitest';
import {
    calculateOutstandingBalance,
    buildCloseYearMessage,
    buildCarryForwardSummary,
    buildCarryOpeningItems,
    applyCarryForwardToPriorYear,
    suggestNextYearLabel,
    isYearLabelDuplicate,
    buildNewYearData,
    isReviewedRollover,
    buildReviewedRollover
} from '@/lib/billing-year.js';
import { computePayloadFingerprint } from '@/lib/year-end-review.js';
import { getHouseholdOpeningBalance, calculateAnnualSummary, getHouseholdFinancials, buildCarryForward } from '@/lib/calculations.js';

describe('calculateOutstandingBalance', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 2] }];

    it('returns outstanding balance across all households', () => {
        const payments = [{ id: 'fixture-1', memberId: 1, amount: 300 }];
        const balance = calculateOutstandingBalance(members, bills, payments);
        // Alice owes 600, paid 300 → 300 outstanding
        // Bob owes 600, paid 0 → 600 outstanding
        expect(balance).toBe(900);
    });

    it('returns 0 when everyone is paid up', () => {
        const payments = [
            { id: 'fixture-2', memberId: 1, amount: 600 },
            { id: 'fixture-3', memberId: 2, amount: 600 }
        ];
        expect(calculateOutstandingBalance(members, bills, payments)).toBe(0);
    });

    it('uses Net Contribution — a recorded disposition that nets a household below owed surfaces a shortfall', () => {
        // Bob paid 600 (= owed) but a recorded carry-forward of 100 nets him to 500.
        const payments = [{ id: 'fixture-4', memberId: 1, amount: 600 }, { id: 'fixture-5', memberId: 2, amount: 600 }];
        const creditAdjustments = [{ id: 'c1', memberId: 2, type: 'carry_forward', amount: 100, status: 'recorded' }];
        expect(calculateOutstandingBalance(members, bills, payments, creditAdjustments)).toBeCloseTo(100, 5);
    });

    // ── Close-gate: blocks only on present-tense money (#320/#321/#322, ADR 0006) ──
    it('does NOT count an undisposed credit as outstanding (a surplus never blocks the close)', () => {
        // Alice overpaid by 100 (undisposed credit), Bob is fully paid. Nothing is owed.
        const payments = [{ id: 'fixture-6', memberId: 1, amount: 700 }, { id: 'fixture-7', memberId: 2, amount: 600 }];
        expect(calculateOutstandingBalance(members, bills, payments)).toBe(0);
    });

    it('does NOT count a deferred usage charge as outstanding (it is not present-tense money)', () => {
        // Everyone paid their bills; a deferred charge is pending, not billed, so the
        // close gate ignores it (it auto-carries instead of blocking, ADR 0006).
        const payments = [{ id: 'fixture-8', memberId: 1, amount: 600 }, { id: 'fixture-9', memberId: 2, amount: 600 }];
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 250, status: 'deferred' }];
        // owedAdjustments IS an input post-#320/#321/#322, but a DEFERRED charge never
        // raises owed (only billed does), so outstanding stays 0.
        expect(calculateOutstandingBalance(members, bills, payments, [], owedAdjustments)).toBe(0);
    });

    it('still blocks on a genuine unpaid balance (Outstanding present-tense money)', () => {
        const payments = [{ id: 'fixture-10', memberId: 1, amount: 600 }]; // Bob underpaid by 600
        expect(calculateOutstandingBalance(members, bills, payments)).toBeCloseTo(600, 5);
    });

    it('applies a carried opening balance to the outstanding figure (#322)', () => {
        // Alice (600 owed) carries a −100 credit → owes 500 net; pays 500 → settled.
        // Bob (600 owed) carries a +60 charge → owes 660; pays 600 → owes 60.
        const payments = [{ id: 'fixture-11', memberId: 1, amount: 500 }, { id: 'fixture-12', memberId: 2, amount: 600 }];
        const owedAdjustments = [
            { id: 's1', memberId: 1, kind: 'carry_opening', amount: -100, status: 'carried_in' },
            { id: 's2', memberId: 2, kind: 'carry_opening', amount: 60, status: 'carried_in' }
        ];
        expect(calculateOutstandingBalance(members, bills, payments, [], owedAdjustments)).toBeCloseTo(60, 5);
    });

    it('a service credit shrinks an outstanding shortfall (#321, ADR 0006 — never blocks the close more)', () => {
        // Bob owes 600, paid 500 (100 short). A 40 service credit lowers his owed to 560,
        // so outstanding drops to 60 — a −owed adjustment can only reduce present-tense debt.
        const payments = [{ id: 'fixture-13', memberId: 1, amount: 600 }, { id: 'fixture-14', memberId: 2, amount: 500 }];
        const owedAdjustments = [{ id: 'o1', memberId: 2, kind: 'service_credit', amount: 40, status: 'active' }];
        expect(calculateOutstandingBalance(members, bills, payments, [], owedAdjustments)).toBeCloseTo(60, 5);
    });

    it('a service credit that clears a household shortfall removes it from outstanding entirely', () => {
        const payments = [{ id: 'fixture-15', memberId: 1, amount: 600 }, { id: 'fixture-16', memberId: 2, amount: 500 }];
        const owedAdjustments = [{ id: 'o1', memberId: 2, kind: 'service_credit', amount: 100, status: 'active' }];
        expect(calculateOutstandingBalance(members, bills, payments, [], owedAdjustments)).toBe(0);
    });

    it('counts an unpaid BILLED usage charge as outstanding, but not a deferred one (#320, ADR 0006)', () => {
        // Everyone paid their bills; Alice has a $40 charge.
        const payments = [{ id: 'fixture-17', memberId: 1, amount: 600 }, { id: 'fixture-18', memberId: 2, amount: 600 }];
        const billed = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'billed' }];
        const deferred = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'deferred' }];
        expect(calculateOutstandingBalance(members, bills, payments, [], billed)).toBeCloseTo(40, 5);
        expect(calculateOutstandingBalance(members, bills, payments, [], deferred)).toBe(0);
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
        const payments = [{ id: 'fixture-19', memberId: 1, amount: 680 }];
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
        const payments = [{ id: 'fixture-20', memberId: 1, amount: 600 }];
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
        const carry = buildCarryForwardSummary(members, [], [{ id: 'payment', memberId: 1, amount: 80 }], [], [], { fromYearLabel: '2026', nextYearLabel: '2027' });
        const data = buildNewYearData(members, bills, settings, '2027', carry, '2026');
        const seeds = data.owedAdjustments.filter(a => a.kind === 'carry_opening');
        expect(seeds).toHaveLength(1);
        expect(seeds[0].memberId).toBe(1);
        expect(seeds[0].amount).toBeCloseTo(-80, 5);
        expect(seeds[0].status).toBe('carried_in');
        expect(seeds[0].fromYear).toBe('2026'); // carried FROM the prior year label
    });

    it('seeded opening balance flows into the new year owed (annual total) and first invoice', () => {
        const carry = buildCarryForwardSummary(members, [], [{ id: 'payment', memberId: 1, amount: 80 }], [], [], { fromYearLabel: '2026', nextYearLabel: '2027' });
        const data = buildNewYearData(members, bills, settings, '2027', carry, '2026');
        // Re-derive owed for the new year using the seeded opening balance.
        const summary = calculateAnnualSummary(data.familyMembers, data.bills);
        const opening = getHouseholdOpeningBalance(data.familyMembers[0], data.owedAdjustments);
        // openingBalance is the 7th arg (5th is #319's reopenedAdjustmentIds, 6th is
        // #320/#321's owedAdjustments — the seed carry_opening rides that array too).
        const f = getHouseholdFinancials(data.familyMembers[0], { familyMembers: data.familyMembers, bills: data.bills, payments: data.payments, creditAdjustments: data.creditAdjustments, owedAdjustments: data.owedAdjustments }, { reopenedAdjustmentIds: null });
        // Alice's household (Alice + linked Bob) owes summary[1] + summary[2] on the
        // shared Internet bill, minus the carried 80 credit.
        const householdBillsOwed = summary[1].total + summary[2].total;
        expect(opening).toBeCloseTo(-80, 5);
        expect(f.owed).toBeCloseTo(householdBillsOwed - 80, 5);
    });

    it('seeds no carry_opening records when nothing carries', () => {
        const carry = buildCarryForwardSummary(members, [], [], [], [], { fromYearLabel: '2026', nextYearLabel: '2027' });
        const data = buildNewYearData(members, bills, settings, '2027', carry, '2026');
        expect(data.owedAdjustments.filter(a => a.kind === 'carry_opening')).toHaveLength(0);
    });

    it('remains backward-compatible with no carry argument (no seeds)', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        expect(data.owedAdjustments).toEqual([]);
    });
});

// Pure review seams from specs/year-end-review.md § Itemized carry. These model
// the same append → summarize → mark → seed sequence createYear will consume.
function reviewCarry(source, fromYearLabel = '2026', nextYearLabel = '2027') {
    const carry = buildCarryForwardSummary(source.familyMembers, source.bills, source.payments,
        source.creditAdjustments, source.owedAdjustments,
        { carryUnusedOpeningCredit: true, reopenedAdjustmentIds: source.reopenedAdjustmentIds, fromYearLabel, nextYearLabel, itemized: true, reviewServiceCredits: source.reviewServiceCredits || [] });
    carry.households = carry.households.map(h => ({
        ...h,
        items: buildCarryOpeningItems(h, { ...source, fromYearLabel, nextYearLabel })
    }));
    const prior = applyCarryForwardToPriorYear(source.creditAdjustments, source.owedAdjustments, carry,
        { nextYearLabel, now: '2026-12-31T12:00:00.000Z' });
    const next = buildNewYearData(source.familyMembers, [], {}, nextYearLabel, carry, fromYearLabel);
    return { carry, prior, next };
}

function financials(source, member, reopenedAdjustmentIds = null) {
    return getHouseholdFinancials(member, { familyMembers: source.familyMembers, bills: source.bills, payments: source.payments, creditAdjustments: source.creditAdjustments, owedAdjustments: source.owedAdjustments }, { reopenedAdjustmentIds });
}

function carryFixture({ bills = 100, serviceCredit = 0, paid = 0, refund = 0, incoming = 0, billed = 0, deferred = 0 } = {}) {
    const reviewServiceCredits = serviceCredit ? [{
        id: 'review-credit', memberId: 1, billId: 'b1', kind: 'service_credit', basis: 'ended',
        amount: serviceCredit, reason: 'Service ended in August.', status: 'active'
    }] : [];
    return {
        familyMembers: [{ id: 1, name: 'Ada', linkedMembers: [] }],
        bills: bills ? [{ id: 'b1', name: 'Northline', amount: bills, billingFrequency: 'annual', members: [1] }] : [],
        payments: paid ? [{ id: 'pay', memberId: 1, amount: paid }] : [],
        creditAdjustments: refund ? [{ id: 'refund', memberId: 1, type: 'refund', amount: refund, status: 'recorded' }] : [],
        owedAdjustments: [
            ...reviewServiceCredits,
            ...(incoming ? [{ id: 'incoming', memberId: 1, kind: 'carry_opening', amount: incoming, status: 'carried_in' }] : []),
            ...(billed ? [{ id: 'billed', memberId: 1, kind: 'usage_charge', amount: billed, status: 'billed' }] : []),
            ...(deferred ? [{ id: 'deferred', memberId: 1, kind: 'usage_charge', amount: deferred, description: 'Activation', status: 'deferred' }] : [])
        ],
        reviewServiceCredits
    };
}

function freezeRecords(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freezeRecords);
        Object.freeze(value);
    }
    return value;
}

function expectCarryInvariants(source, result) {
    const { carry, prior, next } = result;
    for (const seed of next.owedAdjustments) {
        const h = carry.households.find(h => h.primaryMemberId === seed.memberId);
        const member = source.familyMembers.find(m => m.id === seed.memberId);
        const memberIds = [member.id, ...(member.linkedMembers || [])];
        const before = financials(source, member);
        const opening = getHouseholdOpeningBalance(member, source.owedAdjustments);
        const incoming = toCents(Math.abs(opening));
        const availableCharges = Math.max(0, toCents(before.grossOwed) - toCents(before.serviceCreditTotal) + (opening > 0 ? incoming : 0));
        const unused = opening < 0 ? Math.max(0, incoming - availableCharges) / 100 : 0;
        const deferred = source.owedAdjustments.filter(a => a.kind === 'usage_charge' && a.status === 'deferred' && memberIds.includes(a.memberId))
            .reduce((sum, a) => sum + a.amount, 0);
        // (a) Only the top-level items contribute; nested detail reconciles credit.
        expect(seed.items.reduce((sum, item) => sum + toCents(item.amount), 0)).toBe(toCents(seed.amount));
        for (const item of seed.items.filter(item => item.kind === 'credit')) {
            expect(item.detail.reduce((sum, d) => sum + toCents(d.amount), 0)).toBe(toCents(item.amount));
        }
        // (b) Nothing other than deferred charges and payment/incoming credit moves.
        expect(h.unusedOpeningCredit || 0).toBe(unused);
        expect(h.credit).toBe(before.credit);
        expect(h.deferredChargeTotal).toBeCloseTo(deferred, 8);
        expect(toCents(seed.amount)).toBe(toCents(deferred) - before.cents.credit - toCents(unused));
    }
    for (const member of source.familyMembers.filter(m => !source.familyMembers.some(p => p.linkedMembers?.includes(m.id)))) {
        const before = financials(source, member);
        const after = financials({ ...source, ...prior }, member);
        const h = carry.households.find(h => h.primaryMemberId === member.id);
        // (c) Carry uses null, including for a refund re-opened on the board.
        expect(after.credit).toBe(0);
        expect(after.owed - after.netContribution).toBeCloseTo(
            h?.credit > 0 ? 0 : before.owed - before.netContribution, 8);
    }
}

describe('itemized review carry (#601, ADR 0009)', () => {
    it.each([
        ['10a unpaid', { serviceCredit: 48 }, 0, 52, 0],
        ['10b partially paid', { serviceCredit: 48, paid: 30 }, 0, 22, 0],
        ['10c overpaid', { serviceCredit: 48, paid: 100 }, -48, 0, 48],
        ['10d already refunded', { serviceCredit: 48, paid: 100, refund: 48 }, 0, 0, 0],
        ['10e over-large Service Credit creates no money', { serviceCredit: 200 }, 0, 0, 0],
        ['10f no bills, unused incoming credit', { bills: 0, incoming: -132 }, -132, 0, 0],
        ['10g partly used incoming credit', { bills: 60, incoming: -132 }, -72, 0, 0],
        ['10g partly used incoming credit plus payment', { bills: 60, incoming: -132, paid: 20 }, -92, 0, 20],
        ['10h unpaid billed charge is not offset', { bills: 60, incoming: -132, billed: 50 }, -72, 50, 0],
        ['10i incoming credit and review Service Credit', { serviceCredit: 20, incoming: -132 }, -52, 0, 0],
        ['10l excess Service Credit is not remaining money', { serviceCredit: 200, incoming: -20 }, -20, 0, 0]
    ])('fixture %s', (_name, input, opening, shortfall, disposition) => {
        const source = freezeRecords(carryFixture(input));
        const result = reviewCarry(source);
        expect(result.carry.totalOpeningBalance).toBe(opening);
        expect(result.next.owedAdjustments.map(a => a.amount)).toEqual(opening ? [opening] : []);
        expect(result.prior.carriedCreditRecords.map(a => a.amount)).toEqual(disposition ? [disposition] : []);
        const after = financials({ ...source, ...result.prior }, source.familyMembers[0]);
        expect(after.owed - after.netContribution).toBe(shortfall);
        if (input.incoming && opening) {
            expect(result.prior.owedAdjustments.find(a => a.id === 'incoming')).toMatchObject({
                status: 'carried_in', carriedForwardTo: '2027', amount: input.incoming
            });
        }
        expectCarryInvariants(source, result);
    });

    it('fixture 10i reconciles review credit, unused money and the applied amount', () => {
        const { next } = reviewCarry(carryFixture({ serviceCredit: 20, incoming: -132 }));
        const item = next.owedAdjustments[0].items[0];
        expect(item).toMatchObject({ sourceId: 'incoming', amount: -52 });
        expect(item.detail).toEqual([
            { sourceId: 'review-credit', basis: 'ended', memberId: 1, billName: 'Northline', description: 'Service ended in August.', amount: -20 },
            { kind: 'unused', description: 'Unused 2026 credit', amount: -52 },
            { kind: 'applied', description: 'Part applied to your 2026 balance', amount: 20 }
        ]);
    });

    it('fixture 9 preserves the excess credit through empty years and partial use', () => {
        const source = carryFixture({ bills: 144, paid: 144, serviceCredit: 132 });
        const first = reviewCarry(source);
        expect(first.next.owedAdjustments[0].amount).toBe(-132);
        expect(first.prior.carriedCreditRecords).toHaveLength(1);
        for (const annualBill of [0, 60]) {
            let state = {
                ...source, ...first.next,
                bills: annualBill ? [{ id: 'next-bill', amount: 60, billingFrequency: 'annual', members: [1] }] : [],
                reviewServiceCredits: []
            };
            const expected = annualBill ? -72 : -132;
            for (let year = 2027; year < 2033; year++) {
                const result = reviewCarry(freezeRecords(state), String(year), String(year + 1));
                expect(result.next.owedAdjustments[0].amount).toBe(expected);
                expect(result.next.owedAdjustments[0].items[0].detail).toEqual([
                    { kind: 'unused', description: `Unused ${year} credit`, amount: expected }
                ]);
                expect(result.prior.carriedCreditRecords).toEqual([]);
                expectCarryInvariants(state, result);
                state = { ...state, ...result.next, bills: [], reviewServiceCredits: [] };
            }
        }
    });

    it('fixture 10j (10k in the worked examples) retains zero-net lines on a zero seed', () => {
        const source = carryFixture({ bills: 100, paid: 110, deferred: 10 });
        const result = reviewCarry(source);
        expect(result.next.owedAdjustments).toHaveLength(1);
        expect(result.next.owedAdjustments[0]).toMatchObject({ amount: 0, items: [
            { sourceId: 'deferred', amount: 10 }, { sourceId: 'cadj_carry_2027_1', amount: -10 }
        ] });
        expect(result.prior.owedAdjustments[0]).toMatchObject({ status: 'carried_forward', carriedForwardTo: '2027' });
        expect(result.prior.carriedCreditRecords[0].amount).toBe(10);
        const nextFinancials = financials({ ...source, ...result.next, bills: source.bills }, source.familyMembers[0]);
        expect(nextFinancials.owed).toBe(100);
        const legacy = buildCarryForwardSummary(source.familyMembers, source.bills, source.payments, [], source.owedAdjustments, { fromYearLabel: '2026', nextYearLabel: '2027' });
        expect(buildNewYearData(source.familyMembers, [], {}, '2027', legacy, '2026').owedAdjustments).toEqual([]);
        expectCarryInvariants(source, result);
    });

    it('fixture 10m leaves the re-opened refund owed back in the source year', () => {
        const source = carryFixture({ paid: 140, refund: 30 });
        source.reopenedAdjustmentIds = new Set(['refund']); // Active not_received remains on the source Request.
        expect(financials(source, source.familyMembers[0], source.reopenedAdjustmentIds).credit).toBe(40);
        const result = reviewCarry(freezeRecords(source));
        expect(result.next.owedAdjustments[0].amount).toBe(-10);
        expect(result.next.owedAdjustments[0].items.map(i => i.sourceId)).toEqual(['cadj_carry_2027_1']);
        expect(result.carry.households[0].creditAdjustmentIds).not.toContain('refund');
        expect(result.prior.creditAdjustments[0]).toEqual(source.creditAdjustments[0]);
        expect(financials({ ...source, ...result.prior }, source.familyMembers[0], source.reopenedAdjustmentIds).credit).toBe(30);
        expectCarryInvariants(source, result);
    });

    it('fixtures 5 and 7 snapshot linked-member charges, True-up calculations and ended-bill detail', () => {
        const source = carryFixture({ bills: 144, paid: 166 });
        source.familyMembers = [
            { id: 1, linkedMembers: [2, 3] }, { id: 2, linkedMembers: [] }, { id: 3, linkedMembers: [] }
        ];
        source.bills[0].members = [1, 2, 3];
        source.reviewServiceCredits = [1, 2, 3].map(memberId => ({
            id: `sc-${memberId}`, memberId, billId: 'b1', basis: 'ended', kind: 'service_credit',
            amount: 16, reason: 'Northline ended after August.', status: 'active'
        }));
        source.owedAdjustments = source.reviewServiceCredits;
        const ended = reviewCarry(freezeRecords(source));
        expect(ended.next.owedAdjustments[0].items[0]).toMatchObject({ memberId: 1, kind: 'credit', amount: -70,
            detail: [
                { sourceId: 'sc-1', amount: -16 }, { sourceId: 'sc-2', amount: -16 },
                { sourceId: 'sc-3', amount: -16 }, { kind: 'remainder', amount: -22 }
            ]
        });
        const fullyPaid = { ...source, payments: [{ id: 'fixture-22', memberId: 1, amount: 144 }] };
        expect(reviewCarry(fullyPaid).next.owedAdjustments[0].items[0].amount).toBe(-48);

        const netting = {
            ...source, reviewServiceCredits: [],
            owedAdjustments: [1, 2].map(memberId => ({
                id: `tu-${memberId}`, memberId, billId: 'b1', billName: 'Northline Mobile', kind: 'usage_charge',
                basis: 'price_change', amount: 12, description: 'Northline rose in July.',
                incurredDate: '2026-07-01', status: 'deferred', calc: { months: 6, gross: 108, coveredBy: [] }
            }))
        };
        const result = reviewCarry(freezeRecords(netting));
        expect(result.next.owedAdjustments[0].amount).toBe(2);
        expect(result.next.owedAdjustments[0].items.map(i => i.amount)).toEqual([12, 12, -22]);
        expect(result.next.owedAdjustments[0].items[1]).toMatchObject({
            sourceId: 'tu-2', memberId: 2, billName: 'Northline Mobile',
            description: 'Northline rose in July.', incurredDate: '2026-07-01', basis: 'price_change', calc: { months: 6, gross: 108 }
        });
        // Returned snapshots are mutable independently, even when sources are frozen.
        result.next.owedAdjustments[0].items[1].calc.coveredBy.push({ adjustmentId: 'later' });
        expect(result.carry.households[0].items[1].calc.coveredBy).toEqual([]);
        expect(netting.owedAdjustments[1].calc.coveredBy).toEqual([]);
        expectCarryInvariants(netting, result);
    });

    it('keeps older and other-household Service Credits out of review detail', () => {
        const source = carryFixture({ paid: 130, serviceCredit: 10 });
        source.owedAdjustments.push({ id: 'older', memberId: 1, billId: 'b1', kind: 'service_credit', amount: 5, status: 'active' });
        source.reviewServiceCredits.push({ id: 'other-household', memberId: 99, kind: 'service_credit', basis: 'ended', amount: 80, status: 'active' });
        const item = reviewCarry(freezeRecords(source)).next.owedAdjustments[0].items[0];
        expect(item.amount).toBe(-45);
        expect(item.detail.map(d => d.sourceId || d.kind)).toEqual(['review-credit', 'remainder']);
        expect(item.detail[1]).toEqual({ kind: 'remainder', description: 'Other 2026 overpayment', amount: -35 });
    });

    it('serializes a supplied Service Credit without basis as null, never the member-charge default', () => {
        const source = carryFixture({ paid: 100, serviceCredit: 48 });
        delete source.reviewServiceCredits[0].basis;
        const detail = reviewCarry(freezeRecords(source)).next.owedAdjustments[0].items[0].detail;
        expect(detail).toEqual([{
            sourceId: 'review-credit', basis: null, memberId: 1, billName: 'Northline',
            description: 'Service ended in August.', amount: -48
        }]);
        // Serialization must not silently erase an undefined field before save.
        expect(JSON.parse(JSON.stringify(detail))).toEqual(detail);
        expect(detail[0].basis).not.toBe('member');
    });

    it('stamps every active household seed without changing status, voided seeds or other households', () => {
        const source = carryFixture({ bills: 0, incoming: -100 });
        source.familyMembers.push({ id: 2, linkedMembers: [] }, { id: 3, linkedMembers: [] });
        source.familyMembers[0].linkedMembers = [2];
        source.owedAdjustments.push(
            { id: 'linked', memberId: 2, kind: 'carry_opening', amount: -32, status: 'carried_in' },
            { id: 'voided', memberId: 1, kind: 'carry_opening', amount: -70, status: 'voided' },
            { id: 'other', memberId: 3, kind: 'carry_opening', amount: 50, status: 'carried_in' }
        );
        const result = reviewCarry(freezeRecords(source));
        expect(result.carry.households[0]).toMatchObject({ unusedOpeningCredit: 132, openingSeedIds: ['incoming', 'linked'] });
        expect(result.prior.owedAdjustments.map(a => a.carriedForwardTo)).toEqual(['2027', '2027', undefined, undefined]);
        expect(result.prior.owedAdjustments.map(a => a.status)).toEqual(['carried_in', 'carried_in', 'voided', 'carried_in']);
        expect(result.prior.carriedCreditRecords).toEqual([]);
        expectCarryInvariants(source, result);
    });

    it('keeps legacy carry and seed shapes unchanged and record ids deterministic', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-12-31T12:00:00.000Z'));
        try {
            const source = freezeRecords(carryFixture({ paid: 120, deferred: 5, incoming: -132 }));
            const legacy = buildCarryForwardSummary(source.familyMembers, source.bills, source.payments, [], source.owedAdjustments, { fromYearLabel: '2026', nextYearLabel: '2027' });
            expect(legacy).toEqual(buildCarryForward(source.familyMembers, source.bills, source.payments, [], source.owedAdjustments, { fromYearLabel: '2026', nextYearLabel: '2027' }));
            expect(buildNewYearData(source.familyMembers, [], {}, '2027', legacy, '2026').owedAdjustments).toEqual([{
                id: 'coadj_2026_1', memberId: 1, kind: 'carry_opening', amount: -115, status: 'carried_in',
                fromYear: '2026', createdAt: '2026-12-31T12:00:00.000Z'
            }]);
            const first = reviewCarry(source);
            const retry = reviewCarry(source);
            expect(retry).toEqual(first);
            expect(first.prior.carriedCreditRecords[0].id).toBe('cadj_carry_2027_1');
            expect(first.next.owedAdjustments[0].id).toBe('coadj_2026_1');
            expect(first.next.owedAdjustments[0].items.find(i => i.kind === 'credit').sourceId).toBe('cadj_carry_2027_1');
            const custom = buildCarryForwardSummary(source.familyMembers, source.bills, source.payments, [], source.owedAdjustments,
                { fromYearLabel: '2026', nextYearLabel: '2027', creditDispositionIds: new Map([[1, 'custom-1']]) });
            expect(applyCarryForwardToPriorYear([], source.owedAdjustments, custom,
                { nextYearLabel: '2027' }).carriedCreditRecords[0].id).toBe('custom-1');
        } finally {
            vi.useRealTimers();
        }
    });

    it('property: generated household ledgers conserve items, credit detail, money and source settlement', () => {
        // Fixed-seed generation gives reproducible cent-level household mixtures,
        // including shared bills, linked members, refunds, positive/negative seeds,
        // True-ups, old/review credits, ignored records and billed/deferred charges.
        let randomState = 0x6012026;
        const random = max => {
            randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
            return randomState % max;
        };
        for (let run = 0; run < 250; run++) {
            const source = { familyMembers: [], bills: [], payments: [], creditAdjustments: [], owedAdjustments: [], reviewServiceCredits: [] };
            for (let h = 0; h < 1 + random(5); h++) {
                const primary = h * 10 + 1;
                const memberIds = Array.from({ length: 1 + random(3) }, (_, i) => primary + i);
                source.familyMembers.push(...memberIds.map(id => ({ id, linkedMembers: id === primary ? memberIds.slice(1) : [] })));
                source.bills.push({ id: `bill-${h}`, name: `Bill ${h}`, amount: random(40001) / 100, billingFrequency: random(2) ? 'monthly' : 'annual', members: memberIds });
                memberIds.forEach(memberId => {
                    const paid = random(70001) / 100;
                    source.payments.push({ id: `payment-${memberId}`, memberId, amount: paid });
                    source.creditAdjustments.push({ id: `refund-${memberId}`, memberId, type: 'refund', amount: random(Math.round(paid * 100) + 1) / 100, status: random(3) ? 'recorded' : 'cancelled' });
                    source.owedAdjustments.push(
                        { id: `seed-${memberId}`, memberId, kind: 'carry_opening', amount: (random(80001) - 40000) / 100, status: 'carried_in' },
                        { id: `charge-${memberId}`, memberId, billId: `bill-${h}`, kind: 'usage_charge', amount: (1 + random(10000)) / 100, status: 'deferred', basis: random(2) ? 'price_change' : 'late_start', calc: { months: 1 + random(12) } },
                        { id: `billed-${memberId}`, memberId, kind: 'usage_charge', amount: (1 + random(10000)) / 100, status: 'billed' },
                        { id: `old-${memberId}`, memberId, kind: 'service_credit', amount: (1 + random(30001)) / 100, status: 'active' },
                        { id: `voided-credit-${memberId}`, memberId, kind: 'service_credit', amount: 1000, status: 'voided' },
                        { id: `voided-${memberId}`, memberId, kind: 'carry_opening', amount: -1000, status: 'voided' }
                    );
                    const credit = { id: `sc-${memberId}`, memberId, billId: `bill-${h}`, kind: 'service_credit', basis: 'ended', reason: 'Ended', amount: (1 + random(30001)) / 100, status: 'active' };
                    source.owedAdjustments.push(credit);
                    source.reviewServiceCredits.push(credit);
                });
            }
            // Splits across household boundaries deliberately produce sub-cent
            // bill shares; the frozen calculation seam retains its exact values.
            source.bills.push({ id: 'shared', name: 'Shared', amount: 23.47, billingFrequency: 'annual', members: source.familyMembers.map(m => m.id) });
            freezeRecords(source);
            const result = reviewCarry(source);
            expectCarryInvariants(source, result);
            expect(result.next.owedAdjustments).toHaveLength(result.carry.households.length);
            expect(result.carry.totalOpeningBalance).toBeCloseTo(result.next.owedAdjustments.reduce((sum, a) => sum + a.amount, 0), 8);
            // (d) Each generated incoming amount survives empty future years.
            const empty = { ...source, ...result.next, bills: [], reviewServiceCredits: [] };
            const again = reviewCarry(empty, '2027', '2028');
            const third = reviewCarry({ ...empty, ...again.next }, '2028', '2029');
            expect(third.next.owedAdjustments.map(a => a.amount)).toEqual(again.next.owedAdjustments.map(a => a.amount));
        }
    });
});

// The reviewed rollover's pure preparation step (#606): the seam the commit (batch today,
// the version-checked transaction next) consumes over whatever source snapshot it read.
describe('buildReviewedRollover (#606, ADR 0009 § 3)', () => {
    const source = () => freezeRecords({
        activeYear: { id: '2026', label: '2026', status: 'open' },
        familyMembers: [{ id: 1, name: 'Ada', linkedMembers: [2] }, { id: 2, name: 'Erik', linkedMembers: [] }, { id: 3, name: 'Kenji', linkedMembers: [] }],
        bills: [{ id: 10, name: 'Northline Mobile', amount: 180, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2, 3] }],
        payments: [{ id: 'p1', memberId: 1, amount: 1440 }, { id: 'p3', memberId: 3, amount: 720 }],
        creditAdjustments: [], owedAdjustments: [], billingEvents: [{ id: 'evt_old', eventType: 'BILL_CREATED', payload: {} }],
        settings: { emailMessage: 'Hi', paymentLinks: [], paymentMethods: [] }
    });
    const payload = (fields = {}) => ({ reconciliationId: 'rec-1', sourceYearId: '2026', sourceFingerprint: 'yer1_x',
        trueUps: [{ billId: 10, newAmount: 198, firstMonth: '2026-07' }], confirmations: { noBillChanges: false }, ...fields });
    const ctx = () => {
        let n = 0;
        return { now: '2026-12-01T10:00:00.000Z', userId: 'u1', eventId: () => 'evt_' + (++n) };
    };

    it('selects the review path by key presence, not truthiness, and keeps undefined legacy', () => {
        expect(isReviewedRollover({ reconciliation: {} })).toBe(true);
        expect(isReviewedRollover({ reconciliation: null })).toBe(true);
        expect(isReviewedRollover({ reconciliation: undefined })).toBe(false);
        expect(isReviewedRollover({ reopenedAdjustmentIds: new Set() })).toBe(false);
        expect(isReviewedRollover(undefined)).toBe(false);
    });

    it('is pure and deterministic over a frozen source: same records, ids and fingerprint on every attempt', () => {
        const input = source();
        const first = buildReviewedRollover(input, '2027', payload(), ctx());
        const second = buildReviewedRollover(input, '2027', payload(), ctx());
        const stable = value => JSON.parse(JSON.stringify(value, (key, nested) => key === 'createdAt' ? undefined : nested));
        expect(stable(second)).toEqual(stable(first));
        expect(first.priorYear.owedAdjustments.map(row => row.id)).toEqual(['oadj_tu_2026_tu_2026_10_1', 'oadj_tu_2026_tu_2026_10_2', 'oadj_tu_2026_tu_2026_10_3']);
        expect(first.priorYear.owedAdjustments.every(row => row.status === 'carried_forward')).toBe(true);
        expect(first.priorYear.billingEvents.map(event => event.eventType)).toEqual(['BILL_CREATED', 'TRUE_UP_RECORDED', 'YEAR_CARRIED_FORWARD', 'YEAR_ROLLED_OVER']);
        expect(first.priorYear.billingEvents[1]).toMatchObject({ id: 'evt_1', timestamp: '2026-12-01T10:00:00.000Z', actor: { type: 'admin', userId: 'u1' }, source: 'ui' });
        expect(first.newYearData.owedAdjustments.map(seed => [seed.id, seed.amount])).toEqual([['coadj_2026_1', 72], ['coadj_2026_3', 36]]);
        expect(input.owedAdjustments).toEqual([]);
    });

    it('fingerprints the payload entries and label, independent of key order and the source binding', () => {
        const base = payload();
        const reordered = Object.fromEntries(Object.entries(base).reverse());
        expect(computePayloadFingerprint(reordered, '2027')).toBe(computePayloadFingerprint(base, '2027'));
        expect(computePayloadFingerprint({ ...base, sourceFingerprint: 'yer1_y' }, '2027')).toBe(computePayloadFingerprint(base, '2027'));
        expect(computePayloadFingerprint(payload({ trueUps: [{ billId: 10, newAmount: 199, firstMonth: '2026-07' }] }), '2027'))
            .not.toBe(computePayloadFingerprint(base, '2027'));
        expect(computePayloadFingerprint(base, '2028')).not.toBe(computePayloadFingerprint(base, '2027'));
    });

    it('rejects payload shapes that would duplicate or misclassify records', () => {
        expect(() => buildReviewedRollover(source(), '2027', payload({ serviceCredits: [{ billId: 10, basis: 'price_change', newAmount: 170, firstMonth: '2026-07' }] }), ctx()))
            .toThrow(/more than once/);
        expect(() => buildReviewedRollover(source(), '2027', payload({ trueUps: [], serviceCredits: [{ billId: 10, basis: 'price_change', newAmount: 198, firstMonth: '2026-07' }] }), ctx()))
            .toThrow(/True-up, not a Service Credit/);
        expect(() => buildReviewedRollover(source(), '2027', payload({ trueUps: [{ billId: 99, newAmount: 5, firstMonth: '2026-07' }] }), ctx()))
            .toThrow(/not in the 2026 billing year/);
        expect(() => buildReviewedRollover(source(), '2027', payload({ endedBillIds: [10] }), ctx())).toThrow(/without its last month/);
        expect(() => buildReviewedRollover(source(), '2027', payload({ newBills: [{ rowId: 'r', billId: 10, name: 'X', amount: 5, frequency: 'monthly',
            website: '', members: [1], firstMonth: '2026-09' }] }), ctx())).toThrow(/collides/);
        const existing = { ...source(), owedAdjustments: [{ id: 'oadj_tu_2026_tu_2026_10_1', memberId: 1, kind: 'usage_charge', amount: 1, status: 'billed' }] };
        expect(() => buildReviewedRollover(existing, '2027', payload(), ctx())).toThrow(/already exists/);
        expect(() => buildReviewedRollover(source(), '2027', payload(), { now: 'x' })).toThrow(/event id factory/);
    });

    it('records nothing for a memberless ended bill, leaves it out of the next year and notes BILL_ENDED_UNASSIGNED', () => {
        const input = { ...source(), bills: [...source().bills, { id: 11, name: 'Old Cloud', amount: 12, billingFrequency: 'monthly', members: [] }] };
        const result = buildReviewedRollover(input, '2027', payload({ trueUps: [], endedBillIds: [11],
            serviceCredits: [{ billId: 11, basis: 'ended', lastMonth: '2026-08' }] }), ctx());
        expect(result.priorYear.owedAdjustments).toEqual([]);
        expect(result.newYearData.bills.map(bill => bill.id)).toEqual([10]);
        expect(result.priorYear.billingEvents.map(event => event.eventType)).toEqual(['BILL_CREATED', 'BILL_ENDED_UNASSIGNED', 'YEAR_ROLLED_OVER']);
        expect(result.priorYear.billingEvents[1].payload).toEqual({ billId: 11, billName: 'Old Cloud', lastMonth: '2026-08', reconciliationId: 'rec-1' });
    });
});
