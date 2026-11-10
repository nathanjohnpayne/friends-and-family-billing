/**
 * YearEndReviewView — /year-end-review (ADR 0009, specs/year-end-review.md § The page).
 *
 * Steps 1–3 (Bills, New subscriptions, Member charges) with their validation
 * and the local draft. Step 4, Start and the commit are #609: this page ends
 * with a disabled "Review & start" footer until they land. The page is
 * reachable by route only; the Settings and Dashboard entry points are #609/#610.
 *
 * Nothing here writes the billing-year document. The draft lives in component
 * state mirrored to localStorage (useYearEndReview).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBillingData } from '../../hooks/useBillingData.js';
import { findSuccessorYear } from '../../../lib/year-end-review.js';
import { localDateString } from '../../../lib/validation.js';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import BillsStep from './BillsStep.jsx';
import NewSubscriptionsStep from './NewSubscriptionsStep.jsx';
import ChargesStep from './ChargesStep.jsx';
import ReviewStep, { REVIEW_STEP_READY } from './ReviewStep.jsx';
import { useYearEndReview } from './useYearEndReview.js';
import { formatDate } from './yearEndReviewModel.js';
import './YearEndReview.css';

const EMPTY = [];

function stepNames(nextYearLabel) {
    return ['Bills', 'New subscriptions', 'Member charges', `Review & start ${nextYearLabel}`];
}

function StepStrip({ step, names, onGo }) {
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
                            {state === 'done'
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

function ReviewPage({ source, userId }) {
    const review = useYearEndReview(source, userId);
    const [step, setStep] = useState(1);
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);
    const nextYearLabel = review.draft.nextYearLabel;
    const names = stepNames(nextYearLabel);
    const blocked = step <= 3 && review.stepErrors[step].length > 0;
    const last = step === 3;
    const go = number => { setStep(number); if (typeof window !== 'undefined') window.scrollTo?.(0, 0); };

    return (
        <div className="yer-page">
            <div className="page-head yer-head">
                <div>
                    <div className="yer-eyebrow">Year-End Review · {formatDate(localDateString())}</div>
                    <h1 className="type-display page-title">Review {source.sourceYear.label} and start {nextYearLabel}</h1>
                    <p className="page-hint yer-hint-long">Nothing is saved until you press Start {nextYearLabel}. Your draft is kept on this device.</p>
                    <p className="page-hint yer-hint-short">Draft kept on this device · nothing is saved until Start.</p>
                </div>
                <button type="button" className="btn btn-sm btn-header-secondary" onClick={() => setConfirmingDiscard(true)}>Discard draft</button>
            </div>
            <StepStrip step={step} names={names} onGo={go} />
            <Banners review={review} nextYearLabel={nextYearLabel} sourceLabel={source.sourceYear.label} />

            {step === 1 && <BillsStep review={review} source={source} nextYearLabel={nextYearLabel} />}
            {step === 2 && <NewSubscriptionsStep review={review} source={source} nextYearLabel={nextYearLabel} />}
            {step === 3 && <ChargesStep review={review} source={source} nextYearLabel={nextYearLabel} />}
            {step === 4 && <ReviewStep review={review} source={source} nextYearLabel={nextYearLabel} />}

            <div className="yer-foot">
                {step > 1 ? <button type="button" className="btn btn-header-secondary" onClick={() => go(step - 1)}>← Back</button> : <span />}
                <span className="yer-foot-spacer" />
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
            {last && !REVIEW_STEP_READY && (
                <p className="yer-hint yer-foot-note">The review and Start step arrive in the next update. Your draft is kept.</p>
            )}

            <ConfirmDialog
                open={confirmingDiscard}
                title="Discard this draft?"
                message={`Your entries for ${nextYearLabel} are deleted from this device. ${source.sourceYear.label} is not changed.`}
                confirmLabel="Discard draft"
                destructive
                onCancel={() => setConfirmingDiscard(false)}
                onConfirm={() => { review.actions.discardDraft(); setConfirmingDiscard(false); go(1); }}
            />
        </div>
    );
}

export default function YearEndReviewView() {
    const data = useBillingData();
    const { user } = useAuth();
    const { activeYear, billingYears, billingEvents, loading } = data;
    const source = useMemo(() => ({
        sourceYear: activeYear, bills: data.bills || EMPTY, familyMembers: data.familyMembers || EMPTY,
        owedAdjustments: data.owedAdjustments || EMPTY, payments: data.payments || EMPTY,
        creditAdjustments: data.creditAdjustments || EMPTY, billingEvents: billingEvents || EMPTY
    }), [activeYear, data.bills, data.familyMembers, data.owedAdjustments, data.payments, data.creditAdjustments, billingEvents]);

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
    const successor = findSuccessorYear(billingYears || EMPTY, activeYear, billingEvents || EMPTY);
    if (successor) {
        return (
            <EmptyState
                title={`${successor.label} already exists`}
                message={`${activeYear.label} has already been rolled over. Record new charges in the open ${successor.label} year instead.`}
                action={<Link className="btn btn-sm" to="/dashboard">Open the dashboard</Link>}
            />
        );
    }
    return <ReviewPage key={`${user.uid}:${activeYear.id}`} source={source} userId={user.uid} />;
}
