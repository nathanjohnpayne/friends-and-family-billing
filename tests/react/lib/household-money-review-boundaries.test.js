// Active exact-edge conformance for every named Year-End Review quantizer consumer.
import { describe, it, expect } from 'vitest';
import { toExactCents, snapshotExactCredit, projectHouseholdPreviewMoney } from '../../../src/lib/household-money.js';
import { toCents, splitCents, snapshotExistingCredit, computePriceChange, computeEnded,
    computeLateStart, buildUsageChargeRecord, buildHouseholdPreview, validateDraft,
    computeSourceFingerprint } from '../../../src/lib/year-end-review.js';
import { calculateAnnualSummary } from '../../../src/lib/calculations.js';

const below = 0.0049999999999999;
const familyMembers = [{ id: 1, linkedMembers: [] }, { id: 2, linkedMembers: [] }];
const sourceYear = { id: '2026', label: '2026', status: 'closed' };
const bill = { id: 'bill', amount: 1, members: [1], billingFrequency: 'monthly' };
const recordCtx = { sourceYearId: '2026', reconciliationId: 'r', now: '2026-11-06T12:00:00.000Z' };
const charge = { rowId: 'c', memberId: 1, amount: below, description: 'Recorded charge', incurredDate: '2026-11-01' };

describe('Year-End Review exact money edges', () => {
    it('toCents and snapshots expose the epsilon boundary while preserving all binding fields', () => {
        expect(toCents(below)).toBe(0);
        expect(toExactCents(below)).toBe(0);
        expect(toExactCents(-below)).toBe(0);
        expect(Object.is(toExactCents(-0), -0)).toBe(false);
        const record = { memberId: 1, amount: below, reason: 'same', status: 'active', createdAt: 'fixed' };
        expect(snapshotExactCredit(record)).toEqual({ ...snapshotExistingCredit(record), amountCents: 0 });
        expect(record.amount).toBe(below);
    });

    it('compute override consumers retain exact formulas and stored splitCents at the exact edge', () => {
        for (const compute of [
            () => computePriceChange(bill, { newAmount: 2, firstMonth: '2026-12', override: below }, { sourceYear }),
            () => computeEnded(bill, { lastMonth: '2026-11', override: below }, { sourceYear }),
            () => computeLateStart({ ...bill, firstMonth: '2026-12', override: below }, { sourceYear })
        ]) expect(compute).toThrow();
        const exactFormula = computePriceChange({ ...bill, amount: 139, billingFrequency: 'annual', members: [1, 2, 3] },
            { newAmount: 159.01, firstMonth: '2026-07' }, { sourceYear });
        expect(exactFormula.grossCents).toBe(1001);
        expect(splitCents(1, [1, 2, 3]).map(row => row.cents)).toEqual([0, 0, 1]);
    });

    it('compute existing-credit matching stays per record and uses the replacement cent edge', () => {
        const record = { id: 'sc', memberId: 1, billId: 'bill', kind: 'service_credit', status: 'active', amount: below };
        const result = computeEnded(bill, { lastMonth: '2026-11', existingCredits: { sc: { choice: 'covers' } } },
            { sourceYear, owedAdjustments: [record] });
        expect(result.coveredBy).toEqual([]);
        expect(snapshotExactCredit(record).amountCents).toBe(0);
        expect(result.shares[0].netCents).toBe(100);
        expect(record.amount).toBe(below);
    });

    it('buildUsageChargeRecord and validateDraft reject zero-cent charges consistently in draft validation', () => {
        expect(() => buildUsageChargeRecord(charge, recordCtx)).toThrow();
        expect(toExactCents(charge.amount)).toBe(0);
        const source = { ...sourceYear, bills: [bill], familyMembers, owedAdjustments: [] };
        const raw = { draftVersion: 1, reconciliationId: 'r', userId: 'u', sourceYearId: '2026', sourceLabel: '2026',
            nextYearLabel: '2027', sourceFingerprint: computeSourceFingerprint(source), savedAt: recordCtx.now,
            bills: {}, newBills: [], charges: [charge],
            confirmations: { noBillChanges: true, noNewSubscriptions: true, noExtraCharges: false } };
        const result = validateDraft(raw, { userId: 'u', sourceYear, bills: [bill], familyMembers, owedAdjustments: [] });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('buildHouseholdPreview exact edge reconstructs source G instead of a rounded or binary summary', () => {
        const sourceBills = [{ ...bill, amount: 100, billingFrequency: 'annual', members: [1, 2, 3] }];
        const members = [{ id: 1, linkedMembers: [2] }, { id: 2, linkedMembers: [] }, { id: 3, linkedMembers: [] }];
        const source = { familyMembers: members, bills: sourceBills };
        const legacy = buildHouseholdPreview({ familyMembers: members, sourceBills, nextBills: sourceBills });
        const projected = projectHouseholdPreviewMoney(source, members[0], sourceBills);
        expect(legacy[0].sourceBillTotal).toBe(66.67);
        expect(projected.sourceBillTotalCents).toBe(6667);
        const audit = calculateAnnualSummary(members, sourceBills);
        expect(audit[1].bills[0].annualShare.toFixed(2)).toBe('33.33');
        expect(audit[2].bills[0].annualShare.toFixed(2)).toBe('33.33');
        expect(sourceBills[0].amount).toBe(100);
        const boundary = [{ ...bill, amount: 0.0099999999999998, billingFrequency: 'annual', members: [1, 2] }];
        const old = buildHouseholdPreview({ familyMembers, sourceBills: boundary, nextBills: boundary });
        const edge = projectHouseholdPreviewMoney({ familyMembers, bills: boundary }, familyMembers[0], boundary);
        expect(old[0].sourceBillTotal).toBe(0);
        expect(edge.sourceBillTotalCents).toBe(0);
    });
});
