/**
 * useStartYear — Start's state machine on the Year-End Review page (#609).
 *
 * phase: 'idle' | 'starting'; outcome: the last classified result (commitOutcome.js)
 * or null. While starting, the page is locked and the view pins the source it
 * reviewed (the service reloads the years list and switches years during the
 * commit; the page must not re-key or re-guard under it). The draft is cleared
 * only on a confirmed success; every other outcome keeps it.
 *
 * An attempt whose outcome is not known yet is recorded on this device beside the
 * draft (`pendingAttemptKey`) from the moment it is sent until it is resolved. A
 * reload, a route re-entry or a tab closed mid-commit therefore resumes on Step 4 in
 * the uncertain state with Check again, never on the entry guard's "started
 * elsewhere" card, and never with a blind retry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { computePayloadFingerprint } from '../../../lib/year-end-review.js';
import { buildReconciliationPayload } from './reconciliationPayload.js';
import { isUnresolved, startReviewedYear } from './commitOutcome.js';
import { draftStorageKey, readStored, removeStored, writeStored } from './yearEndReviewModel.js';

/** Outcomes that leave the next year in place (shown with Open / Discard). */
export const CONFLICT_STATES = ['elsewhere', 'diverged'];

/**
 * Outcomes the page stays pinned for: the conflicts, and an uncertain outcome, whose
 * destination may exist (possibly this draft's own commit). Unpinned, the years list
 * would show it and the entry guard would replace the page, dropping Check again.
 */
export const PINNED_STATES = [...CONFLICT_STATES, 'uncertain'];

export const pendingAttemptKey = (userId, sourceYearId) => `${draftStorageKey(userId, sourceYearId)}.attempt`;

/**
 * The unresolved attempt recorded for this draft, or null. Only an attempt of the
 * draft stored now (same reconciliationId) counts; anything else is stale.
 */
export function readPendingAttempt(userId, sourceYearId) {
    const attempt = readStored(pendingAttemptKey(userId, sourceYearId)).value;
    const draft = readStored(draftStorageKey(userId, sourceYearId)).value;
    if (!attempt || typeof attempt !== 'object' || typeof attempt.yearId !== 'string' || !draft || typeof draft !== 'object') return null;
    if (String(attempt.reconciliationId) !== String(draft.reconciliationId)) return null;
    const payload = attempt.payload && typeof attempt.payload === 'object' && String(attempt.payload.reconciliationId) === String(draft.reconciliationId)
        ? attempt.payload : null;
    return { ...attempt, payload };
}

/** Unconditional removal: an explicit discard forgets the draft and every attempt of it. */
export function clearPendingAttempt(userId, sourceYearId) {
    removeStored(pendingAttemptKey(userId, sourceYearId));
}

/** Removes the marker only while it is still this attempt's: another tab's later attempt is left alone. */
function clearOwnAttempt(userId, sourceYearId, attemptId) {
    const stored = readStored(pendingAttemptKey(userId, sourceYearId)).value;
    if (stored && typeof stored === 'object' && stored.attemptId === attemptId) removeStored(pendingAttemptKey(userId, sourceYearId));
}

/**
 * Fingerprint of the draft's own entries (independent of the source, which the attempt's
 * commit may itself have changed). A marker is this draft's only when it carries this.
 */
export function draftEntriesFingerprint(draft) {
    return computePayloadFingerprint({ reconciliationId: draft.reconciliationId, bills: draft.bills, newBills: draft.newBills,
        charges: draft.charges, confirmations: draft.confirmations }, String(draft.nextYearLabel || '').trim());
}

function newAttemptId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return 'att_' + crypto.randomUUID();
    } catch (_) { /* fall through */ }
    return 'att_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e9).toString(36);
}

/**
 * The attempt a remounted page resumes, from the marker it captured once at mount: its own
 * payload is re-sent only when the marker was written from this very draft (same entries
 * fingerprint); any other marker (another tab's diverged entries) is settled read-only.
 */
export function resumedAttempt(marker, draft) {
    if (!marker) return null;
    const own = !!marker.payload && marker.draftFingerprint === draftEntriesFingerprint(draft);
    return own ? { attemptId: marker.attemptId, yearId: marker.yearId, payload: marker.payload }
        : { attemptId: marker.attemptId, yearId: marker.yearId, readOnly: true };
}

