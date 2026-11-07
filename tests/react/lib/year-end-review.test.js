import { buildCarryForwardSummary } from '@/lib/billing-year.js';
import { describe, it, expect } from 'vitest';
import { normalizeYearData } from '../../../src/lib/persistence.js';
import {
    toCents, splitCents, monthsFromFirst, monthsAfterLast, computePriceChange, computeLateStart, computeEnded,
    buildTrueUpRecords, buildServiceCreditRecords, buildUsageChargeRecord, deriveNextYearBills, buildHouseholdPreview,
    snapshotExistingCredit, existingCreditCoverage, revalidateExistingCreditAnswers,
    computeSourceFingerprint, findSuccessorYear, shouldOfferYearEndReview, validateDraft, canStart
} from '../../../src/lib/year-end-review.js';

const members = [1, 2, 3];
const bill = { id: 20, name: 'Northline', amount: 12, billingFrequency: 'monthly', members };
const year = { id: '2026', label: '2026', status: 'open' };
const ctx = { sourceYear: year };
const recordCtx = { sourceYearId: '2026', reconciliationId: 'review-1', now: '2026-11-04T10:00:00.000Z' };
const familyMembers = members.map(id => ({ id, name: `Member ${id}`, linkedMembers: id === 1 ? [2, 3] : [] }));
const credit = (id, memberId, amount) => ({ id, memberId, billId: 20, amount, kind: 'service_credit', status: 'active',
    incurredDate: '2026-09-02', reason: 'Cancellation and outage', createdAt: '2026-09-02T00:00:00.000Z' });
const endedRow = { change: 'ended', lastMonth: '2026-08', existingCredits: {} };
const answer = (record, result, choice = 'covers', appliedCents) => ({ choice, ...(appliedCents === undefined ? {} : { appliedCents }),
    seen: snapshotExistingCredit(record), coverage: existingCreditCoverage(result, record.memberId) });

function draftFor(records = [], row = endedRow) {
    const source = { ...year, bills: [bill], familyMembers, owedAdjustments: records };
    return { draftVersion: 1, reconciliationId: 'review-1', userId: 'u', sourceYearId: '2026', sourceLabel: '2026', nextYearLabel: '2027',
        sourceFingerprint: computeSourceFingerprint(source), savedAt: recordCtx.now, bills: { 20: structuredClone(row) }, newBills: [], charges: [],
        confirmations: { noBillChanges: false, noNewSubscriptions: true, noExtraCharges: true } };
}
const restoreCtx = (records = [], overrides = {}) => ({ userId: 'u', sourceYear: year, bills: [bill], familyMembers, owedAdjustments: records, ...overrides });

