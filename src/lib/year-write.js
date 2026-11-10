// Version-checked year-document writes (#614 / #668, ADR 0009 § 3, spec
// § Versioned year-document writes). Pure helpers: the outcome type, the
// classification of a transaction's read, and the Firestore error classes.
// No Firestore, no DOM, no module-scoped state.

import { fingerprintStoredYear } from './persistence.js';

/**
 * Outcomes of a version-checked write that are not Firestore errors.
 * STALE_DOCUMENT: the stored document is not the one this tab last loaded or saved;
 *   nothing was written.
 * YEAR_EXISTS: a creation found the document already there; nothing was written.
 */
export const YEAR_WRITE_OUTCOMES = Object.freeze({
    STALE_DOCUMENT: 'STALE_DOCUMENT',
    YEAR_EXISTS: 'YEAR_EXISTS'
});

export class YearWriteError extends Error {
    /**
     * @param {string} code  one of YEAR_WRITE_OUTCOMES
     * @param {string} message
     * @param {Object} [details]  { yearId, reason, storedRev, expectedRev }
     */
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'YearWriteError';
        this.code = code;
        this.details = details;
    }
}

/** Firestore error codes after which the commit may or may not have landed. */
const UNCERTAIN_CODES = new Set(['unavailable', 'deadline-exceeded', 'unknown', 'internal', 'cancelled']);

/** Strip a `firestore/` prefix some SDK builds put on error codes. */
function firestoreCode(err) {
    const code = err && typeof err.code === 'string' ? err.code : '';
    return code.startsWith('firestore/') ? code.slice('firestore/'.length) : code;
}

/** True when a write failed in a way that leaves its outcome unknown (a lost response, offline). */
export function isUncertainWriteError(err) {
    return UNCERTAIN_CODES.has(firestoreCode(err));
}

/** True when the rules refused the write (a stale client at stage 2, or any refused write). */
export function isPermissionDeniedError(err) {
    return firestoreCode(err) === 'permission-denied';
}

/** True when the failure puts the year in the read-only Reload required state. */
export function isBlockingWriteError(err) {
    return (err instanceof YearWriteError && err.code === YEAR_WRITE_OUTCOMES.STALE_DOCUMENT) || isPermissionDeniedError(err);
}

/** True when the failure is the client reporting it is offline. */
export function isOfflineWriteError(err) {
    return firestoreCode(err) === 'unavailable';
}

