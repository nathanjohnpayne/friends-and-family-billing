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

/** Outcomes that leave the next year in place: the page stays pinned to show them. */
export const CONFLICT_STATES = ['elsewhere', 'diverged'];

export function useStartYear({ service, source, review, reopenedAdjustmentIds, summary, onPin, onSuccess }) {
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

    const start = useCallback(async ({ recheck = false } = {}) => {
        if (running.current) return;
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
            reopenedAdjustmentIds, payloadFingerprint, summary, recheck
        });
        if (result.state === 'success') {
            review.actions.clearDraftAfterSuccess();
            try {
                if (service.getState?.().activeYear?.id !== result.yearId) await service.switchYear(result.yearId);
            } finally {
                onSuccess(result);
            }
            return;
        }
        if (result.state === 'stale') {
            // Refresh the source so the preview recomputes from today's data; Step 4 must be confirmed again.
            try { await service.switchYear(source.sourceYear.id); } catch (_) { /* the stale notice still stands */ }
        }
        running.current = false;
        if (!mounted.current) return;
        setPhase('idle');
        setOutcome(result);
        if (!CONFLICT_STATES.includes(result.state)) onPin(null);
    }, [service, source, review, reopenedAdjustmentIds, summary, onPin, onSuccess]);

    const clearOutcome = useCallback(() => setOutcome(null), []);
    return { phase, outcome, start, clearOutcome, locked: phase === 'starting' };
}