describe('Year-End Review cents and formulas', () => {
    it('rounds both directions symmetrically and allocates the last remainder', () => {
        expect(toCents(0.125)).toBe(13);
        expect(toCents(-0.125)).toBe(-13);
        expect(splitCents(1667, members).map(s => s.cents)).toEqual([555, 555, 557]);
        expect(splitCents(1, members).map(s => s.cents)).toEqual([0, 0, 1]);
        expect(() => splitCents(1.5, members)).toThrow();
        expect(splitCents(10, [1, 1]).map(share => share.cents)).toEqual([5, 5]);
        expect(splitCents(10, [null, '']).map(share => share.cents)).toEqual([5, 5]);
        expect(() => computeEnded({ ...bill, members: [1, 1] }, endedRow, ctx)).toThrow('distinct ids');
        expect(() => computeEnded({ ...bill, members: [null, ''] }, endedRow, ctx)).toThrow('distinct ids');
        expect(() => toCents(Infinity)).toThrow();
    });
    it('counts inclusive starting months, exclusive ending months and rejects other years', () => {
        expect(monthsFromFirst('2026-01', year)).toBe(12);
        expect(monthsFromFirst('2026-07', year)).toBe(6);
        expect(monthsFromFirst('2026-12', year)).toBe(1);
        expect(monthsAfterLast('2026-08', year)).toBe(4);
        expect(monthsAfterLast('2026-12', year)).toBe(0);
        for (const value of ['2027-08', '2026-13', '2026-00', '08']) expect(() => monthsAfterLast(value, year)).toThrow();
    });
    it('fixture 1: increases Northline by $108 across nine members', () => {
        const result = computePriceChange({ ...bill, amount: 180, members: [1,2,3,4,5,6,7,8,9] }, { newAmount: 198, firstMonth: '2026-07' }, ctx);
        expect(result.grossCents).toBe(10800);
        expect(result.shares.map(s => s.netCents)).toEqual(Array(9).fill(1200));
        expect(result.formula).toBe('($198.00 − $180.00) × 6 months = $108.00 ÷ 9 members = $12.00 each');
        expect(result.calc).toMatchObject({ computed: 108, gross: 108, recorded: 108, months: 6 });
    });
    it('fixture 2: does annual division before rounding, with symmetric decreases', () => {
        const result = computePriceChange({ ...bill, amount: 139, billingFrequency: 'annual' }, { newAmount: 159, firstMonth: '2026-03' }, ctx);
        expect(result.grossCents).toBe(1667);
        expect(result.shares.map(s => s.netCents)).toEqual([555, 555, 557]);
        expect(result.calc.toMonthly).toBe(159 / 12);
        expect(result.formula).toContain('÷ 12 × 10 months = $16.67');
        const increase = computePriceChange({ ...bill, amount: 1 }, { newAmount: 1.125, firstMonth: '2026-12' }, ctx);
        const decrease = computePriceChange({ ...bill, amount: 1.125 }, { newAmount: 1, firstMonth: '2026-12' }, ctx);
        expect([increase.grossCents, decrease.grossCents]).toEqual([13, 13]);
        expect(decrease.kind).toBe('service_credit');
    });
    it.each([[139, 159.01, 1001], [159.01, 139, 1001], [139, 139.01, 1], [139.01, 139, 1]])(
        'prorates annual price changes %s → %s at the exact half-cent boundary', (fromAmount, newAmount, expectedCents) => {
            const result = computePriceChange({ ...bill, amount: fromAmount, billingFrequency: 'annual' }, { newAmount, firstMonth: '2026-07' }, ctx);
            expect(result.grossCents).toBe(expectedCents);
            expect(result.shares.reduce((sum, share) => sum + share.netCents, 0)).toBe(expectedCents);
        }
    );
    it('subtracts fractional-cent entered amounts before final rounding', () => {
        const result = computePriceChange({ ...bill, amount: 1.125 }, { newAmount: 1.25, firstMonth: '2026-12' }, ctx);
        expect(result.grossCents).toBe(13);
        expect(computePriceChange({ ...bill, amount: 1.25 }, { newAmount: 1.125, firstMonth: '2026-12' }, ctx).grossCents).toBe(13);
        expect(computePriceChange({ ...bill, amount: 1.125 }, { newAmount: 1.25, firstMonth: '2026-07' }, ctx).grossCents).toBe(75);
    });
    it('rounds annual late-start and ended proration only once at the cent boundary', () => {
        const annual = { ...bill, amount: 139.01, billingFrequency: 'annual' };
        expect(computeLateStart({ ...annual, firstMonth: '2026-07' }, ctx).grossCents).toBe(6951);
        expect(computeEnded(annual, { lastMonth: '2026-06' }, ctx).grossCents).toBe(6951);
        expect(computeLateStart({ ...bill, amount: 1.005, firstMonth: '2026-12' }, ctx).grossCents).toBe(101);
        expect(computeEnded({ ...bill, amount: 1.005 }, { lastMonth: '2026-11' }, ctx).grossCents).toBe(101);
    });
    it('supports scientific notation and refuses a proration beyond safe integer cents', () => {
        const tiny = computePriceChange({ ...bill, amount: 1e-7, billingFrequency: 'annual' }, { newAmount: 0.0100001, firstMonth: '2026-07' }, ctx);
        expect(tiny.grossCents).toBe(1);
        expect(computeLateStart({ ...bill, amount: 1e-7, firstMonth: '2026-01' }, ctx).grossCents).toBe(0);
        expect(() => computeLateStart({ ...bill, amount: 1e20, firstMonth: '2026-01' }, ctx)).toThrow('too large');
    });
    it('fixtures 3–5: late start, reduced price and ended bill', () => {
        const late = computeLateStart({ ...bill, billId: 21, id: undefined, amount: 9.99, firstMonth: '2026-09' }, ctx);
        expect(late.grossCents).toBe(3996);
        expect(late.shares.map(s => s.netCents)).toEqual([1332, 1332, 1332]);
        expect(late.calc.fromAmount).toBeNull();
        const reduced = computePriceChange({ ...bill, amount: 30 }, { newAmount: 24, firstMonth: '2026-10' }, ctx);
        expect(reduced).toMatchObject({ kind: 'service_credit', grossCents: 1800, basis: 'price_change' });
        expect(reduced.shares.map(s => s.netCents)).toEqual([600, 600, 600]);
        const ended = computeEnded(bill, endedRow, ctx);
        expect(ended.grossCents).toBe(4800);
        expect(ended.shares.map(s => s.netCents)).toEqual([1600, 1600, 1600]);
        expect(ended.formula).toContain('4 months (Sep–Dec)');
    });
    it('overrides the gross before splitting and retains the formula amount', () => {
        const result = computeEnded(bill, { ...endedRow, override: 40 }, ctx);
        expect(result.calc).toMatchObject({ computed: 48, gross: 40, recorded: 40, overridden: true });
        expect(result.shares.map(s => s.netCents)).toEqual([1333, 1333, 1334]);
        expect(result.formula).toContain('computed $48.00 → entered $40.00');
        for (const override of [0, -1, '40', NaN, 0.001]) expect(() => computeEnded(bill, { ...endedRow, override }, ctx)).toThrow();
        expect(() => computePriceChange(bill, { newAmount: 12, firstMonth: '2026-07' }, ctx)).toThrow('No change');
    });
    it('returns explicit zero, fully covered and memberless outcomes without zero review records', () => {
        const december = computeEnded(bill, { lastMonth: '2026-12' }, ctx);
        expect(december).toMatchObject({ outcome: 'omitted', zeroReason: 'no_months', records: [] });
        expect(buildServiceCreditRecords(december, recordCtx)).toEqual([]);
        expect(() => computeEnded(bill, { lastMonth: '2026-12', override: 10 }, ctx)).toThrow('nonzero');
        const tiny = computePriceChange({ ...bill, amount: 12, billingFrequency: 'annual' }, { newAmount: 12.01, firstMonth: '2026-12' }, ctx);
        expect(tiny).toMatchObject({ outcome: 'kept_at_new_price', zeroReason: 'rounds_to_zero' });
        expect(buildTrueUpRecords(tiny, recordCtx)).toEqual([]);
        const penny = computePriceChange(bill, { newAmount: 12.01, firstMonth: '2026-12' }, ctx);
        expect(penny.shares.map(s => s.netCents)).toEqual([0, 0, 1]);
        expect(buildTrueUpRecords(penny, recordCtx)).toHaveLength(1);
        expect(buildTrueUpRecords(penny, recordCtx)[0]).toMatchObject({ memberId: 3, amount: 0.01 });
        for (const result of [computeEnded({ ...bill, members: [] }, endedRow, ctx), computePriceChange({ ...bill, members: [] }, { newAmount: 9, firstMonth: '2026-07' }, ctx)]) {
            expect(result).toMatchObject({ outcome: 'no_members', shares: [], records: [] });
        }
        expect(() => computeLateStart({ ...bill, members: [], firstMonth: '2026-09' }, ctx)).toThrow('at least one');
    });
});

