/**
 * Start's commit adapter: the guard at Start, the createYear call and the
 * classification of what came back into the six states Step 4 renders
 * (specs/year-end-review.md § Commit guard and recovery, Outcomes).
 *
 * The outcome contract this adapter reads is #607's (src/lib/rollover-commit.js,
 * PR #685), whose service classifies an existing destination itself:
 *   - A completed rollover never rejects. createYear resolves
 *     `{ outcome: 'completed', yearId }` (committed now, or a lost response read back
 *     as committed) or `{ outcome: 'already_completed', yearId }` (the destination is
 *     this draft's own rollover). The service has already switched years in both.
 *   - Otherwise it rejects with a RolloverError whose `code` is one of COMMIT_CODES:
 *       NEXT_YEAR_EXISTS  nothing written. `resolution` 'diverged' (this draft's
 *                         reconciliationId, another payloadFingerprint) or 'elsewhere';
 *                         `existing` = { reconciliationId, payloadFingerprint,
 *                         createdAt (ISO), summary (the source's YEAR_ROLLED_OVER counts) }.
 *                         No resolution means the destination could not be read back.
 *       STALE_SOURCE      the source changed after the preview; nothing written. The
 *                         service does not reload the tab (unsaved edits); the page
 *                         offers Reload.
 *       COMMIT_FAILED     a definite failure; nothing written. `offline` when the
 *                         transaction never reached the server.
 *       COMMIT_UNCERTAIN  the commit was sent and its response lost. `resolution` is the
 *                         read-back's answer ('not_committed' | 'diverged' | 'elsewhere');
 *                         absent when the read-back itself failed.
 * A service without `reviewedCommitGuard` (anything before #607) is never called.
 * `classifyRaw` keeps unexpected raw errors conservative.
 */
import { findSuccessorYear } from '../../../lib/year-end-review.js';

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

/**
 * Release precondition (ADR 0009 § 3, spec § Commit guard and recovery): the
 * reviewed rollover may run only through createYear's transaction that reads
 * the destination and the source before writing and compares the reviewed
 * fingerprint. #607 marks a service that does so with
 * `reviewedCommitGuard = true`; until then Start stays off and no write is sent.
 */
export function hasCommitGuard(service) {
    return !!service && service.reviewedCommitGuard === true;
}

export const COMMIT_GUARD_MISSING = 'Start is not available in this version yet: it cannot yet check, in the same step as the write, that 2026 is unchanged and that the next year does not exist. Your draft is kept.';

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

/** Errors outside the RolloverError contract: raw Firestore codes and plain Errors. */
function classifyRaw(error) {
    const code = typeof error?.code === 'string' ? error.code.replace(/^firestore\//, '') : null;
    if (code && DEFINITE.has(code)) return { state: 'failed', cause: CAUSES[code] || error.message, retry: true };
    if (code) return { state: 'uncertain', checked: false, cause: CAUSES[code] || error.message };
    // An existing destination nobody classified may be this draft's own rollover: never
    // report it as created elsewhere (or clear the draft) without that evidence.
    if (/already exists/i.test(error?.message || '')) return { state: 'uncertain', checked: false };
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
            // No resolution: the destination exists but could not be read back. It may be this
            // draft's own rollover, so it is checked again rather than called "elsewhere".
            return resolution ? byResolution(resolution, error, ctx) : { state: 'uncertain', checked: false };
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
            return classifyRaw(error);
    }
}

/**
 * Run Start (also Retry and Check again): the successor guard after reloading the
 * years list, then createYear. A later year than the destination (a higher label, or
 * a rollover event naming another year) stops Start before any commit: the service
 * cannot classify it. The destination itself is never short-circuited from the
 * in-memory list: it may be this draft's own rollover, and the service's transaction
 * reads it and classifies it (completed / diverged / elsewhere), never overwriting.
 */
export async function startReviewedYear({ service, sourceYear, sourceEvents, yearId, payload, reopenedAdjustmentIds,
    payloadFingerprint, summary }) {
    const ctx = { yearId, reconciliationId: payload.reconciliationId, payloadFingerprint, summary };
    // Defense in depth behind the disabled Start: never send a reviewed write without the guard.
    if (!hasCommitGuard(service)) return { state: 'failed', cause: COMMIT_GUARD_MISSING, retry: false, guardMissing: true };
    try {
        if (typeof service._loadYearsList === 'function') await service._loadYearsList();
    } catch (error) {
        // Nothing was sent: the guard's own read failed.
        const away = offline() || error?.code === 'unavailable';
        return { state: 'failed', offline: away, cause: away ? OFFLINE : (error?.message || 'Could not check for an existing year.'), retry: true };
    }
    const years = service.getState?.().billingYears || [];
    const successor = findSuccessorYear(years, sourceYear, sourceEvents || []);
    const isDestination = year => String(year.id) === String(yearId) || String(year.label) === String(yearId);
    if (successor && !isDestination(successor)) {
        return { state: 'elsewhere', yearId: successor.label || String(successor.id), successorId: successor.id, createdAt: null };
    }
    try {
        const result = await service.createYear(yearId, { reopenedAdjustmentIds, reconciliation: payload });
        return classifyCommitResult({ result }, ctx);
    } catch (error) {
        return classifyCommitResult({ error }, ctx);
    }
}
