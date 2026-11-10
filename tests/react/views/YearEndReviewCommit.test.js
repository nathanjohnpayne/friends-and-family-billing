import { describe, it, expect, vi } from 'vitest';

// The Year-End Review's draft → reconciliation mapping (#608 draft → #606 payload) and
// Start's commit adapter (#609). The #607 outcome codes are exercised here through
// mocks only; today's createYear cannot produce them.

import { buildReconciliationPayload } from '@/app/views/YearEndReview/reconciliationPayload.js';
import { COMMIT_CODES, classifyCommitResult, describeDifferences, resolveExisting, startReviewedYear } from '@/app/views/YearEndReview/commitOutcome.js';
import { previewRollover } from '@/app/views/YearEndReview/reviewPreview.js';
import { createDraft, deriveReview, fingerprintOf } from '@/app/views/YearEndReview/yearEndReviewModel.js';
import { buildReviewedRollover } from '@/lib/billing-year.js';
import { computePayloadFingerprint } from '@/lib/year-end-review.js';
import { BILL, MEMBER, NEW_BILL, wireframeEntries, wireframeReviewState } from '../helpers/yearEndReviewFixture.js';

function sourceOf(state) {
    return { sourceYear: state.activeYear, bills: state.bills, familyMembers: state.familyMembers, owedAdjustments: state.owedAdjustments,
        payments: state.payments, creditAdjustments: state.creditAdjustments, billingEvents: state.billingEvents };
}

function wireframeDraft(patch = {}) {
    const state = wireframeReviewState();
    const source = sourceOf(state);
    const draft = { ...createDraft({ userId: 'u', sourceYear: state.activeYear, nextYearLabel: '2027', sourceFingerprint: fingerprintOf(source) }),
        reconciliationId: 'rec_fixed', ...wireframeEntries(), ...patch };
    return { state, source, draft };
}

const codeError = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
const ctx = { yearId: '2027', reconciliationId: 'rec_fixed', payloadFingerprint: 'yrp1_mine', summary: { trueUpCount: 3, newBillCount: 1 } };

describe('buildReconciliationPayload — the one draft → payload mapping', () => {
    it('splits price changes by direction, lists an ended bill twice, maps next-year prices and reuses deferred charges by id', () => {
        const { source, draft } = wireframeDraft();
        const payload = buildReconciliationPayload(draft, source);
        expect(payload).toEqual({
            reconciliationId: 'rec_fixed', sourceYearId: '2026', sourceFingerprint: draft.sourceFingerprint,
            trueUps: [{ billId: BILL.nl, newAmount: 198, firstMonth: '2026-07' }, { billId: BILL.hc, newAmount: 144, firstMonth: '2026-03' }],
            serviceCredits: [{ billId: BILL.pv, basis: 'ended', lastMonth: '2026-08' }],
            usageCharges: [{ existingAdjustmentId: 'oadj_maja_fee' }, { existingAdjustmentId: 'oadj_dede_roam' }, { existingAdjustmentId: 'oadj_kenji_calls' }],
            billOverrides: { [BILL.cs]: 26 }, endedBillIds: [BILL.pv],
            newBills: [{ rowId: 'row_lumen', billId: NEW_BILL, name: 'Lumen Fiber Backup', amount: 9.99, frequency: 'monthly',
                website: 'https://lumen.example', members: [MEMBER.kenji, MEMBER.dede, MEMBER.sam], firstMonth: '2026-09' }],
            confirmations: { noBillChanges: false, noNewSubscriptions: false, noExtraCharges: false }
        });
        // The draft's label is createYear's yearId, never part of the payload.
        expect(payload).not.toHaveProperty('nextYearLabel');
    });

    it('a price decrease is a Service Credit carrying its existing-credit answers; an ended bill never sends a next-year price', () => {
        const answers = { oadj_x: { choice: 'unrelated', seen: { memberId: 1 }, coverage: { basis: 'price_change' } } };
        const { source, draft } = wireframeDraft({ bills: {
            [BILL.mm]: { change: 'price_change', newAmount: 12, firstMonth: '2026-10', override: null, nextYearAmount: 12, existingCredits: answers },
            [BILL.pv]: { change: 'ended', lastMonth: '2026-08', nextYearAmount: 70, override: 18 },
            [BILL.nl]: { change: 'price_change', newAmount: 198, firstMonth: '2026-07', existingCredits: answers }
        } });
        const payload = buildReconciliationPayload(draft, source);
        expect(payload.trueUps).toEqual([{ billId: BILL.nl, newAmount: 198, firstMonth: '2026-07' }]);
        expect(payload.serviceCredits).toEqual([
            { billId: BILL.mm, basis: 'price_change', newAmount: 12, firstMonth: '2026-10', existingCredits: answers },
            { billId: BILL.pv, basis: 'ended', lastMonth: '2026-08', override: 18 }
        ]);
        expect(payload.billOverrides).toEqual({ [BILL.mm]: 12 });
        expect(payload.endedBillIds).toEqual([BILL.pv]);
    });

    it('trims new rows and drops empty optional fields', () => {
        const { source, draft } = wireframeDraft({
            newBills: [{ rowId: 'r', billId: NEW_BILL, name: '  Lumen  ', amount: 9.99, frequency: 'monthly', members: [MEMBER.sam], firstMonth: '2026-09', override: null }],
            charges: [{ rowId: 'c', memberId: MEMBER.zara, amount: 6, description: ' Paper statement fee ', incurredDate: '2026-11-28' }]
        });
        const payload = buildReconciliationPayload(draft, source);
        expect(payload.newBills[0]).toEqual({ rowId: 'r', billId: NEW_BILL, name: 'Lumen', amount: 9.99, frequency: 'monthly', website: '', members: [MEMBER.sam], firstMonth: '2026-09' });
        expect(payload.usageCharges.at(-1)).toEqual({ rowId: 'c', memberId: MEMBER.zara, amount: 6, description: 'Paper statement fee', incurredDate: '2026-11-28' });
    });

    it('lenient (preview only) leaves out rows with errors; strict keeps them for the builder to refuse', () => {
        const { state, source, draft } = wireframeDraft({ bills: { [BILL.nl]: { change: 'price_change', newAmount: 198 } } });
        const derived = deriveReview({ draft, sourceYear: state.activeYear, bills: state.bills, familyMembers: state.familyMembers, owedAdjustments: state.owedAdjustments, flags: {} });
        expect(buildReconciliationPayload(draft, source, { derived, lenient: true }).trueUps).toEqual([]);
        expect(buildReconciliationPayload(draft, source).trueUps).toEqual([{ billId: BILL.nl, newAmount: 198, firstMonth: undefined }]);
    });

    it('is accepted by buildReviewedRollover and fingerprints identically on a rebuild (a retry sends the same operation)', () => {
        const { state, source, draft } = wireframeDraft();
        const payload = buildReconciliationPayload(draft, source);
        let sequence = 0;
        const prepared = buildReviewedRollover({ activeYear: state.activeYear, familyMembers: state.familyMembers, bills: state.bills, payments: state.payments,
            creditAdjustments: state.creditAdjustments, owedAdjustments: state.owedAdjustments, billingEvents: [] }, '2027', payload,
        { now: '2026-12-08T00:00:00.000Z', eventId: () => 'e' + (sequence += 1) });
        expect(prepared.summary).toMatchObject({ trueUpCount: 3, serviceCreditCount: 1, priceChangeCount: 2, endedCount: 1, newBillCount: 1, usageChargeCount: 0 });
        expect(prepared.payloadFingerprint).toBe(computePayloadFingerprint(buildReconciliationPayload(structuredClone(draft), source), '2027'));
    });
});