describe('per-record, per-member existing credit answers (fixture 8)', () => {
    const base = computeEnded(bill, endedRow, ctx);
    it('8a: requires explicit answers and never infers purpose or changes existing records', () => {
        const records = members.map(m => credit('outage_' + m, m, 3));
        const before = structuredClone(records);
        expect(() => computeEnded(bill, endedRow, { ...ctx, owedAdjustments: records })).toThrow('Answer whether');
        const result = computeEnded(bill, { ...endedRow, existingCredits: Object.fromEntries(records.map(r => [r.id, answer(r, base, 'unrelated')])) }, { ...ctx, owedAdjustments: records });
        expect(result.grossCents).toBe(4800);
        expect(result.coveredBy).toEqual([]);
        expect(records).toEqual(before);
    });
    it('accepts explicit answers for legacy zero-share credits without creating new zero records', () => {
        const record = credit('legacy_zero', 1, 0);
        for (const choice of ['covers', 'unrelated']) {
            const result = computeEnded(bill, { ...endedRow, existingCredits: { legacy_zero: answer(record, base, choice) } }, { ...ctx, owedAdjustments: [record] });
            expect(result.grossCents).toBe(4800);
            expect(result.coveredBy).toEqual([]);
            expect(buildServiceCreditRecords(result, recordCtx).every(record => record.amount > 0)).toBe(true);
        }
    });
    it('8b: covers only B and retains full coverage in the bill audit result', () => {
        const record = credit('b', 2, 16);
        const result = computeEnded(bill, { ...endedRow, existingCredits: { b: answer(record, base) } }, { ...ctx, owedAdjustments: [record] });
        expect(result.shares.map(s => s.netCents)).toEqual([1600, 0, 1600]);
        const records = buildServiceCreditRecords(result, recordCtx);
        expect(records.map(r => r.memberId)).toEqual([1, 3]);
        expect(result.coveredBy).toEqual([{ adjustmentId: 'b', memberId: 2, appliedAmount: 16 }]);
        expect(result.calc).toMatchObject({ computed: 48, gross: 48, recorded: 32, alreadyCreditedCents: 1600 });
        expect(result.calc.gross - result.calc.recorded).toBe(result.coveredBy.reduce((sum, c) => sum + c.appliedAmount, 0));
    });
    it('8c and 8i: partial coverage works for both oversized and mixed-purpose small records', () => {
        for (const [amount, applied, net] of [[20, 1000, 600], [10, 500, 1100]]) {
            const record = credit('partial', 3, amount);
            const row = { ...endedRow, existingCredits: { partial: answer(record, base, 'partial', applied) } };
            const result = computeEnded(bill, row, { ...ctx, owedAdjustments: [record] });
            expect(result.shares[2].netCents).toBe(net);
            expect(buildServiceCreditRecords(result, recordCtx)[2].calc).toMatchObject({ share: 16, applied: applied / 100,
                coveredBy: [{ adjustmentId: 'partial', memberId: 3, appliedAmount: applied / 100 }] });
        }
        const record = credit('large', 3, 20);
        for (const [choice, appliedCents] of [['covers', undefined], ['partial', 1700], ['partial', 2000], ['partial', 0], ['partial', undefined]]) {
            expect(() => computeEnded(bill, { ...endedRow, existingCredits: { large: answer(record, base, choice, appliedCents) } }, { ...ctx, owedAdjustments: [record] })).toThrow();
        }
    });
    it('8d–f: fully covered ended bills still omit; reduced bills keep their new price', () => {
        const records = members.map(m => credit('full_' + m, m, 16));
        const full = computeEnded(bill, { ...endedRow, existingCredits: Object.fromEntries(records.map(r => [r.id, answer(r, base)])) }, { ...ctx, owedAdjustments: records });
        expect(full).toMatchObject({ outcome: 'covered', billOutcome: 'omitted', grossCents: 0 });
        expect(full.coveredBy).toHaveLength(3);
        expect(buildServiceCreditRecords(full, recordCtx)).toEqual([]);
        const priceBill = { ...bill, amount: 30 };
        const change = { change: 'price_change', newAmount: 24, firstMonth: '2026-10' };
        const priceBase = computePriceChange(priceBill, change, ctx);
        const reductions = members.map(m => credit('reduce_' + m, m, 6));
        const related = computePriceChange(priceBill, { ...change, existingCredits: Object.fromEntries(reductions.map(r => [r.id, answer(r, priceBase)])) }, { ...ctx, owedAdjustments: reductions });
        expect(related).toMatchObject({ outcome: 'covered', billOutcome: 'kept_at_new_price', grossCents: 0 });
        const unrelated = computePriceChange(priceBill, { ...change, existingCredits: Object.fromEntries(reductions.map(r => [r.id, answer(r, priceBase, 'unrelated')])) }, { ...ctx, owedAdjustments: reductions });
        expect(unrelated.grossCents).toBe(1800);
        expect(deriveNextYearBills([priceBill], { 20: change })[0].amount).toBe(24);
        expect(deriveNextYearBills([bill], { 20: endedRow })).toEqual([]);
    });
    it('8h: two records cannot claim the same remaining share', () => {
        const records = [credit('first', 2, 16), credit('second', 2, 3)];
        const existingCredits = Object.fromEntries(records.map(r => [r.id, answer(r, base)]));
        expect(() => computeEnded(bill, { ...endedRow, existingCredits }, { ...ctx, owedAdjustments: records })).toThrow('remaining');
        existingCredits.second = answer(records[1], base, 'unrelated');
        expect(computeEnded(bill, { ...endedRow, existingCredits }, { ...ctx, owedAdjustments: records }).grossCents).toBe(3200);
    });
    it('clears raw override edits even when the resulting cents and member shares match', () => {
        const record = credit('b', 2, 10);
        const original = computeEnded(bill, { ...endedRow, override: 40.001 }, ctx);
        const changed = computeEnded(bill, { ...endedRow, override: 40.002 }, ctx);
        expect(changed.calc.gross).toBe(original.calc.gross);
        expect(changed.shares).toEqual(original.shares);
        const persisted = buildServiceCreditRecords(original, recordCtx)[0];
        expect(persisted).not.toHaveProperty('enteredOverride');
        expect(persisted.calc).not.toHaveProperty('enteredOverride');
        const row = { ...endedRow, override: 40.001, existingCredits: { b: answer(record, original) } };
        expect(revalidateExistingCreditAnswers(row, [record], original).unanswered).toEqual([]);
        expect(revalidateExistingCreditAnswers(row, [record], changed)).toMatchObject({ existingCredits: {}, unanswered: ['b'] });
        const raw = draftFor([record], { ...row, override: 40.002 });
        const restored = validateDraft(raw, restoreCtx([record]));
        expect(restored.valid).toBe(false);
        expect(restored.draft.bills[20].existingCredits).toEqual({});
        expect(existingCreditCoverage(computeEnded(bill, { ...endedRow, override: 40 }, ctx), 2).override).toBe(40);
    });
    it('8g: clears changed records or complete changed coverage and drops removed answers', () => {
        const record = credit('b', 2, 16);
        const row = { ...endedRow, existingCredits: { b: answer(record, base) } };
        expect(revalidateExistingCreditAnswers(row, [record], base).unanswered).toEqual([]);
        for (const changed of [{ ...record, amount: 12 }, { ...record, incurredDate: '2026-10-01' }, { ...record, reason: 'Changed' }, { ...record, createdAt: 'changed' }, { ...record, memberId: 1 }]) {
            expect(revalidateExistingCreditAnswers(row, [changed], base)).toMatchObject({ existingCredits: {}, unanswered: ['b'] });
        }
        const changedMonth = computeEnded(bill, { lastMonth: '2026-09' }, ctx);
        expect(revalidateExistingCreditAnswers(row, [record], changedMonth).unanswered).toEqual(['b']);
        expect(revalidateExistingCreditAnswers(row, [], base)).toMatchObject({ existingCredits: {}, unanswered: [] });
        const priceA = computePriceChange({ ...bill, amount: 100 }, { newAmount: 80, firstMonth: '2026-07' }, ctx);
        const priceB = computePriceChange({ ...bill, amount: 110 }, { newAmount: 90, firstMonth: '2026-07' }, ctx);
        const priceRow = { existingCredits: { b: answer(record, priceA) } };
        expect(revalidateExistingCreditAnswers(priceRow, [record], priceB).unanswered).toEqual(['b']);
    });
});

