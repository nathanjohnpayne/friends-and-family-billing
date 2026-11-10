/**
 * Step 4 — Review & start <year> (#609; specs/year-end-review.md § Household
 * preview, § The page (Step 4, Nothing changed), § Commit guard and recovery).
 *
 * Renders the dry-run preview the page computed (reviewPreview.js): the four
 * figures, the baseline sentence, one expandable card per household, the year
 * label, the plain-language statement of what Start writes, the blockers and
 * Start itself with its commit states. Figures are marked pending while
 * anything blocks Start; nothing is written from here except through Start.
 */
import { useState } from 'react';
import { isYearLabelDuplicate } from '../../../lib/billing-year.js';
import { householdsOf, memberName, money, signedMoney, formatDate } from './yearEndReviewModel.js';
import { reopenedRefunds } from './reviewPreview.js';

export const REVIEW_STEP_READY = true;

const STEP_NAMES = { 1: 'Bills', 2: 'New subscriptions', 3: 'Member charges' };
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/**
 * The year label's own validation: required, a four-digit calendar year, not an
 * existing year. The four-digit rule follows the page's own entry rule (#608): a
 * year with any other label can never be reviewed, so the review never creates one.
 */
export function labelError(label, billingYears) {
    const value = (label || '').trim();
    if (!value) return 'Enter a label for the new billing year.';
    if (!/^\d{4}$/.test(value)) return 'Use a four-digit year, such as 2027. Years with other labels cannot be reviewed later.';
    if (isYearLabelDuplicate(billingYears || [], value)) return `Billing year "${value}" already exists.`;
    return null;
}

function Pending({ on }) {
    return on ? <span className="status-badge status-badge--partial yer-pending">pending</span> : null;
}

function Figure({ label, value, sub, pending, credit }) {
    return (
        <div className="yer-kpi">
            <div className="yer-eyebrow">{label}</div>
            <div className={'yer-kpi-value yer-num' + (credit ? ' yer-credit-text' : '')}>{value}<Pending on={pending} /></div>
            {sub && <div className="yer-sub">{sub}</div>}
        </div>
    );
}

function itemText(item) {
    if (item.basis === 'member' && item.incurredDate) return `${item.description} (${formatDate(item.incurredDate).replace(/, \d{4}$/, '')})`;
    return item.description;
}

function CreditBlock({ item, many, sourceLabel, nextYearLabel, familyMembers }) {
    return (
        <div className="yer-hh-block yer-hh-credit" data-testid="household-credit">
            <div className="yer-hh-block-head">
                <b>{item.description}</b>{many && <span className="yer-sub yer-inline-sub"> · household, not one member</span>}
                <span className="yer-sub">Net of everything the household paid and was credited in {sourceLabel}</span>
            </div>
            <div className="yer-lines">
                <div className="yer-line yer-line--total"><span>{sourceLabel} credit carried into {nextYearLabel}</span><span className="yer-num yer-credit-text">{signedMoney(item.amount)}</span></div>
                {(item.detail || []).map((line, index) => (
                    <div key={index} className="yer-line yer-line--detail">
                        <span>↳ {line.description}{line.memberId != null ? ` (${memberName(familyMembers, line.memberId).split(' ')[0]})` : ''}</span>
                        <span className="yer-num">{signedMoney(line.amount)}</span>
                    </div>
                ))}
                {(item.detail || []).length > 0 && <p className="yer-sub">Detail explains the credit; it is not added again.</p>}
            </div>
        </div>
    );
}