/** A per-attempt write identity, stored in the document as `lastWriteId`. */
export function newWriteId() {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    const hex = n => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

function stale(yearId, reason, extra = {}) {
    return new YearWriteError(YEAR_WRITE_OUTCOMES.STALE_DOCUMENT,
        'Billing year "' + yearId + '" was changed in another tab or device. Nothing was saved; reload to continue.',
        { yearId, reason, ...extra });
}

/**
 * Decide, from a transaction's read of one year document, what the write may do.
 * Pure and repeatable: the SDK may run the transaction callback more than once.
 *
 * `expectedRev`:
 *   - an integer ≥ 1: the stored `rev` must equal it; the write stores `rev + 1`.
 *   - 0: the document must not exist; the write creates it at `rev: 1`.
 *   - undefined: the document was unversioned when loaded; it is versioned (`rev: 1`)
 *     only while it is still unversioned AND matches `fingerprintIfUnversioned`.
 *     With no fingerprint (the service never read this document) only an absent
 *     document may be created; a present one cannot be verified and is stale.
 *
 * `pending` lists the earlier attempts whose outcome was uncertain since the last
 * write this tab saw commit, each as the rev it would have written and its write
 * identity ({ nextRev, writeId }). They are settled here by the stored `rev` and
 * `lastWriteId`, never by a payload fingerprint (server timestamps resolve on the
 * server): a stored document carrying one of them committed (adopt it, unless the
 * attempt is marked `adoptable: false` because it wrote data the tab does not hold,
 * which is stale); a stored
 * document still at the expectation means none committed (retry); anything else is
 * stale.
 *
 * `ifExists` (creation only): 'stale' (default), 'exists' (throw YEAR_EXISTS) or
 * 'skip' (write nothing; the caller loads the existing document).
 *
 * `asRead` (the reviewed rollover's source, #607): the payload is built from this
 * read, never from memory, so the expectation is the rev the transaction read: the
 * write stores the stored `rev + 1` (or `rev: 1` for an unversioned document, whose
 * stored `createdAt` the write keeps). `expectedRev`, the fingerprint and `pending`
 * are not consulted; the caller's own guard (the reviewed fingerprint) decides
 * whether the content may be written. The document must exist.
 *
 * @returns {{ write: boolean, nextRev?: number, storedRev?: number|undefined,
 *   adoptedPending: boolean, existing?: boolean }}
 * @throws {YearWriteError}
 */
export function classifyYearWrite({ yearId, exists, stored, expectedRev, fingerprintIfUnversioned = null, pending = null, ifExists = 'stale', asRead = false }) {
    const hasRev = !!exists && stored != null && Object.prototype.hasOwnProperty.call(stored, 'rev');
    const storedRev = hasRev ? stored.rev : undefined;
    if (hasRev && !(Number.isInteger(storedRev) && storedRev >= 1)) {
        // A malformed stored rev matches no rules branch: fail closed until repaired.
        throw stale(yearId, 'malformed-rev', { storedRev });
    }
    if (asRead) {
        if (!exists) throw stale(yearId, 'missing');
        return { write: true, nextRev: hasRev ? storedRev + 1 : 1, storedRev, adoptedPending: false };
    }
    const unversionedMatches = () => exists && !hasRev && fingerprintIfUnversioned != null
        && fingerprintStoredYear(stored, yearId) === fingerprintIfUnversioned;

    // Settle earlier attempts whose responses were lost.
    let effectiveRev = expectedRev;
    let adoptedPending = false;
    const attempts = Array.isArray(pending) ? pending : (pending ? [pending] : []);
    if (attempts.length) {
        const committed = hasRev && attempts.find(p => storedRev === p.nextRev && stored.lastWriteId === p.writeId);
        if (committed && committed.adoptable === false) {
            // It landed, but it wrote data this tab does not hold (a status change, a
            // rollover): writing over it from memory would undo it. Reload instead.
            throw stale(yearId, 'lost-response-not-in-memory', { storedRev, expectedRev });
        }
        if (committed) {
            adoptedPending = true; // one of them committed: adopt its rev
            effectiveRev = storedRev;
        } else if (expectedRev === 0 ? !exists
            : expectedRev === undefined ? (!exists && fingerprintIfUnversioned == null) || unversionedMatches()
                : hasRev && storedRev === expectedRev) {
            effectiveRev = expectedRev; // none committed: retry with the same expectation
        } else {
            throw stale(yearId, 'lost-response-mismatch', { storedRev, expectedRev });
        }
    }

    if (adoptedPending) {
        if (expectedRev === 0) return { write: false, storedRev, adoptedPending, existing: true };
        return { write: true, nextRev: effectiveRev + 1, storedRev, adoptedPending };
    }
    if (effectiveRev === 0) {
        if (!exists) return { write: true, nextRev: 1, storedRev, adoptedPending };
        if (ifExists === 'skip') return { write: false, storedRev, adoptedPending, existing: true };
        if (ifExists === 'exists') {
            throw new YearWriteError(YEAR_WRITE_OUTCOMES.YEAR_EXISTS, 'Billing year "' + yearId + '" already exists.', { yearId });
        }
        throw stale(yearId, 'created-elsewhere', { storedRev });
    }
    if (effectiveRev === undefined) {
        if (!exists) {
            if (fingerprintIfUnversioned == null) return { write: true, nextRev: 1, storedRev, adoptedPending };
            throw stale(yearId, 'missing');
        }
        if (unversionedMatches()) return { write: true, nextRev: 1, storedRev, adoptedPending };
        throw stale(yearId, hasRev ? 'versioned-elsewhere' : 'changed-unversioned', { storedRev });
    }
    if (!exists) throw stale(yearId, 'missing', { expectedRev: effectiveRev });
    if (hasRev && storedRev === effectiveRev) return { write: true, nextRev: effectiveRev + 1, storedRev, adoptedPending };
    throw stale(yearId, 'rev-mismatch', { storedRev, expectedRev: effectiveRev });
}