describe('previewRollover — the Step 4 dry run', () => {
    it('reproduces the wireframe totals and never throws on a builder refusal', () => {
        const { state, source, draft } = wireframeDraft();
        const derived = deriveReview({ draft, sourceYear: state.activeYear, bills: state.bills, familyMembers: state.familyMembers, owedAdjustments: state.owedAdjustments, flags: {} });
        const preview = previewRollover({ source, draft, derived, yearId: '2027', reopenedAdjustmentIds: new Set(), now: '2026-12-08T00:00:00.000Z' });
        expect(preview.ok).toBe(true);
        expect(preview.totals).toEqual({ households: 5, sourceBillTotal: 2844, nextBillTotal: 3167.88, subscriptionDelta: 323.88, carriedTotal: 170.46, firstInvoiceTotal: 3338.34 });
        const archived = previewRollover({ source: { ...source, sourceYear: { ...source.sourceYear, status: 'archived' } }, draft, derived, yearId: '2027', reopenedAdjustmentIds: new Set(), now: 'x' });
        expect(archived).toMatchObject({ ok: false, error: expect.stringMatching(/archived/) });
    });
});

describe('classifyCommitResult — the outcome contract', () => {
    it('applies the three-way rule to an existing destination', () => {
        expect(resolveExisting({ reconciliationId: 'rec_fixed', payloadFingerprint: 'yrp1_mine' }, ctx)).toBe('completed');
        expect(resolveExisting({ reconciliationId: 'rec_fixed', payloadFingerprint: 'yrp1_other' }, ctx)).toBe('diverged');
        expect(resolveExisting({ reconciliationId: 'rec_other', payloadFingerprint: 'yrp1_mine' }, ctx)).toBe('elsewhere');
        expect(resolveExisting(null, ctx)).toBe('elsewhere');
    });

    it.each([
        [{ result: undefined }, { state: 'success', yearId: '2027', alreadyCompleted: false }],
        [{ result: { outcome: 'already_completed', yearId: '2027' } }, { state: 'success', alreadyCompleted: true }],
        [{ error: codeError(COMMIT_CODES.NEXT_YEAR_EXISTS) }, { state: 'elsewhere', yearId: '2027' }],
        [{ error: codeError(COMMIT_CODES.NEXT_YEAR_EXISTS, { existing: { reconciliationId: 'rec_fixed', payloadFingerprint: 'yrp1_mine' } }) }, { state: 'success', alreadyCompleted: true }],
        [{ error: codeError(COMMIT_CODES.NEXT_YEAR_EXISTS, { resolution: 'diverged' }) }, { state: 'diverged' }],
        [{ error: codeError(COMMIT_CODES.STALE_SOURCE) }, { state: 'stale' }],
        [{ error: codeError(COMMIT_CODES.COMMIT_FAILED) }, { state: 'failed', retry: true }],
        [{ error: codeError(COMMIT_CODES.COMMIT_FAILED, { offline: true }) }, { state: 'failed', offline: true, cause: 'You’re offline. Nothing was saved; your draft is kept.' }],
        [{ error: codeError(COMMIT_CODES.COMMIT_UNCERTAIN) }, { state: 'uncertain', checked: false }],
        [{ error: codeError(COMMIT_CODES.COMMIT_UNCERTAIN, { resolution: 'not_committed' }) }, { state: 'uncertain', checked: true, retry: true }],
        [{ error: codeError(COMMIT_CODES.COMMIT_UNCERTAIN, { resolution: 'completed' }) }, { state: 'success', alreadyCompleted: true }],
        [{ error: codeError(COMMIT_CODES.COMMIT_UNCERTAIN, { resolution: 'elsewhere' }) }, { state: 'elsewhere' }],
        // Pre-#607 raw errors.
        [{ error: codeError('permission-denied') }, { state: 'failed', cause: 'The server refused the write.' }],
        [{ error: codeError('unavailable') }, { state: 'uncertain', checked: false }],
        [{ error: codeError('deadline-exceeded') }, { state: 'uncertain', checked: false }],
        [{ error: new Error('Billing year "2027" already exists.') }, { state: 'elsewhere' }],
        [{ error: new Error('Bill 9 is not in the 2026 billing year.') }, { state: 'failed', cause: 'Bill 9 is not in the 2026 billing year.' }]
    ])('%o → %o', (settled, expected) => {
        expect(classifyCommitResult(settled, ctx)).toMatchObject(expected);
    });

    it('names what differs between a diverged commit and this draft in plain counts', () => {
        expect(describeDifferences({ trueUpCount: 2, newBillCount: 1 }, { trueUpCount: 3, newBillCount: 1 })).toEqual(['True-ups: 2 there, 3 in this draft']);
    });
});

