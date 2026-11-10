/**
 * YearEndReviewView — /year-end-review (ADR 0009, specs/year-end-review.md § The page).
 *
 * Steps 1–3 (Bills, New subscriptions, Member charges, #608) and Step 4 with
 * Start (#609): the household preview, the year label, the statement of what
 * Start writes, and the commit with its outcomes. Entry points: Settings →
 * Billing year (#609) and the Dashboard prompt (#610).
 *
 * Nothing here writes the billing-year document except Start, through
 * createYear. The draft lives in component state mirrored to localStorage
 * (useYearEndReview) and is cleared only on a confirmed success or an
 * explicit discard.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useRefundNotices } from '../../hooks/useRefundNotices.js';
import { canStart, findSuccessorYear } from '../../../lib/year-end-review.js';
import { suggestNextYearLabel } from '../../../lib/billing-year.js';
import { reopenedCreditAdjustmentIds } from '../../../lib/refundNotice.js';
import { localDateString } from '../../../lib/validation.js';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import Dialog from '../../components/Dialog.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import BillsStep from './BillsStep.jsx';
import NewSubscriptionsStep from './NewSubscriptionsStep.jsx';
import ChargesStep from './ChargesStep.jsx';
import ReviewStep, { REVIEW_STEP_READY, labelError } from './ReviewStep.jsx';
import { useYearEndReview } from './useYearEndReview.js';
import { CONFLICT_STATES, clearPendingAttempt, readPendingAttempt, useStartYear } from './useStartYear.js';
import { COMMIT_GUARD_MISSING, hasCommitGuard } from './commitOutcome.js';
import { previewRollover } from './reviewPreview.js';
import { draftStorageKey, entryCounts, formatDate, readStored, removeStored, snapshotStorageKey } from './yearEndReviewModel.js';
import './YearEndReview.css';

const EMPTY = [];
const NO_IDS = new Set();

function stepNames(nextYearLabel) {
    return ['Bills', 'New subscriptions', 'Member charges', `Review & start ${nextYearLabel}`];
}

function StepStrip({ step, names, onGo, locked }) {
    return (
        <>
            <ol className="yer-steps" aria-label="Year-End Review steps">
                {names.map((name, index) => {
                    const number = index + 1;
                    const state = number < step ? 'done' : number === step ? 'now' : 'todo';
                    const label = (
                        <>
                            <i aria-hidden="true">{state === 'done' ? '✓' : number}</i>
                            <span>{name}</span>
                        </>
                    );
                    return (
                        <li key={name} className={'yer-step yer-step--' + state} aria-current={state === 'now' ? 'step' : undefined}>
                            {state === 'done' && !locked
                                ? <button type="button" className="yer-step-btn" onClick={() => onGo(number)}>{label}</button>
                                : label}
                        </li>
                    );
                })}
            </ol>
            <div className="yer-steps-compact" aria-hidden="true">
                <span>Step {step} of 4 · {names[step - 1]}</span>
                <span className="yer-bar-track"><i style={{ width: step * 25 + '%' }} /></span>
            </div>
        </>
    );
}

function Banners({ review, nextYearLabel, sourceLabel }) {
    const { restore, storage, flags } = review;
    const clearedAnswers = Object.values(flags).reduce((sum, perBill) => sum + Object.keys(perBill || {}).length, 0);
    return (
        <>
            {!storage.available && (
                <div className="status-banner status-banner--warning" role="status">
                    <p>This draft is not saved on this device. It is kept while this page stays open.</p>
                </div>
            )}
            {restore.message && (
                <div className="status-banner status-banner--warning" role="status">
                    <p>{restore.message} A new draft was started.</p>
                </div>
            )}
            {restore.restored && !restore.dismissed && (
                <div className="status-banner status-banner--warning yer-restored" role="status">
                    <p>
                        <b>Draft from {restore.savedAt ? new Date(restore.savedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'earlier'} restored.</b>{' '}
                        {restore.stale && <>{restore.staleSummary}. Every amount was recomputed from today’s data and your entries were kept; check {nextYearLabel}’s totals again before you start. </>}
                        {clearedAnswers > 0 && <>{clearedAnswers === 1 ? '1 earlier-credit answer was' : `${clearedAnswers} earlier-credit answers were`} cleared and must be given again in Step 1. </>}
                        {!restore.stale && clearedAnswers === 0 && <>Your {sourceLabel} data has not changed since.</>}
                    </p>
                    {restore.notices.length > 0 && (
                        <ul className="yer-notices">{[...new Set(restore.notices)].map(text => <li key={text}>{text}</li>)}</ul>
                    )}
                    <div><button type="button" className="btn btn-sm" onClick={review.actions.dismissRestoreBanner}>Dismiss</button></div>
                </div>
            )}
        </>
    );
}

/** The "Nothing changed" fast path: all three confirmations, then straight to Step 4. */
function NothingChangedDialog({ draft, sourceLabel, nextYearLabel, onCancel, onConfirm }) {
    const [checked, setChecked] = useState({ ...draft.confirmations });
    const all = checked.noBillChanges && checked.noNewSubscriptions && checked.noExtraCharges;
    const box = (name, text) => (
        <label className="checkbox-item yer-confirm">
            <input type="checkbox" checked={!!checked[name]} onChange={event => setChecked(prev => ({ ...prev, [name]: event.target.checked }))} />
            {text}
        </label>
    );
    return (
        <Dialog
            onClose={onCancel}
            title={`Nothing changed in ${sourceLabel}?`}
            onSubmit={event => { event.preventDefault(); if (all) onConfirm(); }}
            footer={(
                <>
                    <button type="button" className="btn btn-sm btn-header-secondary" onClick={onCancel}>Cancel</button>
                    <button type="submit" className="btn btn-sm btn-ink" disabled={!all}>Review &amp; start {nextYearLabel}</button>
                </>
            )}
        >
            <p className="yer-hint">Confirm all three to skip the editing steps. Step 4 still lists everything that already carries, and nothing new is recorded.</p>
            {box('noBillChanges', `No ${sourceLabel} bill changed price or ended`)}
            {box('noNewSubscriptions', `No new subscriptions started in ${sourceLabel}`)}
            {box('noExtraCharges', 'No additional member charges')}
        </Dialog>
    );
}

