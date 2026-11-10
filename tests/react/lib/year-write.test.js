import { describe, it, expect } from 'vitest';
import {
    classifyYearWrite, YearWriteError, YEAR_WRITE_OUTCOMES, newWriteId,
    isUncertainWriteError, isPermissionDeniedError, isBlockingWriteError, isOfflineWriteError
} from '@/lib/year-write.js';
import { fingerprintStoredYear } from '@/lib/persistence.js';

// Classification of a version-checked write from the transaction's read (#668,
// spec § Versioned year-document writes).

const doc = (extra = {}) => ({ label: '2026', status: 'open', familyMembers: [], bills: [], payments: [], billingEvents: [], settings: {}, ...extra });
const classify = args => classifyYearWrite({ yearId: '2026', ...args });
const expectStale = (fn, reason) => {
    try {
        fn();
    } catch (err) {
        expect(err).toBeInstanceOf(YearWriteError);
        expect(err.code).toBe(YEAR_WRITE_OUTCOMES.STALE_DOCUMENT);
        if (reason) expect(err.details.reason).toBe(reason);
        return;
    }
    throw new Error('expected STALE_DOCUMENT');
};

describe('classifyYearWrite', () => {
    it('advances a versioned document by exactly one', () => {
        expect(classify({ exists: true, stored: doc({ rev: 4 }), expectedRev: 4 })).toMatchObject({ write: true, nextRev: 5 });
    });

    it('is stale when the stored rev differs from the expected rev', () => {
        expectStale(() => classify({ exists: true, stored: doc({ rev: 5 }), expectedRev: 4 }), 'rev-mismatch');
        expectStale(() => classify({ exists: true, stored: doc({ rev: 3 }), expectedRev: 4 }), 'rev-mismatch');
        expectStale(() => classify({ exists: false, stored: null, expectedRev: 4 }), 'missing');
    });

    it('fails closed on a malformed stored rev', () => {
        for (const rev of ['1', 1.5, null, 0, -1]) {
            expectStale(() => classify({ exists: true, stored: doc({ rev }), expectedRev: 1 }), 'malformed-rev');
        }
    });

    it('creates an absent document at rev 1 and treats an existing one per ifExists', () => {
        expect(classify({ exists: false, stored: null, expectedRev: 0 })).toMatchObject({ write: true, nextRev: 1 });
        expectStale(() => classify({ exists: true, stored: doc({ rev: 1 }), expectedRev: 0 }), 'created-elsewhere');
        expect(() => classify({ exists: true, stored: doc(), expectedRev: 0, ifExists: 'exists' }))
            .toThrow(expect.objectContaining({ code: YEAR_WRITE_OUTCOMES.YEAR_EXISTS }));
        expect(classify({ exists: true, stored: doc(), expectedRev: 0, ifExists: 'skip' })).toMatchObject({ write: false, existing: true });
    });

    it('versions an unversioned document only when it matches the loaded fingerprint (a missing rev is never zero)', () => {
        const loaded = doc({ payments: [{ id: 'p1', amount: 5 }] });
        const fingerprint = fingerprintStoredYear(loaded, '2026');
        expect(classify({ exists: true, stored: loaded, expectedRev: undefined, fingerprintIfUnversioned: fingerprint }))
            .toMatchObject({ write: true, nextRev: 1 });
        // Server timestamps and version fields never count as a change.
        expect(classify({ exists: true, stored: { ...loaded, updatedAt: 'resolved', createdAt: 'x' }, expectedRev: undefined, fingerprintIfUnversioned: fingerprint }))
            .toMatchObject({ write: true, nextRev: 1 });
        expectStale(() => classify({ exists: true, stored: doc(), expectedRev: undefined, fingerprintIfUnversioned: fingerprint }), 'changed-unversioned');
        expectStale(() => classify({ exists: true, stored: { ...loaded, rev: 1, lastWriteId: 'w' }, expectedRev: undefined, fingerprintIfUnversioned: fingerprint }), 'versioned-elsewhere');
        expectStale(() => classify({ exists: true, stored: loaded, expectedRev: undefined, fingerprintIfUnversioned: null }));
    });

    it('settles a lost response by stored rev and lastWriteId', () => {
        const pending = [{ nextRev: 5, writeId: 'w-mine' }];
        // Committed: adopt, and write on top of it.
        expect(classify({ exists: true, stored: doc({ rev: 5, lastWriteId: 'w-mine' }), expectedRev: 4, pending }))
            .toMatchObject({ write: true, nextRev: 6, adoptedPending: true });
        // Not committed: retry with the same expectation.
        expect(classify({ exists: true, stored: doc({ rev: 4, lastWriteId: 'w-4' }), expectedRev: 4, pending }))
            .toMatchObject({ write: true, nextRev: 5, adoptedPending: false });
        // Anything else: stale.
        expectStale(() => classify({ exists: true, stored: doc({ rev: 5, lastWriteId: 'w-other' }), expectedRev: 4, pending }), 'lost-response-mismatch');
        expectStale(() => classify({ exists: true, stored: doc({ rev: 6, lastWriteId: 'w-mine' }), expectedRev: 4, pending }), 'lost-response-mismatch');
    });

    it('settles a chain of lost responses: a retry that committed after one that did not', () => {
        // A failed before commit (would have written 5); B retried at 4 with a new id and
        // its response was lost too; C must recognize B.
        const pending = [{ nextRev: 5, writeId: 'w-a' }, { nextRev: 5, writeId: 'w-b' }];
        expect(classify({ exists: true, stored: doc({ rev: 5, lastWriteId: 'w-b' }), expectedRev: 4, pending }))
            .toMatchObject({ write: true, nextRev: 6, adoptedPending: true });
        // B adopted A (6) and its own commit was lost: either landing is recognized.
        const chained = [{ nextRev: 5, writeId: 'w-a' }, { nextRev: 6, writeId: 'w-b' }];
        expect(classify({ exists: true, stored: doc({ rev: 6, lastWriteId: 'w-b' }), expectedRev: 4, pending: chained }))
            .toMatchObject({ write: true, nextRev: 7, adoptedPending: true });
        expect(classify({ exists: true, stored: doc({ rev: 5, lastWriteId: 'w-a' }), expectedRev: 4, pending: chained }))
            .toMatchObject({ write: true, nextRev: 6, adoptedPending: true });
    });

    it('settles a lost response to the migration write', () => {
        const loaded = doc();
        const fingerprint = fingerprintStoredYear(loaded, '2026');
        const pending = [{ nextRev: 1, writeId: 'w-mine' }];
        const args = { expectedRev: undefined, fingerprintIfUnversioned: fingerprint, pending };
        expect(classify({ ...args, exists: true, stored: { ...loaded, rev: 1, lastWriteId: 'w-mine' } }))
            .toMatchObject({ write: true, nextRev: 2, adoptedPending: true });
        expectStale(() => classify({ ...args, exists: true, stored: { ...loaded, rev: 1, lastWriteId: 'w-other' } }), 'lost-response-mismatch');
        expect(classify({ ...args, exists: true, stored: loaded })).toMatchObject({ write: true, nextRev: 1, adoptedPending: false });
    });

    it('settles a lost response to a creation', () => {
        const pending = [{ nextRev: 1, writeId: 'w-mine' }];
        expect(classify({ exists: true, stored: doc({ rev: 1, lastWriteId: 'w-mine' }), expectedRev: 0, pending }))
            .toMatchObject({ write: false, existing: true, adoptedPending: true });
        expect(classify({ exists: false, stored: null, expectedRev: 0, pending })).toMatchObject({ write: true, nextRev: 1 });
    });
});

