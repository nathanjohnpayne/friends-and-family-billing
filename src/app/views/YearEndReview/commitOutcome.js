/**
 * Start's commit adapter: the guard at Start, the createYear call and the
 * classification of what came back into the six states Step 4 renders
 * (specs/year-end-review.md § Commit guard and recovery, Outcomes).
 *
 * The outcome contract this adapter reads (what #607's commit guard provides):
 *   - createYear resolves on a committed rollover. It may resolve with
 *     `{ outcome: 'completed' | 'already_completed', yearId }`; undefined means completed.
 *   - It rejects with an Error whose `code` is one of COMMIT_CODES:
 *       NEXT_YEAR_EXISTS  the destination exists. Either `resolution`
 *                         ('completed' | 'diverged' | 'elsewhere') or `existing`
 *                         ({ reconciliationId, payloadFingerprint, createdAt?, summary? },
 *                         read from its YEAR_CREATED_FROM_REVIEW event) lets the
 *                         three-way rule decide here.
 *       STALE_SOURCE      the source changed after the preview; nothing written.
 *       COMMIT_FAILED     a definite failure; nothing written. `offline: true` when
 *                         the transaction never reached the server.
 *       COMMIT_UNCERTAIN  the commit may have been sent. `resolution` is the
 *                         read-back's answer ('completed' | 'diverged' | 'elsewhere' |
 *                         'not_committed'); absent when the read-back itself failed.
 * Until #607 lands, today's createYear throws raw Firestore errors and plain
 * validation Errors; `classifyRaw` maps those onto the same states.
 */
import { findSuccessorYear } from '../../../lib/year-end-review.js';
import { isYearLabelDuplicate } from '../../../lib/billing-year.js';

export const COMMIT_CODES = Object.freeze({
    NEXT_YEAR_EXISTS: 'NEXT_YEAR_EXISTS',
    STALE_SOURCE: 'STALE_SOURCE',
    COMMIT_FAILED: 'COMMIT_FAILED',
    COMMIT_UNCERTAIN: 'COMMIT_UNCERTAIN'
});

/** Firestore codes that prove nothing was written (spec: definite failures). */
const DEFINITE = new Set(['aborted', 'failed-precondition', 'permission-denied', 'invalid-argument', 'already-exists', 'not-found', 'unauthenticated', 'out-of-range']);

const CAUSES = {
    'permission-denied': 'The server refused the write.',
    'unauthenticated': 'You are signed out. Sign in again and retry.',
    'aborted': 'The server was busy with another change. Try again.',
    'failed-precondition': 'The server refused the write because the data changed. Try again.',
    'unavailable': 'We could not reach the server—check your connection and try again.'
};

const OFFLINE = 'You’re offline. Nothing was saved; your draft is kept.';

/** The three-way rule (spec § Outcomes): this draft's operation, this draft with other entries, or someone else's year. */
export function resolveExisting(existing, { reconciliationId, payloadFingerprint }) {
    if (!existing || existing.reconciliationId == null || String(existing.reconciliationId) !== String(reconciliationId)) return 'elsewhere';
    return existing.payloadFingerprint === payloadFingerprint ? 'completed' : 'diverged';
}

const COUNT_LABELS = [
    ['trueUpCount', 'True-ups'], ['serviceCreditCount', 'service credits'], ['coveredCount', 'covered bill changes'],
    ['usageChargeCount', 'new member charges'], ['priceChangeCount', 'price changes'], ['endedCount', 'ended bills'], ['newBillCount', 'new subscriptions']
];

/** Plain-count differences between the committed rollover's summary and this draft's. */
export function describeDifferences(theirs, ours) {
    if (!theirs || !ours) return [];
    return COUNT_LABELS.filter(([key]) => (theirs[key] ?? 0) !== (ours[key] ?? 0))
        .map(([key, label]) => `${label}: ${theirs[key] ?? 0} there, ${ours[key] ?? 0} in this draft`);
}

function byResolution(resolution, error, ctx) {
    const yearId = error?.yearId ?? ctx.yearId;
    if (resolution === 'completed') return { state: 'success', yearId, alreadyCompleted: true };
    if (resolution === 'diverged') return { state: 'diverged', yearId, differences: describeDifferences(error?.existing?.summary, ctx.summary) };
    return { state: 'elsewhere', yearId, createdAt: error?.existing?.createdAt ?? null };
}