/**
 * Start's gate: canStart over every step's errors, the label, the preview and the refund
 * notices. While an earlier attempt is unresolved, Check again re-sends that attempt
 * unchanged, so only what the re-send itself needs gates it (the commit guard and the
 * refund notices): the live draft, preview and fingerprint may already reflect that
 * attempt's own commit, and the service's read decides it.
 */
function gateOf({ review, preview, billingYears, notices, sourceLabel, service, stale, unresolved }) {
    const errors = [];
    // Release precondition, not a figure problem: it never marks the figures pending.
    if (!hasCommitGuard(service)) errors.push({ step: 4, message: COMMIT_GUARD_MISSING, label: true });
    if (unresolved) {
        if (notices.loading) errors.push({ step: 4, message: 'Loading refund notices…', label: true });
        else if (notices.error) errors.push({ step: 4, message: 'Refund notices could not be loaded, so a re-opened refund might carry. Reload the page.', label: true });
        return { canStart: errors.length === 0, blockers: errors, pending: true };
    }
    // STALE_SOURCE: this tab's copy of the source is out of date until it is reloaded.
    if (stale) errors.push({ step: 4, message: `${sourceLabel} changed after this preview. Reload to load today’s ${sourceLabel}; the figures are then recomputed.`, reload: true });
    for (const step of [1, 2, 3]) {
        for (const error of review.stepErrors[step]) if (error.field !== 'credits') errors.push({ step, message: error.message });
    }
    const entries = Object.values(review.derived.bills).flatMap(item => item.unanswered || []);
    const label = labelError(review.draft.nextYearLabel, billingYears);
    if (label) errors.push({ step: 4, message: label, label: true });
    if (!preview) errors.push({ step: 4, message: 'Open Step 4 to compute the preview.' });
    else if (!preview.ok) errors.push({ step: 4, message: 'The preview could not be computed: ' + preview.error });
    else for (const household of preview.households) if (!household.ok) errors.push({ step: 4, message: 'A household’s figures are on hold and must be corrected first.' });
    if (notices.loading) errors.push({ step: 4, message: 'Loading refund notices…' });
    else if (notices.error) errors.push({ step: 4, message: 'Refund notices could not be loaded, so a re-opened refund might carry. Reload the page.' });
    const result = canStart(review.draft, { errors, unanswered: entries.map(entry => entry.record.id), previewCurrent: !review.sourceChanged });
    const blockers = result.blockers.map(blocker => {
        if (errors.includes(blocker)) return blocker;
        if (blocker.adjustmentId !== undefined) {
            const entry = entries.find(item => item.record.id === blocker.adjustmentId);
            return { ...blocker, message: entry?.message || blocker.message };
        }
        return { step: 4, accept: true, message: `${review.restore.staleSummary || `${sourceLabel} changed since these figures were reviewed`}. The figures above were recomputed from today’s data; check them, then confirm.` };
    });
    return { canStart: result.canStart, blockers, pending: blockers.some(blocker => !blocker.label) };
}