describe('write error classes', () => {
    const coded = code => Object.assign(new Error(code), { code });
    it('classifies Firestore codes', () => {
        for (const code of ['unavailable', 'deadline-exceeded', 'unknown', 'internal', 'cancelled']) {
            expect(isUncertainWriteError(coded(code))).toBe(true);
        }
        expect(isUncertainWriteError(coded('aborted'))).toBe(false);
        expect(isUncertainWriteError(new Error('unavailable'))).toBe(false);
        expect(isPermissionDeniedError(coded('permission-denied'))).toBe(true);
        expect(isPermissionDeniedError(coded('firestore/permission-denied'))).toBe(true);
        expect(isBlockingWriteError(coded('permission-denied'))).toBe(true);
        expect(isBlockingWriteError(new YearWriteError(YEAR_WRITE_OUTCOMES.STALE_DOCUMENT, 'x'))).toBe(true);
        expect(isBlockingWriteError(new YearWriteError(YEAR_WRITE_OUTCOMES.YEAR_EXISTS, 'x'))).toBe(false);
        expect(isOfflineWriteError(coded('unavailable'))).toBe(true);
    });

    it('allocates a distinct write identity per attempt', () => {
        const ids = new Set(Array.from({ length: 50 }, newWriteId));
        expect(ids.size).toBe(50);
    });
});
