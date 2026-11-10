/**
 * useStartYear — Start's state machine on the Year-End Review page (#609).
 *
 * phase: 'idle' | 'starting'; outcome: the last classified result (commitOutcome.js)
 * or null. While starting, the page is locked and the view pins the source it
 * reviewed (the service reloads the years list and switches years during the
 * commit; the page must not re-key or re-guard under it). The draft is cleared
 * only on a confirmed success; every other outcome keeps it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { computePayloadFingerprint } from '../../../lib/year-end-review.js';
import { buildReconciliationPayload } from './reconciliationPayload.js';
import { startReviewedYear } from './commitOutcome.js';

/** Outcomes that leave the next year in place (shown with Open / Discard). */
export const CONFLICT_STATES = ['elsewhere', 'diverged'];

/**
 * Outcomes the page stays pinned for: the conflicts, and an uncertain outcome, whose
 * destination may exist (possibly this draft's own commit). Unpinned, the years list
 * would show it and the entry guard would replace the page, dropping Check again.
 */
export const PINNED_STATES = [...CONFLICT_STATES, 'uncertain'];

/**
 * @param {{ canStart: () => boolean }} options canStart is read at the moment of every
 *   Start, Retry and Check again: recovery never commits inputs the Start gate rejects.
 */
export function useStartYear({ service, source, review, reopenedAdjustmentIds, summary, onPin, onSuccess, canStart }) {
    const [phase, setPhase] = useState('idle');
    const [outcome, setOutcome] = useState(null);
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
        const yearId = draft.nextYearLabel.trim();
        // Strict payload, rebuilt from the same draft: a retry sends the same ids and reviewed fingerprint.
        const payload = buildReconciliationPayload(draft, source);
        const payloadFingerprint = computePayloadFingerprint(payload, yearId);
        onPin(source);
        setOutcome(null);
        setPhase('starting');
        const result = await startReviewedYear({
            service, sourceYear: source.sourceYear, sourceEvents: source.billingEvents, yearId, payload,
            reopenedAdjustmentIds, payloadFingerprint, summary
        });
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
    return { phase, outcome, start, clearOutcome, locked: phase === 'starting' };
}
