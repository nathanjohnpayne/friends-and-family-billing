/** Source authority, finalized carry and aggregate failure integration (ADR 0010). */
import { describe, it, expect } from 'vitest';
import { getHouseholdFinancials, calculateSettlementMetrics, buildCarryForward } from '@/lib/calculations.js';
import { getYearFinancialAvailability, getHouseholdFinancialAvailability } from '@/lib/financial-availability.js';
import { applyCarryForwardToPriorYear, buildNewYearData } from '@/lib/billing-year.js';
import { buildHouseholdPreview } from '@/lib/year-end-review.js';

const members = [1, 2, 3].map(id => ({ id, linkedMembers: [] }));
const source = overrides => ({ familyMembers: structuredClone(members), bills: [], payments: [], creditAdjustments: [], owedAdjustments: [], ...overrides });
const payment = (id, amount, memberId = 1) => ({ id, amount, memberId });
const charge = (id, amount, memberId = 1, status = 'deferred') => ({ id, amount, memberId, kind: 'usage_charge', status });
const plan = (state, options = {}) => buildCarryForward(state.familyMembers, state.bills, state.payments, state.creditAdjustments, state.owedAdjustments,
    { fromYearLabel: '2026', nextYearLabel: '2027', ...options });
const noMoney = result => {
    expect(result.ok).toBe(false);
    for (const field of ['cents', 'owed', 'credit', 'balance', 'totalOpeningBalance', 'seeds', 'priorYear', 'firstInvoiceTotal']) expect(result).not.toHaveProperty(field);
};

describe('activated complete-source boundary', () => {
    it.each(['familyMembers', 'bills', 'payments', 'creditAdjustments', 'owedAdjustments'])('holds missing and invalid %s without a money fallback', field => {
        for (const value of [undefined, null, {}, '[]']) {
            const state = source({ [field]: value });
            noMoney(getHouseholdFinancials(members[0], state));
            expect(getYearFinancialAvailability(state).available).toBe(false);
        }
    });

    it('withholds malformed or missing source before member lookup', () => {
        for (const state of [null, undefined, source({ familyMembers: {} })]) {
            expect(getHouseholdFinancialAvailability(state, 1).available).toBe(false);
        }
    });

    it('isolates a malformed source household and preserves structural paid counts', () => {
        const state = source({ payments: [payment('held', '1'), payment('paid', 1, 2)],
            bills: [{ id: 'debt', amount: 1, billingFrequency: 'annual', members: [2, 3] }] });
        const metrics = calculateSettlementMetrics(state.familyMembers, state.bills, state.payments, state.creditAdjustments, null, state.owedAdjustments);
        noMoney(metrics);
        expect(metrics).toMatchObject({ totalMembers: 3, paidCount: 1, needsCorrectionCount: 1 });
        expect(metrics).not.toHaveProperty('totalOutstanding');
        expect(getHouseholdFinancialAvailability(state, 2).available).toBe(true);
        expect(getHouseholdFinancialAvailability(state, 1).available).toBe(false);
    });

    it('preserves reopening admission and treats zero-owed signed N as real debt or credit', () => {
        const state = source({ creditAdjustments: [{ id: 'r', memberId: 1, type: 'refund', status: 'recorded', amount: '0.01' }] });
        noMoney(getHouseholdFinancials(members[0], state));
        expect(getHouseholdFinancials(members[0], state, { reopenedAdjustmentIds: new Set(['r']) })).toMatchObject({ ok: true, cents: { balance: 0 } });
        state.creditAdjustments[0].amount = 0.01;
        expect(calculateSettlementMetrics(state.familyMembers, [], [], state.creditAdjustments)).toMatchObject({ ok: true, paidCount: 2, totalOutstanding: 0.01 });
        state.creditAdjustments[0].amount = -0.01;
        expect(getHouseholdFinancials(members[0], state)).toMatchObject({ ok: true, cents: { balance: -1, credit: 1 } });
    });

    it('rounds an exact positive half-percent tie upward and retains percentage clamps', () => {
        const bills = [{ id: 'bill', amount: 0.40, billingFrequency: 'annual', members: [1] }];
        expect(calculateSettlementMetrics([members[0]], bills, [payment('p', 0.23)]).percentage).toBe(58);
        expect(calculateSettlementMetrics([members[0]], bills, []).percentage).toBe(0);
        expect(calculateSettlementMetrics([members[0]], bills, [payment('p', 1)]).percentage).toBe(100);
        expect(calculateSettlementMetrics([members[0]], [], [payment('p', 1)]).percentage).toBe(0);
    });

    it('withholds unsafe aggregate money without a phantom held household or blocking valid actions', () => {
        const state = source({ payments: [payment('a', 60000000000000), payment('b', 60000000000000, 2)] });
        const metrics = calculateSettlementMetrics(state.familyMembers, [], state.payments);
        noMoney(metrics);
        expect(metrics).toMatchObject({ totalMembers: 3, paidCount: 3, needsCorrectionCount: 0, holds: [{ householdId: null, code: 'UNSAFE_CENTS' }] });
        expect(getYearFinancialAvailability(state)).toMatchObject({ available: false, needsCorrectionCount: 0, yearHoldCount: 1 });
        expect(getHouseholdFinancialAvailability(state, 1).available).toBe(true);
    });

    it('withholds a safe-cent finalized plan when its aggregate dollar alias cannot round-trip', () => {
        const state = source({ payments: [payment('a', 59999999999999.99), payment('b', 30071992547409.92, 2)] });
        expect(getHouseholdFinancials(members[0], state).ok).toBe(true);
        expect(getHouseholdFinancials(members[1], state).ok).toBe(true);
        const carry = plan(state);
        noMoney(carry);
        expect(carry.holds[0].code).toBe('UNSAFE_CENTS');
    });

    it('converts unrepresentable dollar aliases to a no-money result', () => {
        const state = source({ payments: [payment('large', 90071992547409.9), payment('cent', 0.01)] });
        noMoney(getHouseholdFinancials(members[0], state));
        noMoney(plan(state));
    });
});

