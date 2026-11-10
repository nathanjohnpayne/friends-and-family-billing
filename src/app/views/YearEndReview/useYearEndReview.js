/**
 * useYearEndReview — the draft and derived state of the Year-End Review page.
 *
 * This is the seam #609 (Step 4, Start, the commit) builds on. It returns:
 *   draft            the input-only draft (spec § Draft); derived amounts are never stored
 *   derived          deriveReview(): computed True-ups / Service Credits, per-row errors, summary
 *   stepErrors       { 1: [...], 2: [...], 3: [...] } — Next is disabled while a step has any
 *   restore          { restored, message, notices, stale, staleSummary } for the banner
 *   storage          { available } — false means the in-memory fallback is in use
 *   sourceChanged    the live source fingerprint differs from the draft's reviewed fingerprint
 *   actions          edit actions; plus discardDraft(), clearDraftAfterSuccess(),
 *                    acceptSourceFingerprint() (Step 4 calls it after the administrator sees new totals)
 *
 * The draft is mirrored to localStorage on every change; every access is
 * guarded and an unavailable store degrades to component state. The
 * billing-year document is never written from here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeEnded, computePriceChange, revalidateExistingCreditAnswers, validateDraft } from '../../../lib/year-end-review.js';
import { suggestNextYearLabel } from '../../../lib/billing-year.js';
import { generateUniqueBillId, generateUniqueId, localDateString } from '../../../lib/validation.js';
import {
    coverageFor, createDraft, creditsOnBill, deriveReview, describeSourceChange, draftStorageKey, explainClearedAnswers,
    fingerprintOf, readStored, removeStored, snapshotStorageKey, sourceCounts, writeStored, snapshotExistingCredit
} from './yearEndReviewModel.js';

const BILL_INPUT_FIELDS = ['change', 'newAmount', 'firstMonth', 'lastMonth', 'override'];

function prune(row) {
    return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function restoreDraft(stored, source, userId) {
    const sourceYear = source.sourceYear;
    const validation = validateDraft(stored.value, {
        userId, sourceYear, bills: source.bills, familyMembers: source.familyMembers, owedAdjustments: source.owedAdjustments,
        payments: source.payments, creditAdjustments: source.creditAdjustments, billingEvents: source.billingEvents
    });
    if (!validation.draft) {
        return { draft: null, message: validation.errors[0]?.message || 'The saved draft could not be used and was discarded.' };
    }
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const draftRows = validation.draft;
    // The renderers read these as strings; validateDraft reports a wrong type but keeps the row.
    const text = value => typeof value === 'string';
    if (!Object.values(draftRows.bills).every(isObject) || !draftRows.newBills.every(isObject) || !draftRows.charges.every(isObject)
        || !draftRows.newBills.every(row => Array.isArray(row.members) && text(row.name) && text(row.website) && text(row.frequency))
        || !draftRows.charges.every(row => text(row.description) && text(row.incurredDate))) {
        return { draft: null, message: 'The saved draft was malformed and was discarded.' };
    }
    try {
        deriveReview({ draft: draftRows, sourceYear, bills: source.bills, familyMembers: source.familyMembers, owedAdjustments: source.owedAdjustments, flags: {} });
    } catch (_) {
        return { draft: null, message: 'The saved draft was malformed and was discarded.' };
    }
    const flags = {};
    for (const [billId, row] of Object.entries(validation.draft.bills)) {
        const before = stored.value.bills?.[billId]?.existingCredits;
        if (!before) continue;
        const billRow = bill(source, billId);
        if (billRow) flags[billId] = explainClearedAnswers(before, row.existingCredits, creditsOnBill(source.owedAdjustments, billRow.id), source.familyMembers, 'months');
    }
    const notices = validation.notices.filter(text => !text.startsWith('The source year changed'));
    let staleSummary = null;
    if (validation.stale) {
        const counts = readStored(snapshotStorageKey(userId, sourceYear.id)).value;
        const previous = counts && counts.fingerprint === stored.value.sourceFingerprint ? counts.counts : null;
        staleSummary = describeSourceChange(previous, sourceCounts(source), sourceYear.label);
    }
    return { draft: validation.draft, notices, stale: validation.stale, staleSummary, flags, savedAt: stored.value.savedAt };
}

function bill(source, billId) { return source.bills.find(item => String(item.id) === String(billId)); }

function initialise(source, userId) {
    const sourceYear = source.sourceYear;
    const key = draftStorageKey(userId, sourceYear.id);
    const stored = readStored(key);
    const fresh = () => {
        const draft = createDraft({ userId, sourceYear, nextYearLabel: suggestNextYearLabel(sourceYear), sourceFingerprint: fingerprintOf(source) });
        return draft;
    };
    const base = { storageAvailable: stored.available, restored: false, message: null, notices: [], stale: false, staleSummary: null, flags: {}, savedAt: null };
    if (stored.available && (stored.corrupt || stored.value !== undefined)) {
        if (stored.corrupt) {
            removeStored(key);
            return { ...base, draft: fresh(), message: 'The saved draft could not be read and was discarded.' };
        }
        const restored = restoreDraft(stored, source, userId);
        if (!restored.draft) {
            removeStored(key);
            return { ...base, draft: fresh(), message: restored.message };
        }
        return { ...base, ...restored, restored: true };
    }
    return { ...base, draft: fresh() };
}

export function useYearEndReview(source, userId) {
    const sourceRef = useRef(source);
    sourceRef.current = source;
    const [init] = useState(() => initialise(source, userId));
    const [draft, setDraftState] = useState(init.draft);
    const draftRef = useRef(init.draft);
    const [flags, setFlags] = useState(init.flags);
    const [storageAvailable, setStorageAvailable] = useState(init.storageAvailable);
    const [restore, setRestore] = useState({
        restored: init.restored, message: init.message, notices: init.notices, stale: init.stale,
        staleSummary: init.staleSummary, savedAt: init.savedAt, dismissed: false
    });
    const key = draftStorageKey(userId, source.sourceYear.id);

    const commit = useCallback(next => { draftRef.current = next; setDraftState(next); }, []);
    const update = useCallback(fn => commit(fn(draftRef.current)), [commit]);

    // Mirror to localStorage; a failed write flips to the in-memory notice.
    useEffect(() => {
        const current = sourceRef.current;
        // The counts sidecar belongs to the fingerprint it was taken at: only write it while the draft's fingerprint is today's.
        const matches = draft.sourceFingerprint === fingerprintOf(current);
        const ok = writeStored(key, { ...draft, savedAt: new Date().toISOString() })
            && (!matches || writeStored(snapshotStorageKey(userId, current.sourceYear.id), { fingerprint: draft.sourceFingerprint, counts: sourceCounts(current) }));
        setStorageAvailable(ok);
    }, [draft, key, userId]);

    const flagsRef = useRef(flags);
    flagsRef.current = flags;
    const derived = useMemo(() => deriveReview({
        draft, sourceYear: source.sourceYear, bills: source.bills, familyMembers: source.familyMembers,
        owedAdjustments: source.owedAdjustments, flags
    }), [draft, flags, source.sourceYear, source.bills, source.familyMembers, source.owedAdjustments]);

    const sourceFingerprint = useMemo(() => fingerprintOf(source), [source]);

    const baseFor = (billRow, row) => {
        try {
            return (row.change === 'ended' ? computeEnded : computePriceChange)(billRow, row, { sourceYear: sourceRef.current.sourceYear, skipExistingCredits: true });
        } catch (_) { return null; }
    };

    const actions = {
        setBillField(billId, patch) {
            const current = sourceRef.current;
            const billRow = bill(current, billId);
            if (!billRow) return;
            const nextFlags = {};
            update(prev => {
                const previous = prev.bills[billId] || { change: 'unchanged' };
                const merged = prune({ ...previous, ...patch });
                if (Object.keys(patch).some(field => BILL_INPUT_FIELDS.includes(field))) {
                    // Editing the change clears the bill's answers when its coverage identity changes.
                    const live = creditsOnBill(current.owedAdjustments, billRow.id);
                    const answers = previous.existingCredits || {};
                    const base = merged.change !== 'unchanged' ? baseFor(billRow, merged) : null;
                    let kept = {};
                    if (base && Object.keys(answers).length) {
                        kept = revalidateExistingCreditAnswers(merged, live, base).existingCredits;
                    }
                    if (Object.keys(answers).length && Object.keys(kept).length !== Object.keys(answers).length) {
                        const cause = 'change' in patch || 'newAmount' in patch || 'override' in patch ? 'change' : 'months';
                        Object.assign(nextFlags, explainClearedAnswers(answers, kept, live, current.familyMembers, cause));
                    }
                    if (Object.keys(kept).length) merged.existingCredits = kept; else delete merged.existingCredits;
                }
                const confirmations = patch.change && patch.change !== 'unchanged' ? { ...prev.confirmations, noBillChanges: false } : prev.confirmations;
                return { ...prev, bills: { ...prev.bills, [billId]: merged }, confirmations };
            });
            setFlags(prev => ({ ...prev, [billId]: { ...(prev[billId] || {}), ...nextFlags } }));
        },
        answerCredit(billId, adjustmentId, choice, appliedCents) {
            const current = sourceRef.current;
            const billRow = bill(current, billId);
            const record = current.owedAdjustments.find(item => String(item.id) === String(adjustmentId));
            if (!billRow || !record) return;
            update(prev => {
                const row = prev.bills[billId] || { change: 'unchanged' };
                const base = baseFor(billRow, row);
                if (!base) return prev;
                const answer = { choice, seen: snapshotExistingCredit(record), coverage: coverageFor(base, record.memberId) };
                if (choice === 'partial' && Number.isSafeInteger(appliedCents) && appliedCents > 0) answer.appliedCents = appliedCents;
                return { ...prev, bills: { ...prev.bills, [billId]: { ...row, existingCredits: { ...(row.existingCredits || {}), [record.id]: answer } } } };
            });
            setFlags(prev => {
                if (!prev[billId] || !prev[billId][adjustmentId]) return prev;
                const { [adjustmentId]: _removed, ...rest } = prev[billId];
                return { ...prev, [billId]: rest };
            });
        },
        markNoPriceChanges() {
            update(prev => {
                const bills = {};
                for (const [billId, row] of Object.entries(prev.bills)) {
                    bills[billId] = prune({ ...row, change: 'unchanged', existingCredits: undefined });
                }
                return { ...prev, bills, confirmations: { ...prev.confirmations, noBillChanges: true } };
            });
        },
        setConfirmation(name, value) {
            update(prev => ({ ...prev, confirmations: { ...prev.confirmations, [name]: value } }));
        },
        addNewBill() {
            update(prev => {
                const existingBillIds = [...sourceRef.current.bills.map(item => item.id), ...prev.newBills.map(item => item.billId)];
                const rowId = generateUniqueId(prev.newBills.map(item => item.rowId));
                const row = { rowId, billId: generateUniqueBillId(existingBillIds), name: '', frequency: 'monthly', website: '', members: [] };
                return { ...prev, newBills: [...prev.newBills, row], confirmations: { ...prev.confirmations, noNewSubscriptions: false } };
            });
        },
        updateNewBill(rowId, patch) {
            update(prev => ({ ...prev, newBills: prev.newBills.map(row => (row.rowId === rowId ? prune({ ...row, ...patch }) : row)) }));
        },
        removeNewBill(rowId) {
            update(prev => ({ ...prev, newBills: prev.newBills.filter(row => row.rowId !== rowId) }));
        },
        addCharge(charge) {
            update(prev => {
                const rowId = generateUniqueId(prev.charges.map(item => item.rowId));
                const row = { rowId, memberId: charge.memberId, amount: charge.amount, description: charge.description.trim(), incurredDate: charge.incurredDate || localDateString() };
                return { ...prev, charges: [...prev.charges, row], confirmations: { ...prev.confirmations, noExtraCharges: false } };
            });
        },
        removeCharge(rowId) {
            update(prev => ({ ...prev, charges: prev.charges.filter(row => row.rowId !== rowId) }));
        },
        setNextYearLabel(label) {
            update(prev => ({ ...prev, nextYearLabel: label }));
        },
        /** Records that the administrator has now seen the totals computed from today's source data. */
        acceptSourceFingerprint() {
            update(prev => ({ ...prev, sourceFingerprint: fingerprintOf(sourceRef.current) }));
            setRestore(prev => ({ ...prev, stale: false, staleSummary: null }));
        },
        /** Explicit discard: clears the stored draft and starts a fresh one (new reconciliationId). */
        discardDraft() {
            const current = sourceRef.current;
            removeStored(draftStorageKey(userId, current.sourceYear.id));
            removeStored(snapshotStorageKey(userId, current.sourceYear.id));
            const fresh = createDraft({ userId, sourceYear: current.sourceYear, nextYearLabel: suggestNextYearLabel(current.sourceYear), sourceFingerprint: fingerprintOf(current) });
            commit(fresh);
            setFlags({});
            setRestore({ restored: false, message: null, notices: [], stale: false, staleSummary: null, savedAt: null, dismissed: false });
        },
        /** Only after the rollover is confirmed (#609): the draft is otherwise retained. */
        clearDraftAfterSuccess() {
            const current = sourceRef.current;
            removeStored(draftStorageKey(userId, current.sourceYear.id));
            removeStored(snapshotStorageKey(userId, current.sourceYear.id));
        },
        dismissRestoreBanner() { setRestore(prev => ({ ...prev, dismissed: true })); }
    };

    const answerFlags = flags;
    return {
        draft, derived, stepErrors: derived.stepErrors, restore, flags: answerFlags,
        storage: { available: storageAvailable }, sourceFingerprint,
        sourceChanged: draft.sourceFingerprint !== sourceFingerprint, actions
    };
}