function ReviewPage({ source, userId, service, billingYears, onPin, onReload, resume = null }) {
    const review = useYearEndReview(source, userId);
    const navigate = useNavigate();
    const { showToast } = useToast();
    const notices = useRefundNotices();
    // A remount over an unresolved attempt resumes on Step 4 in the uncertain state (#609 review).
    const [step, setStep] = useState(resume ? 4 : 1);
    const [resumedOutcome] = useState(() => (resume ? { state: 'uncertain', checked: false, yearId: resume.yearId, resumed: true } : null));
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);
    const [fastPath, setFastPath] = useState(false);
    const nextYearLabel = review.draft.nextYearLabel;
    const names = stepNames(nextYearLabel);
    const sourceLabel = source.sourceYear.label;
    const reopened = useMemo(() => (notices.refundNotices ? reopenedCreditAdjustmentIds(notices.refundNotices) : NO_IDS), [notices.refundNotices]);
    const previewYear = nextYearLabel.trim() || suggestNextYearLabel(source.sourceYear);
    const [now] = useState(() => new Date().toISOString());
    const preview = useMemo(() => (step === 4
        ? previewRollover({ source, draft: review.draft, derived: review.derived, yearId: previewYear, reopenedAdjustmentIds: reopened, now })
        : null), [step, source, review.draft, review.derived, previewYear, reopened, now]);
    const onSuccess = useCallback(result => {
        showToast(result.alreadyCompleted ? `${result.yearId} was already started from this draft.` : `${result.yearId} started.`);
        navigate('/dashboard');
    }, [navigate, showToast]);
    // Start, Retry and Check again all read the gate at the moment they run (#609 review).
    const gateRef = useRef(null);
    const canStartNow = useCallback(() => gateRef.current?.canStart === true, []);
    const commit = useStartYear({ service, source, review, reopenedAdjustmentIds: reopened, summary: preview?.ok ? preview.prepared.summary : null,
        onPin, onSuccess, canStart: canStartNow, initialOutcome: resumedOutcome });
    // After an uncertain outcome the destination may be this draft's own commit, so it is not
    // a "duplicate label": the service's read classifies it when Check again runs.
    const uncertain = commit.outcome?.state === 'uncertain';
    const knownYears = uncertain ? billingYears.filter(year => String(year.id) !== nextYearLabel.trim()) : billingYears;
    const gate = gateOf({ review, preview, billingYears: knownYears, notices, sourceLabel, service, stale: commit.outcome?.state === 'stale', unresolved: commit.unresolved });
    gateRef.current = gate;
    const locked = commit.locked;
    // While an attempt is unresolved, Check again re-sends that attempt: edits made meanwhile would
    // not be what is committed and a success would clear them with the draft, so editing waits.
    const editLocked = locked || commit.unresolved;
    const conflict = !!commit.outcome && CONFLICT_STATES.includes(commit.outcome.state);

    const counts = entryCounts(review.draft);
    const noEntries = counts.bills + counts.newBills + counts.charges === 0;
    const confirmations = review.draft.confirmations;
    const nothingChanged = noEntries && confirmations.noBillChanges && confirmations.noNewSubscriptions && confirmations.noExtraCharges;

    const blocked = step <= 3 && review.stepErrors[step].length > 0;
    const last = step === 3;
    const go = number => { if (editLocked) return; setStep(number); if (typeof window !== 'undefined') window.scrollTo?.(0, 0); };

    const openYear = async () => {
        const target = commit.outcome?.successorId ?? commit.outcome?.yearId;
        if (target != null) await service.switchYear(String(target));
        navigate('/dashboard');
    };
    const confirmDiscard = () => {
        setConfirmingDiscard(false);
        // An explicit discard also forgets any unresolved attempt of this draft.
        clearPendingAttempt(userId, source.sourceYear.id);
        if (conflict || uncertain) {
            // The next year exists (or may): there is nothing left to review here. Remove
            // the stored draft without starting a new one and leave the page.
            review.actions.clearDraftAfterSuccess();
            showToast('Draft discarded. ' + sourceLabel + ' was not changed.');
            navigate('/dashboard');
            return;
        }
        review.actions.discardDraft();
        commit.clearOutcome();
        go(1);
    };

    return (
        <div className="yer-page">
            <div className="page-head yer-head">
                <div>
                    <div className="yer-eyebrow">Year-End Review · {formatDate(localDateString())}</div>
                    <h1 className="type-display page-title">Review {sourceLabel} and start {nextYearLabel}</h1>
                    <p className="page-hint yer-hint-long">Nothing is saved until you press Start {nextYearLabel}. Your draft is kept on this device.</p>
                    <p className="page-hint yer-hint-short">Draft kept on this device · nothing is saved until Start.</p>
                </div>
                {locked
                    ? <span className="yer-hint yer-locked-note">Locked while {nextYearLabel} starts</span>
                    : <button type="button" className="btn btn-sm btn-header-secondary" onClick={() => setConfirmingDiscard(true)}>Discard draft</button>}
            </div>
            <StepStrip step={step} names={names} onGo={go} locked={editLocked} />
            {locked && (
                <div className="status-banner status-banner--warning yer-progress" role="status">
                    <span className="yer-spinner" aria-hidden="true" />
                    <p><b>Starting {nextYearLabel}…</b> Writing {sourceLabel} and {nextYearLabel} together. Don’t close this tab.</p>
                </div>
            )}
            <Banners review={review} nextYearLabel={nextYearLabel} sourceLabel={sourceLabel} />

            {step === 1 && <BillsStep review={review} source={source} nextYearLabel={nextYearLabel} />}
            {step === 2 && <NewSubscriptionsStep review={review} source={source} nextYearLabel={nextYearLabel} />}
            {step === 3 && <ChargesStep review={review} source={source} nextYearLabel={nextYearLabel} />}
            {step === 4 && (
                <ReviewStep review={review} source={source} nextYearLabel={nextYearLabel} preview={preview} gate={gate} commit={commit}
                    billingYears={knownYears} reopenedAdjustmentIds={reopened} nothingChanged={nothingChanged}
                    onGo={go} onOpenYear={openYear} onDiscard={() => setConfirmingDiscard(true)} onReload={onReload} />
            )}

            {!editLocked && (
                <div className="yer-foot">
                    {step > 1 ? <button type="button" className="btn btn-header-secondary" onClick={() => go(step - 1)}>← {step === 4 ? 'Back to member charges' : 'Back'}</button> : <span />}
                    <span className="yer-foot-spacer" />
                    {step <= 3 && noEntries && (
                        <button type="button" className="btn btn-header-secondary" onClick={() => setFastPath(true)}>Nothing changed…</button>
                    )}
                    {blocked && <span className="yer-hint yer-foot-hint" id="yer-next-hint">Fix the items marked above to continue.</span>}
                    {step < 4 && (
                        <button
                            type="button"
                            className="btn btn-ink"
                            disabled={blocked || (last && !REVIEW_STEP_READY)}
                            aria-describedby={blocked ? 'yer-next-hint' : undefined}
                            onClick={() => go(step + 1)}
                        >
                            {last ? `Review & start ${nextYearLabel}` : `Next: ${names[step].toLowerCase()}`} →
                        </button>
                    )}
                </div>
            )}

            {fastPath && (
                <NothingChangedDialog draft={review.draft} sourceLabel={sourceLabel} nextYearLabel={nextYearLabel}
                    onCancel={() => setFastPath(false)}
                    onConfirm={() => {
                        review.actions.markNoPriceChanges();
                        review.actions.setConfirmation('noNewSubscriptions', true);
                        review.actions.setConfirmation('noExtraCharges', true);
                        setFastPath(false);
                        go(4);
                    }} />
            )}

            <ConfirmDialog
                open={confirmingDiscard}
                title="Discard this draft?"
                message={`Your entries for ${nextYearLabel} are deleted from this device. ${sourceLabel} is not changed.`}
                confirmLabel="Discard draft"
                destructive
                onCancel={() => setConfirmingDiscard(false)}
                onConfirm={confirmDiscard}
            />
        </div>
    );
}