function offline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Pre-#607 errors: raw Firestore codes and plain validation Errors. */
function classifyRaw(error, ctx) {
    const code = typeof error?.code === 'string' ? error.code.replace(/^firestore\//, '') : null;
    if (code && DEFINITE.has(code)) return { state: 'failed', cause: CAUSES[code] || error.message, retry: true };
    if (code) return { state: 'uncertain', checked: false, cause: CAUSES[code] || error.message };
    if (/already exists/i.test(error?.message || '')) return { state: 'elsewhere', yearId: ctx.yearId, createdAt: null };
    // A plain Error thrown before the write (validation in the rollover builder): nothing was sent.
    return { state: 'failed', cause: error?.message || 'Something went wrong.', retry: true };
}

/**
 * @param {{ result?: any, error?: any }} settled what createYear resolved or rejected with
 * @param {{ yearId: string, reconciliationId: string, payloadFingerprint: string, summary?: Object }} ctx
 * @returns {{ state: 'success'|'failed'|'elsewhere'|'diverged'|'stale'|'uncertain', yearId?: string,
 *   cause?: string, offline?: boolean, retry?: boolean, checked?: boolean, differences?: string[],
 *   alreadyCompleted?: boolean, createdAt?: any }}
 */
export function classifyCommitResult({ result, error } = {}, ctx) {
    if (!error) {
        const yearId = (result && typeof result === 'object' && result.yearId) || ctx.yearId;
        return { state: 'success', yearId, alreadyCompleted: result?.outcome === 'already_completed' };
    }
    const resolution = error.resolution ?? (error.existing ? resolveExisting(error.existing, ctx) : undefined);
    switch (error.code) {
        case COMMIT_CODES.NEXT_YEAR_EXISTS:
            return byResolution(resolution ?? 'elsewhere', error, ctx);
        case COMMIT_CODES.STALE_SOURCE:
            return { state: 'stale' };
        case COMMIT_CODES.COMMIT_FAILED:
            return error.offline
                ? { state: 'failed', offline: true, cause: OFFLINE, retry: true }
                : { state: 'failed', cause: error.cause?.message || error.message || 'Something went wrong.', retry: true };
        case COMMIT_CODES.COMMIT_UNCERTAIN:
            if (resolution === 'not_committed') return { state: 'uncertain', checked: true, retry: true };
            if (resolution) return byResolution(resolution, error, ctx);
            return { state: 'uncertain', checked: false };
        default:
            return classifyRaw(error, ctx);
    }
}

/**
 * Run Start: the successor guard after reloading the years list, then createYear.
 * `recheck` is the uncertain-outcome path: the destination itself may be this
 * draft's own completed commit, so it is not treated as a successor here; the
 * service's precondition read (never an overwrite) classifies it instead.
 */
export async function startReviewedYear({ service, sourceYear, sourceEvents, yearId, payload, reopenedAdjustmentIds,
    payloadFingerprint, summary, recheck = false }) {
    const ctx = { yearId, reconciliationId: payload.reconciliationId, payloadFingerprint, summary };
    try {
        if (typeof service._loadYearsList === 'function') await service._loadYearsList();
    } catch (error) {
        // Nothing was sent: the guard's own read failed.
        const away = offline() || error?.code === 'unavailable';
        return { state: 'failed', offline: away, cause: away ? OFFLINE : (error?.message || 'Could not check for an existing year.'), retry: true };
    }
    const years = service.getState?.().billingYears || [];
    const successor = findSuccessorYear(years, sourceYear, sourceEvents || []);
    if (successor && !(recheck && String(successor.id) === String(yearId))) {
        return { state: 'elsewhere', yearId: successor.label || String(successor.id), successorId: successor.id, createdAt: null };
    }
    if (!recheck && isYearLabelDuplicate(years, yearId)) return { state: 'elsewhere', yearId, successorId: yearId, createdAt: null };
    try {
        const result = await service.createYear(yearId, { reopenedAdjustmentIds, reconciliation: payload });
        return classifyCommitResult({ result }, ctx);
    } catch (error) {
        return classifyCommitResult({ error }, ctx);
    }
}