function HouseholdCard({ household, preview, ctx }) {
    const [open, setOpen] = useState(false);
    const { sourceLabel, nextYearLabel, familyMembers, pending, onEdit, locked } = ctx;
    const many = household.members.length > 1;
    if (!preview || !preview.ok) {
        const holds = preview?.holds || [];
        return (
            <li className="yer-hh yer-hh--held" data-testid={'review-household-' + household.id}>
                <div className="yer-hh-name">{household.name}</div>
                <p className="yer-error" role="alert">{holds.length ? holds.map(hold => hold.message).join(' ') : 'This household’s figures could not be computed.'} Start stays off until it is corrected.</p>
            </li>
        );
    }
    const credit = preview.items.find(item => item.kind === 'credit');
    const memberItems = memberId => preview.items.filter(item => item.kind !== 'credit' && String(item.memberId) === String(memberId));
    const delta = preview.subscriptionDelta;
    const carried = preview.carriedTotal;
    const refunds = reopenedRefunds(ctx.source, ctx.reopenedAdjustmentIds, household.members.map(member => member.id));
    const bodyId = 'yer-hh-body-' + household.id;
    return (
        <li className={'yer-hh' + (carried < 0 ? ' yer-hh--credit' : '')} data-testid={'review-household-' + household.id}>
            <div className="yer-hh-head">
                <div className="yer-hh-who">
                    <div className="yer-hh-name">{household.name}</div>
                    <div className="yer-sub">{many ? `${household.members.map(member => member.name.split(' ')[0]).join(', ')} · ${household.members.length} members` : 'Individual'}</div>
                </div>
                <dl className="yer-hh-figs">
                    <div><dt>{sourceLabel} bills</dt><dd className="yer-num">{money(preview.sourceBillTotal)}</dd></div>
                    <div><dt>{nextYearLabel} bills</dt><dd className="yer-num">{money(preview.nextBillTotal)}<Pending on={pending} /></dd></div>
                    <div><dt>First {nextYearLabel} invoice</dt><dd className="yer-num">{money(preview.firstInvoiceTotal)}<Pending on={pending} /></dd></div>
                </dl>
                <div className="yer-hh-pills">
                    <span className={'status-badge ' + (delta > 0 ? 'status-badge--review' : 'status-badge--settled')}>Subscriptions {delta === 0 ? 'unchanged' : signedMoney(delta)}</span>
                    <span className={'status-badge ' + (carried < 0 ? 'status-badge--credit' : carried > 0 ? 'status-badge--partial' : 'status-badge--settled')}>Carried {carried === 0 ? 'none' : signedMoney(carried)}</span>
                </div>
                <button type="button" className="btn btn-sm btn-header-secondary yer-hh-toggle" aria-expanded={open} aria-controls={bodyId}
                    aria-label={`${open ? 'Hide' : 'Show'} details for ${household.name}`}
                    onClick={() => setOpen(value => !value)}>{open ? 'Hide details' : 'Show details'}</button>
            </div>
            {open && (
                <div className="yer-hh-body" id={bodyId}>
                    {credit && <CreditBlock item={credit} many={many} sourceLabel={sourceLabel} nextYearLabel={nextYearLabel} familyMembers={familyMembers} />}
                    {household.members.map(member => {
                        const items = memberItems(member.id);
                        const line = preview.members.find(row => String(row.memberId) === String(member.id));
                        const carriedCents = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
                        return (
                            <div key={member.id} className="yer-hh-block" data-testid={'review-member-' + member.id}>
                                <div className="yer-hh-block-head">
                                    <b>{member.name}</b>{many && member.id === household.id && <span className="yer-chip yer-tag">Contact</span>}
                                    <span className="yer-sub">{nextYearLabel} bills {money(line?.nextBillTotal ?? 0)}{items.length ? ` · carried ${signedMoney(carriedCents / 100)}` : ' · nothing carried'}</span>
                                </div>
                                {items.length > 0 && (
                                    <div className="yer-lines">
                                        {items.map(item => (
                                            <div key={item.sourceId} className="yer-line"><span>{itemText(item)}</span><span className="yer-num">{signedMoney(item.amount)}</span></div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <dl className="yer-hh-total">
                        <dt>{sourceLabel} bills</dt><dd className="yer-num">{money(preview.sourceBillTotal)}</dd>
                        <dt>{nextYearLabel} bills at their new prices</dt><dd className="yer-num">{money(preview.nextBillTotal)} <span className="yer-sub yer-inline-sub">({signedMoney(delta)} vs {sourceLabel})</span></dd>
                        <dt>Carried from {sourceLabel}</dt><dd className={'yer-num' + (carried < 0 ? ' yer-credit-text' : '')}>{signedMoney(carried)}</dd>
                        <dt>First {nextYearLabel} invoice</dt><dd className="yer-num yer-hh-first">{money(preview.firstInvoiceTotal)}</dd>
                    </dl>
                    {preview.remainingCredit > 0 && <p className="yer-hint">{money(preview.remainingCredit)} of the carried credit remains after the first {nextYearLabel} invoice and carries again at the next rollover.</p>}
                    {refunds > 0 && <p className="yer-hint">{money(refunds)} refund still to be re-sent in {sourceLabel}; not carried.</p>}
                    <div className="yer-hh-acts">
                        <button type="button" className="btn btn-sm btn-header-secondary" disabled={locked} onClick={() => onEdit(1)}>Edit bills</button>
                        <button type="button" className="btn btn-sm btn-header-secondary" disabled={locked} onClick={() => onEdit(2)}>Edit subscriptions</button>
                        <button type="button" className="btn btn-sm btn-header-secondary" disabled={locked} onClick={() => onEdit(3)}>Edit charges</button>
                    </div>
                </div>
            )}
        </li>
    );
}

/** The plain-language list of what Start writes (spec § The page, Step 4). */
function Statement({ statement, sourceLabel, nextYearLabel }) {
    const lines = [];
    if (statement.nothingNew) {
        lines.push(`No new charges or credits are written to ${sourceLabel}.`);
    } else {
        const parts = [];
        if (statement.trueUpShares) parts.push(`${plural(statement.trueUpShares, 'True-up share', 'True-up shares')} (${money(statement.trueUpTotal)})`);
        if (statement.creditShares) parts.push(`${plural(statement.creditShares, 'service-credit share', 'service-credit shares')} (${money(statement.creditTotal)})`);
        if (statement.chargeCount) parts.push(`${plural(statement.chargeCount, 'new member charge', 'new member charges')} (${money(statement.chargeTotal)})`);
        if (parts.length) lines.push(`Record ${joinNames(parts)} in ${sourceLabel} and carry them into ${nextYearLabel}.`);
        if (statement.coveredCount) lines.push(`Note ${plural(statement.coveredCount, 'bill change', 'bill changes')} already covered by earlier credits; nothing more is recorded for ${statement.coveredCount === 1 ? 'it' : 'them'}.`);
    }
    if (statement.reusedCharges) lines.push(`Carry ${plural(statement.reusedCharges, 'member charge', 'member charges')} already recorded, once.`);
    if (statement.newBills.length) lines.push(`Create ${joinNames(statement.newBills)} in ${nextYearLabel}.`);
    if (statement.repriced.length) lines.push(`Set ${joinNames(statement.repriced)} at ${statement.repriced.length === 1 ? 'its' : 'their'} new ${statement.repriced.length === 1 ? 'price' : 'prices'}.`);
    if (statement.keptPrice) lines.push(`Keep ${plural(statement.keptPrice, 'bill', 'bills')} at ${statement.keptPrice === 1 ? 'its' : 'their'} ${sourceLabel} ${statement.keptPrice === 1 ? 'price' : 'prices'}.`);
    if (statement.ended.length) lines.push(`Leave ${joinNames(statement.ended)} out of ${nextYearLabel}.`);
    lines.push(statement.householdsCarrying
        ? `Carry a balance for ${plural(statement.householdsCarrying, 'household', 'households')}.`
        : 'Carry nothing: no household has a balance to carry.');
    return (
        <div className="yer-statement" data-testid="start-statement">
            <p><b>Start {nextYearLabel} will</b>, in one step:</p>
            <ul>{lines.map(line => <li key={line}>{line}</li>)}</ul>
            <p className="yer-hint">It writes two documents together: {sourceLabel}, marked as rolled over, and the new {nextYearLabel} year with members, the invoice template and payment methods copied. {sourceLabel}’s bills and payments are not changed.</p>
        </div>
    );
}

function timeOf(value) {
    if (!value) return '';
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** The commit outcome as the page reports it (spec § Outcomes). */
function Outcome({ outcome, sourceLabel, nextYearLabel, onRetry, onRecheck, onOpen, onDiscard, onReload, canRetry }) {
    const discard = <button type="button" className="btn btn-header-secondary" onClick={onDiscard}>Discard draft</button>;
    switch (outcome.state) {
        case 'failed':
            return (
                <div className="yer-alert yer-alert--error" role="alert">
                    <p><b>{nextYearLabel} was not created.</b> {outcome.offline ? outcome.cause : <>Nothing was saved and your draft is kept. {outcome.cause}</>}</p>
                    <div className="yer-alert-acts">{discard}{outcome.retry !== false && <button type="button" className="btn btn-ink" disabled={!canRetry} onClick={onRetry}>Retry</button>}</div>
                </div>
            );
        case 'elsewhere':
            return (
                <div className="yer-alert yer-alert--error" role="alert">
                    <p><b>{outcome.yearId} already exists.</b> It was started elsewhere{timeOf(outcome.createdAt)}, so nothing was changed here and your draft is kept. Open {outcome.yearId} to continue there, or discard this draft.</p>
                    <div className="yer-alert-acts">{discard}<button type="button" className="btn btn-ink" onClick={onOpen}>Open {outcome.yearId}</button></div>
                </div>
            );
        case 'diverged':
            return (
                <div className="yer-alert yer-alert--error" role="alert">
                    <p><b>{outcome.yearId} was started from this draft on another tab with different entries.</b> Nothing was changed here and your draft is kept; its entries were not the ones saved.</p>
                    {outcome.differences.length > 0 && <ul className="yer-notices">{outcome.differences.map(text => <li key={text}>{text}</li>)}</ul>}
                    <div className="yer-alert-acts">{discard}<button type="button" className="btn btn-ink" onClick={onOpen}>Open {outcome.yearId}</button></div>
                </div>
            );
        case 'stale':
            return (
                <div className="status-banner status-banner--warning" role="alert">
                    <p><b>{sourceLabel} changed after this preview, so nothing was saved.</b> Your draft is kept. Reload to load today’s {sourceLabel}: every figure is recomputed and you check them again before Start.</p>
                    <div className="yer-alert-acts"><button type="button" className="btn btn-ink" onClick={onReload}>Reload</button></div>
                </div>
            );
        case 'uncertain':
            return outcome.checked ? (
                <div className="yer-alert yer-alert--error" role="alert">
                    <p><b>{nextYearLabel} was not created.</b> The connection dropped while starting; a check found nothing was saved. Your draft is kept.</p>
                    <div className="yer-alert-acts">{discard}<button type="button" className="btn btn-ink" disabled={!canRetry} onClick={onRetry}>Retry</button></div>
                </div>
            ) : (
                <div className="status-banner status-banner--warning" role="alert">
                    <p><b>We can’t tell yet whether {nextYearLabel} was created.</b> The connection dropped after Start was sent. Your draft is kept. Check again before trying anything else; checking never writes {nextYearLabel} twice. Editing the draft is paused until then.</p>
                    <div className="yer-alert-acts"><button type="button" className="btn btn-ink" disabled={!canRetry} onClick={onRecheck}>Check again</button></div>
                </div>
            );
        default:
            return null;
    }
}

/**
 * @param {{ review: Object, source: Object, nextYearLabel: string, preview: Object, gate: Object,
 *   commit: Object, billingYears: Array, reopenedAdjustmentIds: Set, nothingChanged: boolean,
 *   onGo: (step: number) => void, onOpenYear: () => void, onDiscard: () => void }} props
 */
export default function ReviewStep({ review, source, nextYearLabel, preview, gate, commit, billingYears, reopenedAdjustmentIds,
    nothingChanged, onGo, onOpenYear, onDiscard, onReload }) {
    const sourceLabel = source.sourceYear.label;
    const locked = commit.locked;
    // Edit links wait while an earlier attempt is unresolved (Check again re-sends that attempt).
    const editLocked = locked || commit.unresolved;
    const pending = gate.pending;
    const households = householdsOf(source.familyMembers);
    const previews = preview.ok ? preview.households : [];
    const byPrimary = id => previews.find(row => String(row.primaryMemberId ?? row.householdId) === String(id));
    const totals = preview.ok ? preview.totals : null;
    const conflict = commit.outcome && ['elsewhere', 'diverged'].includes(commit.outcome.state);
    const ctx = { sourceLabel, nextYearLabel, familyMembers: source.familyMembers, pending, onEdit: onGo, locked: editLocked, source, reopenedAdjustmentIds };
    // During and after a commit the years list includes the year being started; the label is not editable then.
    const error = locked || conflict || commit.unresolved ? null : labelError(review.draft.nextYearLabel, billingYears);
    return (
        <section aria-labelledby="yer-step-4" data-testid="year-end-review-step-4">
            <h2 id="yer-step-4" className="yer-step-title">Review &amp; start {nextYearLabel}</h2>
            {nothingChanged && (
                <div className="yer-ok" role="status">
                    <p><b>Nothing changed in {sourceLabel}.</b> You confirmed: no bill price changes or ended bills · no new subscriptions · no additional member charges. What already carries is still listed below, and nothing new is recorded.</p>
                    <div className="yer-hh-acts">
                        <button type="button" className="btn btn-sm btn-header-secondary" disabled={editLocked} onClick={() => onGo(1)}>Edit bills</button>
                        <button type="button" className="btn btn-sm btn-header-secondary" disabled={editLocked} onClick={() => onGo(2)}>Edit subscriptions</button>
                        <button type="button" className="btn btn-sm btn-header-secondary" disabled={editLocked} onClick={() => onGo(3)}>Edit charges</button>
                    </div>
                </div>
            )}
            {totals && (
                <div className="yer-kpis" data-testid="review-figures">
                    <Figure label={`${sourceLabel} bills`} value={money(totals.sourceBillTotal)} sub={`what ${sourceLabel} subscriptions cost`} />
                    <Figure label={`${nextYearLabel} bills`} value={money(totals.nextBillTotal)} sub={`${signedMoney(totals.subscriptionDelta)} subscriptions vs ${sourceLabel}`} pending={pending} />
                    <Figure label={`Carried from ${sourceLabel}`} value={signedMoney(totals.carriedTotal)} sub="catch-up charges less credits" pending={pending} credit={totals.carriedTotal < 0} />
                    <Figure label={`First ${nextYearLabel} invoices`} value={money(totals.firstInvoiceTotal)} sub={plural(totals.households, 'household', 'households')} pending={pending} />
                </div>
            )}
            <p className="yer-hint yer-baseline">Per household: what {sourceLabel} subscriptions cost, what {nextYearLabel}’s cost at their new prices, and what carries over—catch-up charges and credits are shown apart from price changes, never folded into them.</p>
            {!preview.ok && <p className="yer-error" role="alert">The preview could not be computed: {preview.error}</p>}
            <ul className="yer-list yer-hhs">
                {households.map(household => <HouseholdCard key={household.id} household={household} preview={byPrimary(household.id)} ctx={ctx} />)}
            </ul>

            <div className="yer-start" data-testid="start-card">
                <div className="yer-label-row">
                    <div className="payment-field-group yer-field">
                        <label className="yer-label" htmlFor="yer-next-label">New billing year label</label>
                        <input id="yer-next-label" className="composer-input" value={review.draft.nextYearLabel} disabled={locked || conflict || commit.unresolved}
                            aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'yer-next-label-error' : 'yer-next-label-hint'}
                            onChange={event => review.actions.setNextYearLabel(event.target.value)} />
                        {error
                            ? <p className="yer-error" id="yer-next-label-error" role="alert">{error}</p>
                            : <p className="yer-hint" id="yer-next-label-hint">Suggested from {sourceLabel}; must not already exist.</p>}
                    </div>
                </div>
                {preview.ok && <Statement statement={preview.statement} sourceLabel={sourceLabel} nextYearLabel={nextYearLabel} />}
                {commit.outcome && (
                    <Outcome outcome={commit.outcome} sourceLabel={sourceLabel} nextYearLabel={nextYearLabel}
                        onRetry={() => commit.start()} onRecheck={() => commit.start()} onOpen={onOpenYear} onDiscard={onDiscard} onReload={onReload} canRetry={gate.canStart} />
                )}
                {!locked && !conflict && gate.blockers.length > 0 && (
                    <div className="status-banner status-banner--warning yer-blockers" data-testid="start-blockers">
                        <p><b>Start is off:</b> {plural(gate.blockers.length, 'item needs', 'items need')} attention.{pending ? ' The figures above are pending until then.' : ''}</p>
                        <ul>
                            {gate.blockers.map((blocker, index) => (
                                <li key={index}>
                                    {blocker.message}{' '}
                                    {blocker.step >= 1 && blocker.step <= 3 && (
                                        <button type="button" className="yer-link" onClick={() => onGo(blocker.step)}>Go to Step {blocker.step}: {STEP_NAMES[blocker.step]}</button>
                                    )}
                                    {blocker.accept && (
                                        <button type="button" className="btn btn-sm" onClick={() => { review.actions.acceptSourceFingerprint(); commit.clearOutcome(); }}>I’ve checked the updated figures</button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {!conflict && !(commit.outcome && ['failed', 'uncertain'].includes(commit.outcome.state) && !locked) && (
                    <div className="yer-start-acts">
                        <button type="button" className="btn btn-primary yer-start-btn" disabled={locked || !gate.canStart} onClick={() => commit.start()}>
                            {locked ? `Starting ${nextYearLabel}…` : `Start ${nextYearLabel}`}
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
}