/** The guard found a next year: say so, and keep or discard a draft left on this device. */
function SuccessorExists({ activeYear, successor, userId, service }) {
    const navigate = useNavigate();
    const key = draftStorageKey(userId, activeYear.id);
    const [hasDraft, setHasDraft] = useState(() => readStored(key).value !== undefined);
    const [confirming, setConfirming] = useState(false);
    const open = async () => { await service.switchYear(String(successor.id)); navigate('/dashboard'); };
    if (!hasDraft) {
        return (
            <EmptyState
                title={`${successor.label} already exists`}
                message={`${activeYear.label} has already been rolled over. Record new charges, credits and refunds in the open ${successor.label} year instead.`}
                action={<button type="button" className="btn btn-sm" onClick={open}>Open {successor.label}</button>}
            />
        );
    }
    return (
        <div className="yer-page">
            <div className="yer-alert yer-alert--error" role="alert">
                <p><b>{successor.label} already exists.</b> It was started elsewhere, so nothing was changed here and your draft is kept. Open {successor.label} to continue there, or discard this draft. New charges, credits and refunds go in the open {successor.label} year.</p>
                <div className="yer-alert-acts">
                    <button type="button" className="btn btn-header-secondary" onClick={() => setConfirming(true)}>Discard draft</button>
                    <button type="button" className="btn btn-ink" onClick={open}>Open {successor.label}</button>
                </div>
            </div>
            <ConfirmDialog
                open={confirming}
                title="Discard this draft?"
                message={`Your review entries are deleted from this device. ${activeYear.label} and ${successor.label} are not changed.`}
                confirmLabel="Discard draft"
                destructive
                onCancel={() => setConfirming(false)}
                onConfirm={() => {
                    removeStored(key);
                    removeStored(snapshotStorageKey(userId, activeYear.id));
                    clearPendingAttempt(userId, activeYear.id);
                    setConfirming(false);
                    setHasDraft(false);
                }}
            />
        </div>
    );
}

