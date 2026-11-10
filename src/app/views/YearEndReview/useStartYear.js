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

export function clearPendingAttempt(userId, sourceYearId) {
    removeStored(pendingAttemptKey(userId, sourceYearId));
}

/**
 * @param {{ canStart: () => boolean, initialOutcome?: Object|null }} options canStart is read
 *   at the moment of every Start, Retry and Check again: recovery never commits inputs the
 *   Start gate rejects. initialOutcome resumes an unresolved attempt after a remount.
 */
export function useStartYear({ service, source, review, reopenedAdjustmentIds, summary, onPin, onSuccess, canStart, initialOutcome = null }) {
    const [phase, setPhase] = useState('idle');
    const [outcome, setOutcome] = useState(initialOutcome);
    const outcomeRef = useRef(initialOutcome);
    outcomeRef.current = outcome;
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
        // Checking an unresolved attempt re-sends exactly that attempt (its year and payload),
        // so the service's read classifies it: rebuilt from a source its own commit may have
        // changed (records appended, charges carried) it would read as "diverged".
        const pending = isUnresolved(prior) ? readPendingAttempt(draft.userId, draft.sourceYearId) : null;
        const yearId = pending?.yearId || (isUnresolved(prior) && prior.yearId) || draft.nextYearLabel.trim();
        // Strict payload, rebuilt from the same draft: a retry sends the same ids and reviewed fingerprint.
        const payload = pending?.payload || buildReconciliationPayload(draft, source);
        const payloadFingerprint = computePayloadFingerprint(payload, yearId);
        onPin(source);
        setOutcome(null);
        setPhase('starting');
        // From here until it is resolved, this attempt may have committed.
        writeStored(pendingAttemptKey(draft.userId, draft.sourceYearId),
            { yearId, reconciliationId: draft.reconciliationId, payload, at: new Date().toISOString() });
        const result = await startReviewedYear({
            service, sourceYear: source.sourceYear, sourceEvents: source.billingEvents, yearId, payload,
            reopenedAdjustmentIds, payloadFingerprint, summary, prior
        });
        if (!isUnresolved(result)) clearPendingAttempt(draft.userId, draft.sourceYearId);
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