describe('record factories and next-year preview', () => {
    it('uses stable ids, keeps member calc and defers True-ups without changing source bills', () => {
        const source = { ...bill, amount: 180 };
        const result = computePriceChange(source, { newAmount: 198, firstMonth: '2026-07' }, ctx);
        const records = buildTrueUpRecords(result, recordCtx);
        expect(records).toEqual(buildTrueUpRecords(result, recordCtx));
        expect(records[0]).toMatchObject({ id: 'oadj_tu_2026_tu_2026_20_1', trueUpId: 'tu_2026_20', status: 'deferred',
            kind: 'usage_charge', incurredDate: '2026-07-01', calc: { share: 36, applied: 0, gross: 108, recorded: 108 } });
        expect(records[0].description).toBe('Northline went from $180 to $198 a month in July. Your share of 6 months: $36.00.');
        const newBill = { rowId: 'new1', billId: 21, name: 'Late', amount: 9.99, frequency: 'monthly', website: '', members, firstMonth: '2026-09' };
        const lateRecords = buildTrueUpRecords(computeLateStart(newBill, ctx), recordCtx);
        expect(lateRecords[0]).toMatchObject({ billId: 21, trueUpId: 'tu_2026_new_21' });
        const next = deriveNextYearBills([source], { 20: { change: 'price_change', newAmount: 198, nextYearAmount: 200 } }, [newBill]);
        expect(next).toEqual([{ ...source, amount: 200 }, { id: 21, name: 'Late', amount: 9.99, billingFrequency: 'monthly', website: '', logo: '', members }]);
        expect(source.amount).toBe(180);
    });
    it('never records prefilled charges again and validates new member charges', () => {
        const row = { rowId: 'charge1', memberId: 2, amount: 30.125, description: ' Activation fee ', incurredDate: '2026-11-03' };
        expect(buildUsageChargeRecord(row, recordCtx)).toMatchObject({ id: 'oadj_uc_2026_charge1', amount: 30.13, description: 'Activation fee', status: 'deferred' });
        expect(buildUsageChargeRecord(row, recordCtx)).not.toHaveProperty('basis');
        expect(() => buildUsageChargeRecord({ ...row, existingAdjustmentId: 'existing' }, recordCtx)).toThrow('reused');
        expect(() => buildUsageChargeRecord({ ...row, incurredDate: '2026-02-30' }, recordCtx)).toThrow('valid incurred');
        expect(() => buildUsageChargeRecord({ ...row, amount: 0 }, recordCtx)).toThrow();
    });
    it('reproduces Okafor and Rosa seed/net annual previews without adding credit detail twice', () => {
        const households = [{ id: 1, name: 'Okafor', linkedMembers: [2, 3] }, { id: 2, linkedMembers: [] }, { id: 3, linkedMembers: [] }, { id: 4, name: 'Rosa', linkedMembers: [] }];
        const sourceBills = [{ ...bill, amount: 88 }, { ...bill, id: 22, amount: 32, members: [4] }];
        const nextBills = [{ ...bill, amount: 88 }, { ...bill, id: 22, amount: 388, billingFrequency: 'annual', members: [4] }];
        const carry = buildCarryForwardSummary(households, [], [
            { id: 'p1', memberId: 1, amount: 26 }, { id: 'p4', memberId: 4, amount: 28 }
        ], [], [12, 12, 12, 5].map((amount, index) => ({ id: 'charge-' + index, memberId: 1,
            kind: 'usage_charge', status: 'deferred', amount })), { fromYearLabel: '2026', nextYearLabel: '2027', itemized: true });
        const preview = buildHouseholdPreview({ familyMembers: households, sourceBills, nextBills, carry });
        expect(preview[0]).toMatchObject({ sourceBillTotal: 1056, nextBillTotal: 1056, carriedTotal: 15, carriedCharges: 41, carriedCredit: -26, firstInvoiceTotal: 1071, remainingCredit: 0 });
        expect(preview[1]).toMatchObject({ nextBillTotal: 388, carriedTotal: -28, firstInvoiceTotal: 360, subscriptionDelta: 4 });
        expect(preview[0].carriedCharges + preview[0].carriedCredit).toBe(preview[0].carriedTotal);
        const unusedCarry = buildCarryForwardSummary(familyMembers, [], [], [], [{ id: 'incoming', memberId: 1,
            kind: 'carry_opening', status: 'carried_in', amount: -132 }],
            { fromYearLabel: '2026', nextYearLabel: '2027', itemized: true, carryUnusedOpeningCredit: true });
        const unused = buildHouseholdPreview({ familyMembers, sourceBills: [], nextBills: [], carry: unusedCarry });
        expect(unused[0]).toMatchObject({ firstInvoiceTotal: 0, remainingCredit: 132 });
        const held = buildHouseholdPreview({ familyMembers, sourceBills: [], nextBills: [],
            carry: { ok: false, households: [], holds: [{ code: 'CARRY_INVARIANT' }] } });
        expect(held[0]).toMatchObject({ ok: false });
        expect(held[0]).not.toHaveProperty('firstInvoiceTotal');
    });
});