const reloadPage = () => window.location.reload();

/** @param {{ onReload?: () => void }} props onReload is replaceable for tests (default: reload the tab). */
export default function YearEndReviewView({ onReload = reloadPage } = {}) {
    const data = useBillingData();
    const { user } = useAuth();
    const { activeYear, billingYears, billingEvents, loading, service } = data;
    // While Start runs (and while a conflict it found is shown) the page keeps the
    // source it reviewed: the service reloads the years list and switches years
    // under it, which must neither re-key the page nor trip the entry guard.
    const [pinned, setPinned] = useState(null);
    const source = useMemo(() => ({
        sourceYear: activeYear, bills: data.bills || EMPTY, familyMembers: data.familyMembers || EMPTY,
        owedAdjustments: data.owedAdjustments || EMPTY, payments: data.payments || EMPTY,
        creditAdjustments: data.creditAdjustments || EMPTY, billingEvents: billingEvents || EMPTY, settings: data.settings || null
    }), [activeYear, data.bills, data.familyMembers, data.owedAdjustments, data.payments, data.creditAdjustments, billingEvents, data.settings]);
    const pageKey = user && activeYear ? `${user.uid}:${activeYear.id}` : null;
    const pin = useCallback(reviewed => setPinned(reviewed ? { key: pageKey, source: reviewed, userId: user.uid } : null), [pageKey, user]);

    if (pinned) {
        return <ReviewPage key={pinned.key} source={pinned.source} userId={pinned.userId} service={service} billingYears={billingYears || EMPTY} onPin={pin} onReload={onReload} />;
    }
    if (loading || !user) return <div className="yer-loading" role="status">Loading…</div>;
    if (!activeYear) {
        return <EmptyState title="No billing year" message="Create or select a billing year in Settings first." action={<Link className="btn btn-sm" to="/settings">Open Settings</Link>} />;
    }
    if (activeYear.status === 'archived') {
        return <EmptyState title={`${activeYear.label} is archived`} message="An archived year cannot be reviewed or rolled over." action={<Link className="btn btn-sm" to="/settings">Open Settings</Link>} />;
    }
    if (!/^\d{4}$/.test(String(activeYear.label))) {
        return (
            <EmptyState
                title="The review needs a four-digit year label"
                message={`${activeYear.label} is not a calendar year, so the review cannot work out which months its price changes and new subscriptions fall in. Non-calendar years are not supported yet.`}
                action={<Link className="btn btn-sm" to="/settings">Open Settings</Link>}
            />
        );
    }
    // An attempt of the stored draft that may have committed (a reload, a route re-entry or a
    // tab closed mid-commit) resumes in the uncertain state: the entry guard must not call
    // the year it may have created "started elsewhere" before the attempt is read back.
    const attempt = readPendingAttempt(user.uid, activeYear.id);
    if (attempt) {
        return <ReviewPage key={pageKey} source={source} userId={user.uid} service={service} billingYears={billingYears || EMPTY} onPin={pin} onReload={onReload} resume={attempt} />;
    }
    const successor = findSuccessorYear(billingYears || EMPTY, activeYear, billingEvents || EMPTY);
    if (successor) return <SuccessorExists activeYear={activeYear} successor={successor} userId={user.uid} service={service} />;
    return <ReviewPage key={pageKey} source={source} userId={user.uid} service={service} billingYears={billingYears || EMPTY} onPin={pin} onReload={onReload} />;
}
