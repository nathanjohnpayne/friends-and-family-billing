// The reviewed rollover's commit guard and recovery (#607, ADR 0009 § 3,
// specs/year-end-review.md § Commit guard and recovery). Pure helpers: the outcome
// type the Year-End Review page consumes, the classification of a failed commit,
// the three-way completion rule over a read-back, and the deterministic event ids.
// No Firestore, no DOM, no module-scoped state.

/**
 * Outcomes of a reviewed createYear that did not commit a new rollover
 * (spec § Commit guard and recovery, Outcomes). A reviewed createYear that commits,
 * or finds its own rollover already committed, resolves instead:
 * `{ outcome: 'completed' | 'already_completed', yearId }`.
 *
 * NEXT_YEAR_EXISTS  the destination exists; nothing was written. `resolution` is
 *                   'diverged' (this draft's reconciliationId, another payloadFingerprint)
 *                   or 'elsewhere'; `existing` holds what the destination's
 *                   YEAR_CREATED_FROM_REVIEW (and the source's YEAR_ROLLED_OVER) say.
 * STALE_SOURCE      the source changed after the preview (its fingerprint differs
 *                   from the reviewed one); nothing was written.
 * COMMIT_FAILED     a definite failure; nothing was written. `offline` when the
 *                   transaction never reached the server.
 * COMMIT_UNCERTAIN  the commit was sent and its response was lost. `resolution` is the
 *                   read-back's answer ('not_committed', 'diverged' or 'elsewhere'; a
 *                   completed read-back resolves instead), absent when the read-back
 *                   itself failed.
 */
export const ROLLOVER_OUTCOMES = Object.freeze({
    NEXT_YEAR_EXISTS: 'NEXT_YEAR_EXISTS',
    STALE_SOURCE: 'STALE_SOURCE',
    COMMIT_FAILED: 'COMMIT_FAILED',
    COMMIT_UNCERTAIN: 'COMMIT_UNCERTAIN'
});

/** Read-back resolutions (the three-way rule, plus "not committed" after a lost response). */
export const ROLLOVER_RESOLUTIONS = Object.freeze({
    COMPLETED: 'completed',
    DIVERGED: 'diverged',
    ELSEWHERE: 'elsewhere',
    NOT_COMMITTED: 'not_committed'
});

export const OFFLINE_MESSAGE = 'You’re offline. Nothing was saved; your draft is kept.';

export class RolloverError extends Error {
    /**
     * @param {string} code  one of ROLLOVER_OUTCOMES
     * @param {string} message
     * @param {{ yearId?: string, resolution?: string, existing?: Object|null, offline?: boolean,
     *   cause?: any, reviewedFingerprint?: string, currentFingerprint?: string }} [fields]
     */
    constructor(code, message, fields = {}) {
        super(message);
        this.name = 'RolloverError';
        this.code = code;
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined) this[key] = value;
        }
    }
}

/** Strip a `firestore/` prefix some SDK builds put on error codes. */
function firestoreCode(err) {
    const code = err && typeof err.code === 'string' ? err.code : '';
    return code.startsWith('firestore/') ? code.slice('firestore/'.length) : code;
}

/** Firestore codes after which a sent commit may or may not have landed. */
const UNCERTAIN_CODES = new Set(['unavailable', 'deadline-exceeded', 'unknown', 'internal', 'cancelled']);

/**
 * Classify a failed reviewed commit. Before the commit was sent (the transaction
 * failed in its reads or its callback) nothing can have been written: 'failed',
 * offline when the client reported it could not reach the server. After it was sent,
 * an uncertain Firestore code or a non-Firestore error is 'uncertain'; any other
 * Firestore code (aborted after the SDK's retries, failed-precondition,
 * permission-denied, invalid-argument, …) is a definite 'failed'.
 *
 * @param {any} err
 * @param {boolean} commitSent  the transaction callback's last run completed
 * @returns {{ kind: 'failed' | 'uncertain', offline: boolean }}
 */
export function classifyCommitFailure(err, commitSent) {
    const code = firestoreCode(err);
    if (!commitSent) return { kind: 'failed', offline: code === 'unavailable' };
    if (!code || UNCERTAIN_CODES.has(code)) return { kind: 'uncertain', offline: false };
    return { kind: 'failed', offline: false };
}

const events = data => (data && Array.isArray(data.billingEvents) ? data.billingEvents : []);
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * What an existing destination says about the rollover that created it: its
 * YEAR_CREATED_FROM_REVIEW event (reconciliationId, payloadFingerprint, when) and the
 * counts of the source's matching YEAR_ROLLED_OVER. Null when the destination was
 * not created by a review (a legacy rollover, another device's first run).
 */
export function describeExistingRollover(destination, source, yearId) {
    const created = events(destination).find(event => event && event.eventType === 'YEAR_CREATED_FROM_REVIEW');
    if (!created) return null;
    const payload = created.payload || {};
    const rolled = events(source).find(event => event && event.eventType === 'YEAR_ROLLED_OVER'
        && sameId(event.payload && event.payload.toYear, yearId) && sameId(event.payload && event.payload.reconciliationId, payload.reconciliationId));
    let summary = null;
    if (rolled) {
        const { toYear: _to, reconciliationId: _id, payloadFingerprint: _fp, ...counts } = rolled.payload;
        summary = counts;
    }
    return {
        reconciliationId: payload.reconciliationId ?? null,
        payloadFingerprint: payload.payloadFingerprint ?? null,
        createdAt: created.timestamp ?? null,
        summary
    };
}

/**
 * The three-way rule (spec § Outcomes) over a read of the destination and the source:
 * the destination's YEAR_CREATED_FROM_REVIEW with this draft's reconciliationId and
 * this attempt's payloadFingerprint is this operation, completed; the same id with
 * another fingerprint is this draft committed on another tab with different entries;
 * anything else (no event, another id) was created elsewhere. An absent destination
 * means a rollover did not commit (the transaction writes both documents or neither).
 *
 * @param {{ destination: Object|null, source: Object|null, yearId: string,
 *   reconciliationId: string, payloadFingerprint: string }} input
 * @returns {{ resolution: string, existing: Object|null }}
 */
export function classifyRolloverCompletion({ destination, source, yearId, reconciliationId, payloadFingerprint }) {
    if (!destination) return { resolution: ROLLOVER_RESOLUTIONS.NOT_COMMITTED, existing: null };
    const existing = describeExistingRollover(destination, source, yearId);
    if (!existing || !sameId(existing.reconciliationId, reconciliationId)) return { resolution: ROLLOVER_RESOLUTIONS.ELSEWHERE, existing };
    return {
        resolution: existing.payloadFingerprint === payloadFingerprint ? ROLLOVER_RESOLUTIONS.COMPLETED : ROLLOVER_RESOLUTIONS.DIVERGED,
        existing
    };
}

/**
 * Event ids for one reviewed rollover, derived from its reconciliationId so that every
 * run of the transaction callback (the SDK may replay it) and every retry of the same
 * logical rollover writes the same ids, and none is allocated inside the callback.
 * Call once per callback run.
 */
export function rolloverEventIds(reconciliationId) {
    let next = 0;
    return () => {
        next += 1;
        return 'evt_yer_' + String(reconciliationId) + '_' + next;
    };
}
