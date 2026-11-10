import { describe, it, expect } from 'vitest';
import {
    classifyCommitFailure, classifyRolloverCompletion, describeExistingRollover, rolloverEventIds,
    RolloverError, ROLLOVER_OUTCOMES, ROLLOVER_RESOLUTIONS
} from '@/lib/rollover-commit.js';

const err = code => Object.assign(new Error(code), { code });

describe('classifyCommitFailure (spec § Outcomes, § Offline)', () => {
    it('is a definite failure whenever the commit was never sent, offline only for unavailable', () => {
        expect(classifyCommitFailure(err('unavailable'), false)).toEqual({ kind: 'failed', offline: true });
        expect(classifyCommitFailure(err('firestore/unavailable'), false)).toEqual({ kind: 'failed', offline: true });
        for (const code of ['deadline-exceeded', 'unknown', 'internal', 'cancelled', 'aborted', 'permission-denied']) {
            expect(classifyCommitFailure(err(code), false)).toEqual({ kind: 'failed', offline: false });
        }
        expect(classifyCommitFailure(new Error('validation'), false)).toEqual({ kind: 'failed', offline: false });
    });

    it('is uncertain after the commit was sent for uncertain codes and non-Firestore errors, definite otherwise', () => {
        for (const code of ['unavailable', 'deadline-exceeded', 'unknown', 'internal', 'cancelled', 'firestore/internal']) {
            expect(classifyCommitFailure(err(code), true)).toEqual({ kind: 'uncertain', offline: false });
        }
        expect(classifyCommitFailure(new TypeError('socket closed'), true)).toEqual({ kind: 'uncertain', offline: false });
        for (const code of ['aborted', 'failed-precondition', 'permission-denied', 'invalid-argument']) {
            expect(classifyCommitFailure(err(code), true)).toEqual({ kind: 'failed', offline: false });
        }
    });
});

describe('classifyRolloverCompletion (the three-way rule)', () => {
    const created = (reconciliationId, payloadFingerprint) => ({ billingEvents: [{ id: 'e1', eventType: 'YEAR_CREATED_FROM_REVIEW',
        timestamp: '2026-11-20T10:00:00.000Z', payload: { fromYear: '2026', reconciliationId, payloadFingerprint, householdCount: 5, carriedTotal: 108 } }] });
    const source = { billingEvents: [
        { eventType: 'YEAR_ROLLED_OVER', payload: { toYear: '2028', reconciliationId: 'rec-a', payloadFingerprint: 'old', trueUpCount: 9 } },
        { eventType: 'YEAR_ROLLED_OVER', payload: { toYear: '2027', reconciliationId: 'rec-a', payloadFingerprint: 'fp-a', trueUpCount: 1, newBillCount: 2 } }
    ] };
    const ours = { yearId: '2027', reconciliationId: 'rec-a', payloadFingerprint: 'fp-a' };

    it('same id and fingerprint is completed; same id, other fingerprint is diverged; anything else is elsewhere', () => {
        expect(classifyRolloverCompletion({ ...ours, destination: created('rec-a', 'fp-a'), source }).resolution).toBe(ROLLOVER_RESOLUTIONS.COMPLETED);
        expect(classifyRolloverCompletion({ ...ours, destination: created('rec-a', 'fp-b'), source }).resolution).toBe(ROLLOVER_RESOLUTIONS.DIVERGED);
        expect(classifyRolloverCompletion({ ...ours, destination: created('rec-b', 'fp-a'), source }).resolution).toBe(ROLLOVER_RESOLUTIONS.ELSEWHERE);
        expect(classifyRolloverCompletion({ ...ours, destination: { billingEvents: [] }, source })).toEqual({ resolution: ROLLOVER_RESOLUTIONS.ELSEWHERE, existing: null });
        expect(classifyRolloverCompletion({ ...ours, destination: {}, source: null }).resolution).toBe(ROLLOVER_RESOLUTIONS.ELSEWHERE);
    });

    it('an absent destination is not committed (both documents are written or neither)', () => {
        expect(classifyRolloverCompletion({ ...ours, destination: null, source })).toEqual({ resolution: ROLLOVER_RESOLUTIONS.NOT_COMMITTED, existing: null });
    });

    it('describes the existing rollover from its events, with the counts of the matching YEAR_ROLLED_OVER', () => {
        expect(describeExistingRollover(created('rec-a', 'fp-b'), source, '2027')).toEqual({ reconciliationId: 'rec-a', payloadFingerprint: 'fp-b',
            createdAt: '2026-11-20T10:00:00.000Z', summary: { trueUpCount: 1, newBillCount: 2 } });
        expect(describeExistingRollover(created('rec-a', 'fp-b'), null, '2027').summary).toBeNull();
    });
});

describe('rolloverEventIds', () => {
    it('derives the same id sequence from the reconciliation id on every run', () => {
        const run = () => { const next = rolloverEventIds('rec-a'); return [next(), next(), next()]; };
        expect(run()).toEqual(['evt_yer_rec-a_1', 'evt_yer_rec-a_2', 'evt_yer_rec-a_3']);
        expect(run()).toEqual(run());
    });
});

describe('RolloverError', () => {
    it('carries the code and the outcome fields the page reads, omitting undefined ones', () => {
        const error = new RolloverError(ROLLOVER_OUTCOMES.NEXT_YEAR_EXISTS, 'exists', { yearId: '2027', resolution: 'diverged', existing: null, offline: undefined });
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ name: 'RolloverError', code: 'NEXT_YEAR_EXISTS', yearId: '2027', resolution: 'diverged', existing: null });
        expect('offline' in error).toBe(false);
    });
});