describe('source guard, dashboard entry and restored drafts', () => {
    it('fingerprints financial fields independently of keys and volatile metadata', () => {
        const state = { ...year, bills: [bill], familyMembers, payments: [{ id: 'p', memberId: 1, amount: 12 }], owedAdjustments: [credit('a', 1, 3)], billingEvents: [] };
        const reordered = Object.fromEntries(Object.entries(state).reverse());
        reordered.bills = state.bills.map(b => Object.fromEntries(Object.entries(b).reverse()));
        expect(computeSourceFingerprint(reordered)).toBe(computeSourceFingerprint(state));
        expect(computeSourceFingerprint({ ...state, rev: 5, lastWriteId: 'write', updatedAt: 'new', settings: { emailMessage: 'changed' }, owedAdjustments: [{ ...state.owedAdjustments[0], createdAt: 'new' }] })).toBe(computeSourceFingerprint(state));
        expect(computeSourceFingerprint({ ...state, owedAdjustments: [{ ...state.owedAdjustments[0], timestamp: 'changed' }] })).not.toBe(computeSourceFingerprint(state));
        for (const changed of [{ ...state, status: 'closed' }, { ...state, payments: [{ ...state.payments[0], amount: 13 }] }, { ...state, billingEvents: [{}] }, { ...state, bills: [{ ...bill, amount: 13 }] }]) expect(computeSourceFingerprint(changed)).not.toBe(computeSourceFingerprint(state));
    });
    it('hashes service and normalized source snapshots identically and detects normalized member/status edits', () => {
        const source = { ...year, bills: [bill], familyMembers, payments: [{ id: 'p', memberId: 1, amount: 12 }], owedAdjustments: [credit('a', 1, 3)], billingEvents: [] };
        const normalized = normalizeYearData(structuredClone(source), year.id);
        const service = { ...source, activeYear: year };
        delete service.status;
        expect(computeSourceFingerprint(normalized)).toBe(computeSourceFingerprint(source));
        expect(computeSourceFingerprint(normalized)).toBe(computeSourceFingerprint(service));
        expect(computeSourceFingerprint({ ...normalized, year: { ...normalized.year, status: 'closed' } })).not.toBe(computeSourceFingerprint(source));
        expect(computeSourceFingerprint({ ...normalized, members: normalized.members.map(member => member.id === 1 ? { ...member, linkedMembers: [2] } : member) })).not.toBe(computeSourceFingerprint(source));
        expect(computeSourceFingerprint({ ...normalized, members: normalized.members.map(member => member.id === 2 ? { ...member, name: 'Renamed' } : member) })).not.toBe(computeSourceFingerprint(source));
    });
    it('finds recorded successors even with no cached destination and falls back to higher numeric labels', () => {
        const years = [{ id: '2028', label: '2028' }, { id: '2027', label: '2027' }];
        expect(findSuccessorYear(years, year)).toEqual(years[1]);
        for (const eventType of ['YEAR_ROLLED_OVER', 'YEAR_CARRIED_FORWARD']) expect(findSuccessorYear([], year, [{ eventType, payload: { nextYearLabel: 'Special' } }])).toEqual({ id: 'Special', label: 'Special' });
        expect(findSuccessorYear(years, { label: 'Special' })).toBeNull();
        expect(findSuccessorYear([], year)).toBeNull();
    });
    it.each([
        ['open', '2026', '2026-10-31T12:00:00', false], ['settling', '2026', '2026-10-31T12:00:00', false],
        ['open', '2026', '2026-11-01T12:00:00', true], ['settling', '2026', '2027-01-01T12:00:00', true],
        ['closed', '2026', '2026-01-01T12:00:00', true], ['archived', '2026', '2026-12-01T12:00:00', false],
        ['open', 'Special', '2026-12-01T12:00:00', false], ['closed', 'Special', '2026-01-01T12:00:00', true]
    ])('dashboard case %s %s %s => %s', (status, label, today, expected) => {
        expect(shouldOfferYearEndReview({ status, label }, null, new Date(today))).toBe(expected);
        expect(shouldOfferYearEndReview({ status, label }, { id: 'next' }, new Date(today))).toBe(false);
    });
    it('restores inputs and stable ids and recomputes results while requiring a fresh preview', () => {
        const raw = draftFor();
        raw.newBills = [{ rowId: 'n', billId: 21, name: 'Late', amount: 9.99, frequency: 'monthly', website: '', members, firstMonth: '2026-09' }];
        raw.charges = [{ rowId: 'c', memberId: 2, amount: 30, description: 'Activation', incurredDate: '2026-11-03' }];
        const restored = validateDraft(raw, restoreCtx());
        expect(restored).toMatchObject({ valid: true, stale: false, needsPreview: true });
        expect(restored.draft).toEqual(raw);
        expect(restored.results[20].grossCents).toBe(4800);
        expect(canStart(restored.draft, restored)).toMatchObject({ canStart: false, blockers: [{ step: 4 }] });
        expect(canStart(restored.draft, { ...restored, previewCurrent: true })).toEqual({ canStart: true, blockers: [] });
        const stale = validateDraft(raw, restoreCtx([], { sourceYear: { ...year, payments: [{ id: 'p', memberId: 1, amount: 1 }] } }));
        expect(stale.stale).toBe(true);
        expect(stale.draft.sourceFingerprint).toBe(raw.sourceFingerprint);
    });
    it('compares restored drafts with complete explicit live arrays and supports embedded snapshots', () => {
        const arrays = { payments: [{ id: 'p', memberId: 1, amount: 12 }],
            creditAdjustments: [{ id: 'refund', memberId: 1, amount: 2, type: 'refund', status: 'recorded' }],
            billingEvents: [{ id: 'event', eventType: 'PAYMENT_RECORDED' }] };
        const source = { ...year, bills: [bill], familyMembers, owedAdjustments: [], ...arrays };
        const raw = { ...draftFor(), sourceFingerprint: computeSourceFingerprint(source) };
        expect(validateDraft(raw, restoreCtx([], arrays))).toMatchObject({ valid: true, stale: false });
        expect(validateDraft(raw, restoreCtx([], { sourceYear: source }))).toMatchObject({ valid: true, stale: false });
        for (const changed of [
            { payments: [{ ...arrays.payments[0], amount: 13 }] },
            { creditAdjustments: [{ ...arrays.creditAdjustments[0], amount: 3 }] },
            { billingEvents: [...arrays.billingEvents, { id: 'new-event' }] }
        ]) expect(validateDraft(raw, restoreCtx([], { ...arrays, ...changed })).stale).toBe(true);
        expect(validateDraft(raw, restoreCtx([], { sourceYear: source, payments: [] })).stale).toBe(true);
    });
    it('rejects incompatible, malformed or derived storage fields', () => {
        for (const changed of [{ userId: 'other' }, { sourceYearId: '2025' }, { draftVersion: 2 }, { reconciliationId: null }, { confirmations: {} }, { totals: { gross: 999 } }]) {
            expect(validateDraft({ ...draftFor(), ...changed }, restoreCtx()).valid).toBe(false);
        }
        for (const bad of [null, 'price_change', { change: 'ended', lastMonth: 5 }, { change: 'unchanged', override: '5' }, { change: 'price_change', newAmount: '9', firstMonth: '2026-07' }, { change: 'ended', lastMonth: '2026-08', calc: { recorded: 999 } }]) {
            expect(validateDraft({ ...draftFor(), bills: { 20: bad } }, restoreCtx()).valid).toBe(false);
        }
    });
    it('clears stale answers, drops vanished references and reports newly unanswered records on restore', () => {
        const record = credit('b', 2, 16);
        const base = computeEnded(bill, endedRow, ctx);
        const raw = draftFor([record], { ...endedRow, existingCredits: { b: answer(record, base) } });
        expect(validateDraft(raw, restoreCtx([record])).valid).toBe(true);
        const changed = validateDraft(raw, restoreCtx([{ ...record, amount: 12 }]));
        expect(changed.valid).toBe(false);
        expect(changed.draft.bills[20].existingCredits).toEqual({});
        expect(canStart(changed.draft, { ...changed, previewCurrent: true }).canStart).toBe(false);
        const removed = validateDraft(raw, restoreCtx([]));
        expect(removed.valid).toBe(true);
        expect(removed.notices.join(' ')).toContain('removed');
        const replacement = validateDraft(raw, restoreCtx([{ ...record, id: 'replacement', amount: 12 }]));
        expect(replacement.valid).toBe(false);
        expect(replacement.draft.bills[20].existingCredits).toEqual({});
        expect(validateDraft(draftFor(), restoreCtx([record])).valid).toBe(false);
        const vanished = validateDraft({ ...draftFor(), charges: [{ rowId: 'lost', memberId: 999, amount: 3, description: 'x', incurredDate: '2026-11-03' }] }, restoreCtx([], { bills: [] }));
        expect(vanished.draft.bills).toEqual({});
        expect(vanished.draft.charges).toEqual([]);
    });
    it.each([null, undefined, 'weekly'])('rejects restored new subscription frequency %s without defaulting to monthly', frequency => {
        const raw = draftFor();
        const row = { rowId: 'annual', billId: 21, name: 'Annual', amount: 139, website: '', members, firstMonth: '2026-03' };
        if (frequency !== undefined) row.frequency = frequency;
        raw.newBills = [row];
        const restored = validateDraft(raw, restoreCtx());
        expect(restored.valid).toBe(false);
        expect(restored.errors).toContainEqual({ step: 2, rowId: 'annual', message: 'New subscription frequency must be monthly or annual.' });
        expect(restored.results).not.toHaveProperty('new_annual');
    });
    it.each([['monthly', 139000], ['annual', 11583]])('restores a valid %s subscription at its entered frequency', (frequency, grossCents) => {
        const raw = draftFor();
        raw.newBills = [{ rowId: 'new', billId: 21, name: 'New', amount: 139, frequency, website: '', members, firstMonth: '2026-03' }];
        const restored = validateDraft(raw, restoreCtx());
        expect(restored.valid).toBe(true);
        expect(restored.results.new_new.grossCents).toBe(grossCents);
    });
    it('reallocates a colliding new bill id and keeps it stable on subsequent restore', () => {
        const raw = draftFor();
        raw.newBills = [{ rowId: 'n', billId: 20, name: 'Late', amount: 9.99, frequency: 'monthly', website: '', members, firstMonth: '2026-09' }];
        const first = validateDraft(raw, restoreCtx());
        expect(first.valid).toBe(false);
        expect(first.draft.newBills[0].billId).toBe(21);
        const second = validateDraft(first.draft, restoreCtx());
        expect(second.valid).toBe(true);
        expect(second.draft.newBills[0].billId).toBe(21);
        expect(second.draft.reconciliationId).toBe(raw.reconciliationId);
    });
});