describe('startReviewedYear — the guard at Start', () => {
    const sourceYear = { id: '2026', label: '2026', status: 'settling' };
    const base = { sourceYear, sourceEvents: [], yearId: '2027', payload: { reconciliationId: 'rec_fixed' }, reopenedAdjustmentIds: new Set(), payloadFingerprint: 'yrp1_mine' };
    const service = (years, createYear = vi.fn(async () => {})) => {
        const state = { billingYears: [sourceYear] };
        return { state, getState: () => state, createYear, _loadYearsList: vi.fn(async () => { state.billingYears = years; }) };
    };

    it('reloads the years list first and never commits over a successor found there', async () => {
        const svc = service([sourceYear, { id: '2027', label: '2027', status: 'open' }]);
        await expect(startReviewedYear({ ...base, service: svc })).resolves.toMatchObject({ state: 'elsewhere', yearId: '2027' });
        expect(svc._loadYearsList).toHaveBeenCalled();
        expect(svc.createYear).not.toHaveBeenCalled();
    });

    it('a successor by higher label blocks a different destination label too', async () => {
        const svc = service([sourceYear, { id: '2028', label: '2028', status: 'open' }]);
        await expect(startReviewedYear({ ...base, service: svc })).resolves.toMatchObject({ state: 'elsewhere', yearId: '2028' });
        expect(svc.createYear).not.toHaveBeenCalled();
    });

    it('the uncertain re-check lets the destination itself through to the service’s precondition read', async () => {
        const createYear = vi.fn(async () => { throw codeError(COMMIT_CODES.NEXT_YEAR_EXISTS, { existing: { reconciliationId: 'rec_fixed', payloadFingerprint: 'yrp1_mine' } }); });
        const svc = service([sourceYear, { id: '2027', label: '2027', status: 'open' }], createYear);
        await expect(startReviewedYear({ ...base, service: svc, recheck: true })).resolves.toMatchObject({ state: 'success', alreadyCompleted: true });
        expect(createYear).toHaveBeenCalledWith('2027', { reopenedAdjustmentIds: base.reopenedAdjustmentIds, reconciliation: base.payload });
    });

    it('a failed guard read is a definite failure (nothing was sent)', async () => {
        const svc = service([sourceYear]);
        svc._loadYearsList.mockRejectedValue(codeError('unavailable'));
        await expect(startReviewedYear({ ...base, service: svc })).resolves.toMatchObject({ state: 'failed', offline: true, retry: true });
        expect(svc.createYear).not.toHaveBeenCalled();
    });
});