/**
 * @param {{ canStart: () => boolean, initialOutcome?: Object|null, initialAttempt?: Object|null }} options
 *   canStart is read at the moment of every Start, Retry and Check again: recovery never commits
 *   inputs the Start gate rejects. initialOutcome / initialAttempt resume an unresolved attempt
 *   after a remount (resumedAttempt).
 */
export function useStartYear({ service, source, review, reopenedAdjustmentIds, summary, onPin, onSuccess, canStart,
    initialOutcome = null, initialAttempt = null }) {
    const [phase, setPhase] = useState('idle');
    const [outcome, setOutcome] = useState(initialOutcome);
    const outcomeRef = useRef(initialOutcome);
    outcomeRef.current = outcome;
    // The attempt this tab sent (or resumed): tab-local, so another tab rewriting the shared
    // marker can never substitute its payload for this tab's Check again.
    const attemptRef = useRef(initialAttempt);
    const running = useRef(false);
    const mounted = useRef(true);
    // Set in setup as well as cleared in cleanup: StrictMode runs setup, cleanup, setup on mount.
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    // "Don't close this tab": warn while the two documents are being written.
    useEffect(() => {
        if (phase !== 'starting' || typeof window === 'undefined') return undefined;
        const warn = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [phase]);

    const start = useCallback(async () => {
        if (running.current || (canStart && !canStart())) return;
        running.current = true;
        const draft = review.draft;
        const prior = outcomeRef.current;
        // Checking an unresolved attempt re-sends exactly that attempt (its year and payload, from
        // this tab's own record, never from the shared marker), so the service's read classifies
        // it: rebuilt from a source its own commit may have changed (records appended, charges
        // carried) it would read as "diverged". An attempt this tab cannot re-send as its own is
        // settled read-only.
        const pending = isUnresolved(prior) ? attemptRef.current : null;
        const readOnly = !!pending?.readOnly;
        const yearId = pending?.yearId || (isUnresolved(prior) && prior.yearId) || draft.nextYearLabel.trim();
        // Strict payload, rebuilt from the same draft: a retry sends the same ids and reviewed fingerprint.
        const payload = (!readOnly && pending?.payload) || buildReconciliationPayload(draft, source);
        const payloadFingerprint = computePayloadFingerprint(payload, yearId);
        const attemptId = pending?.attemptId || newAttemptId();
        onPin(source);
        setOutcome(null);
        setPhase('starting');
        if (!readOnly) {
            // From here until it is resolved, this attempt may have committed.
            attemptRef.current = { attemptId, yearId, payload };
            writeStored(pendingAttemptKey(draft.userId, draft.sourceYearId), { attemptId, yearId, reconciliationId: draft.reconciliationId,
                payload, draftFingerprint: draftEntriesFingerprint(draft), at: new Date().toISOString() });
        }
        const result = await startReviewedYear({
            service, sourceYear: source.sourceYear, sourceEvents: source.billingEvents, yearId, payload,
            reopenedAdjustmentIds, payloadFingerprint, summary, prior, readOnly
        });
        if (!isUnresolved(result)) {
            attemptRef.current = null;
            clearOwnAttempt(draft.userId, draft.sourceYearId, attemptId);
        }
        if (result.state === 'success') {
            review.actions.clearDraftAfterSuccess();
            try {
                // #607's service has already switched on a completed outcome; this covers any other.
                if (service.getState?.().activeYear?.id !== result.yearId) await service.switchYear(result.yearId);
            } finally {
                onSuccess(result);
            }
            return;
        }
        // STALE_SOURCE: nothing is reloaded here. Reloading in place could drop unsaved edits
        // elsewhere in the app; the page offers Reload instead (the draft survives it).
        running.current = false;
        if (!mounted.current) return;
        setPhase('idle');
        setOutcome(result);
        if (!PINNED_STATES.includes(result.state)) onPin(null);
    }, [service, source, review, reopenedAdjustmentIds, summary, onPin, onSuccess, canStart]);

    const clearOutcome = useCallback(() => setOutcome(null), []);
    return { phase, outcome, start, clearOutcome, locked: phase === 'starting', unresolved: isUnresolved(outcome) };
}