describe('finalized whole-year carry plan', () => {
    it.each(['custom', 'default', 'cross-household', 'cancelled'])('holds an actual %s disposition id collision before marking or seeding', scenario => {
        const id = scenario === 'default' ? 'cadj_carry_2027_1' : 'actual-id';
        const state = source({ payments: [payment('p', 1)] });
        state.creditAdjustments = [{ id, memberId: scenario === 'cross-household' ? 2 : 1, type: 'refund', amount: 0, status: 'cancelled' }];
        const result = plan(state, scenario === 'default' ? {} : { creditDispositionIds: new Map([[1, id]]) });
        noMoney(result);
        expect(result.holds || result.households.flatMap(row => row.holds || [])).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_ID' })]));
    });

    it('preserves independent ledger namespaces without a shared marking or seed parent', () => {
        const state = source({ payments: [payment('p', 1)], owedAdjustments: [charge('actual-id', 1, 2, 'voided')] });
        expect(plan(state, { creditDispositionIds: new Map([[1, 'actual-id']]) }).ok).toBe(true);
        // A carried charge and credit inside the same seed still cannot share a tie key.
        const ambiguousSeed = source({ payments: [payment('p', 1)], owedAdjustments: [charge('actual-id', 1)] });
        noMoney(plan(ambiguousSeed, { creditDispositionIds: new Map([[1, 'actual-id']]) }));
    });

    it('rejects two actual generated ids that collide across households and ambiguous marking ids', () => {
        const state = source({ payments: [payment('p1', 1), payment('p2', 1, 2)] });
        noMoney(plan(state, { creditDispositionIds: new Map([[1, 'same'], [2, 'same']]) }));
        noMoney(plan(source({ owedAdjustments: [charge('same', 1), charge('same', 1, 2)] })));
    });

    it('uses one validated actual id in markings, credit detail and next-year seeds without altering input', () => {
        const state = source({ payments: [payment('p', 2)], owedAdjustments: [charge('charge', 1)] });
        const before = structuredClone(state);
        const carry = plan(state, { creditDispositionIds: new Map([[1, 'actual-persisted-id']]), itemized: true });
        expect(carry.ok).toBe(true);
        const prior = applyCarryForwardToPriorYear(state.creditAdjustments, state.owedAdjustments, carry, { nextYearLabel: '2027', now: 'fixed' });
        const next = buildNewYearData(state.familyMembers, [], {}, '2027', carry, '2026');
        expect(prior.carriedCreditRecords[0].id).toBe('actual-persisted-id');
        expect(next.owedAdjustments[0].items.find(row => row.kind === 'credit').sourceId).toBe('actual-persisted-id');
        expect(prior.owedAdjustments[0].status).toBe('carried_forward');
        expect(state).toEqual(before);
    });

    it('retains review zero-net detail while legacy seeds omit zero net amounts', () => {
        const state = source({ payments: [payment('p', 1)], owedAdjustments: [charge('d', 1)] });
        expect(plan(state).seeds).toEqual([]);
        expect(plan(state, { itemized: true }).seeds[0]).toMatchObject({ amount: 0, items: expect.any(Array) });
    });

    it.each(['service_credit', 'carry_opening', 'usage_charge'])('propagates malformed %s carry evidence into preview while siblings remain assessable', kind => {
        const state = source({ owedAdjustments: [{ id: 'bad', memberId: 1, kind, status: kind === 'service_credit' ? 'active' : kind === 'carry_opening' ? 'carried_in' : 'deferred', amount: '1' }] });
        const preview = buildHouseholdPreview({ familyMembers: state.familyMembers, sourceBills: [], nextBills: [], carry: plan(state, { itemized: true }) });
        noMoney(preview[0]);
        expect(preview[1]).toMatchObject({ ok: true, firstInvoiceTotal: 0 });
    });
});
