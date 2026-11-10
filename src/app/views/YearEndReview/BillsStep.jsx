/**
 * Step 1 — Bills. Every source bill defaults to Unchanged; a price change or an
 * end computes its True-up or Service Credit through the reconciliation library
 * (src/lib/year-end-review.js) and shows the formula and per-member split beside
 * the amount. Existing Service Credits on the bill are answered per record with
 * no default (spec § True-up and Service Credit math).
 */
import { useMemo } from 'react';
import CompanyLogo from '../../components/CompanyLogo.jsx';
import { toCents } from '../../../lib/year-end-review.js';
import { MonthSelect, NumberField, Segmented } from './fields.jsx';
import { formatDate, memberName, money, monthOptions, unitOf } from './yearEndReviewModel.js';

const CHANGES = [
    { value: 'unchanged', label: 'Unchanged' },
    { value: 'price_change', label: 'Price changed' },
    { value: 'ended', label: 'Ended' }
];

function Pill({ kind, children }) {
    return <span className={'status-badge ' + (kind === 'credit' ? 'status-badge--credit' : 'status-badge--partial')}>{children}</span>;
}

function SplitChips({ result, familyMembers }) {
    return (
        <ul className="yer-split" aria-label="Per-member split">
            {result.shares.map(share => (
                <li key={share.memberId} className="yer-chip">
                    {memberName(familyMembers, share.memberId)} <b className="yer-num">{money(share.netCents / 100)}</b>
                </li>
            ))}
        </ul>
    );
}

function CalcPanel({ item, bill, familyMembers, next }) {
    const result = item.result || item.base;
    if (!result) return null;
    if (result.zeroReason === 'no_members') {
        return <div className="yer-calc" data-testid={'calc-' + bill.id}><p className="yer-note" role="status">{item.note}</p></div>;
    }
    const credit = result.kind === 'service_credit';
    const zero = item.result ? result.grossCents === 0 : false;
    const months = result.calc.months;
    return (
        <div className="yer-calc" data-testid={'calc-' + bill.id}>
            <div className="yer-calc-head">
                <Pill kind={credit ? 'credit' : 'trueup'}>{zero ? 'Nothing to record' : `${credit ? 'Service credit' : 'True-up'} · ${money(result.calc.recorded)}`}</Pill>
                <span className="yer-sub">{months} {months === 1 ? 'month' : 'months'} {credit ? 'unused' : 'under-billed'}</span>
            </div>
            <p className="yer-formula yer-num">{result.formula}</p>
            {!zero && item.result && <SplitChips result={result} familyMembers={familyMembers} />}
            {item.note && <p className="yer-note" role="status">{item.note}</p>}
            {item.result && result.billOutcome === 'omitted' && !item.note && <p className="yer-hint">Left out of {next}.</p>}
        </div>
    );
}

function ExistingCredits({ billId, item, bill, familyMembers, onAnswer, sourceLabel }) {
    const groups = useMemo(() => {
        const map = new Map();
        for (const entry of item.credits) {
            const key = (entry.record.reason || '') + '|' + (entry.record.incurredDate || '');
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(entry);
        }
        return [...map.values()];
    }, [item.credits]);
    if (!item.credits.length) return null;
    const result = item.result;
    return (
        <div className="yer-credits" data-testid={'credits-' + billId}>
            <h4>Credits already on this bill in {sourceLabel}</h4>
            <p className="yer-hint">Answer for each credit, per member: Covers this change (all of it), Covers in part… (enter how much), or Unrelated. Next stays off until every one has an answer; the credits themselves are never changed.</p>
            {groups.map(group => {
                const first = group[0].record;
                const total = group.reduce((sum, entry) => sum + entry.amountCents, 0);
                return (
                    <div key={first.id} className="yer-credit-group">
                        <p className="yer-credit-title">
                            {formatDate(first.incurredDate)} · “{first.reason}” · {money(total / 100)} {group.length > 1 ? `across ${group.length} members` : memberName(familyMembers, first.memberId) + ' only'}
                        </p>
                        {group.map(entry => {
                            const name = memberName(familyMembers, entry.record.memberId);
                            const answer = entry.answer;
                            const tooBig = entry.amountCents > entry.remainingCents;
                            const choice = answer ? answer.choice : null;
                            const partialId = `partial-${bill.id}-${entry.record.id}`;
                            const cap = Math.min(entry.remainingCents, entry.amountCents - 1);
                            let partialError = null;
                            if (choice === 'partial' && answer.appliedCents !== undefined) {
                                if (answer.appliedCents > entry.remainingCents) partialError = `Enter at most ${money(entry.remainingCents / 100)} (${name}’s remaining share).`;
                                else if (answer.appliedCents >= entry.amountCents) partialError = `Enter less than the credit (${money(entry.amountCents / 100)}); a full amount is “Covers this change”.`;
                            }
                            return (
                                <div key={entry.record.id} className="yer-credit-row" role="group" aria-label={`${name}’s ${money(entry.amountCents / 100)} credit from ${formatDate(entry.record.incurredDate)}`}>
                                    <div className="yer-credit-who">
                                        <strong>{name}</strong> <span className="yer-num">{money(entry.amountCents / 100)}</span>
                                        {tooBig && <div className="yer-hint">larger than {name}’s remaining {money(Math.max(0, entry.remainingCents) / 100)}, so “Covers this change” is unavailable</div>}
                                        {(entry.flag || entry.message) && <div className="yer-error">{entry.flag || entry.message}</div>}
                                    </div>
                                    <Segmented
                                        label={`Does ${name}’s credit cover this change?`}
                                        value={choice}
                                        onChange={value => onAnswer(entry.record.id, value, value === 'partial' ? answer?.appliedCents : undefined)}
                                        options={[
                                            { value: 'covers', label: 'Covers this change', disabled: tooBig, title: tooBig ? `larger than ${name}’s remaining ${money(Math.max(0, entry.remainingCents) / 100)}` : undefined },
                                            { value: 'partial', label: 'Covers in part…' },
                                            { value: 'unrelated', label: 'Unrelated' }
                                        ]}
                                    />
                                    {choice === 'partial' && (
                                        <NumberField
                                            id={partialId}
                                            label="Covering amount ($)"
                                            value={answer.appliedCents !== undefined ? answer.appliedCents / 100 : undefined}
                                            placeholder="0.00"
                                            onChange={value => onAnswer(entry.record.id, 'partial', value === null || value <= 0 ? undefined : toCents(value))}
                                            error={partialError}
                                            hint={`At most ${money(Math.max(0, cap) / 100)} (${name}’s remaining share, and less than the credit).`}
                                            width="9rem"
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
            {result && result.shares.length > 0 && (
                <div className="yer-credit-preview" role="status">
                    <p className="yer-formula yer-num">
                        {`${money(result.calc.gross)} ${result.calc.overridden ? 'entered' : 'computed'} − ${money(result.calc.alreadyCreditedCents / 100)} covered by earlier credits = ${money(result.calc.recorded)} to record`}
                    </p>
                    <p className="yer-hint">
                        {result.shares.map(share => `${memberName(familyMembers, share.memberId)} ${money(share.netCents / 100)}`).join(' · ')}
                        {result.grossCents > 0 ? ` → ${money(result.grossCents / 100)} across ${result.shares.filter(share => share.netCents > 0).length} members` : ''}
                    </p>
                </div>
            )}
        </div>
    );
}

function BillRow({ bill, row, item, ctx, actions }) {
    const { familyMembers, sourceLabel, nextYearLabel, months } = ctx;
    const unit = unitOf(bill);
    const change = row.change || 'unchanged';
    const set = patch => actions.setBillField(bill.id, patch);
    const errors = item.errors;
    const nextField = (
        <NumberField
            id={`next-${bill.id}`}
            label={`${nextYearLabel} price / ${unit}`}
            value={item.nextYearAmount ?? undefined}
            onChange={value => set({ nextYearAmount: value === null ? undefined : value })}
            error={errors.nextYearAmount}
            width="8rem"
        />
    );
    const overrideLabel = change === 'ended' || (item.base && item.base.kind === 'service_credit') ? 'Service credit ($)' : 'True-up amount ($)';
    const lockedZero = item.result && item.result.grossCents === 0 && (item.result.outcome === 'covered' || item.result.outcome === 'no_members');
    return (
        <li className={'yer-bill yer-bill--' + change} data-testid={'bill-' + bill.id} aria-label={bill.name}>
            <div className="yer-bill-head">
                <CompanyLogo logo={bill.logo} website={bill.website} name={bill.name} size={36} />
                <div className="yer-bill-title">
                    <strong>{bill.name}</strong>
                    <span className="yer-sub">{money(bill.amount)} / {unit} · {bill.members.length} {bill.members.length === 1 ? 'member' : 'members'} · {sourceLabel}</span>
                </div>
                <Segmented label={`${bill.name}: what changed in ${sourceLabel}`} value={change} options={CHANGES} onChange={value => set({ change: value })} />
                {change === 'unchanged' && (
                    <div className="yer-inline-next">{nextField}</div>
                )}
            </div>
            {change === 'price_change' && (
                <div className="yer-bill-body">
                    <div className="yer-grid3">
                        <NumberField id={`new-${bill.id}`} label={`New price / ${unit}`} value={row.newAmount} onChange={value => set({ newAmount: value === null ? undefined : value })} error={errors.newAmount} />
                        <MonthSelect id={`first-${bill.id}`} label="First month billed at it" value={row.firstMonth} options={months} onChange={value => set({ firstMonth: value })} error={errors.firstMonth} />
                        <NumberField id={`override-${bill.id}`} label={overrideLabel} value={row.override} placeholder={item.base ? item.base.calc.computed.toFixed(2) : ''} onChange={value => set({ override: value === null ? undefined : value })} error={errors.override} hint="Leave blank to use the computed amount." disabled={lockedZero} />
                    </div>
                    {row.firstMonth && row.firstMonth.endsWith('-01') && <p className="yer-hint">This bills all twelve months at the new price.</p>}
                    {errors._ && <p className="yer-error" role="alert">{errors._}</p>}
                    <CalcPanel item={item} bill={bill} familyMembers={familyMembers} next={nextYearLabel} />
                    <ExistingCredits billId={bill.id} item={item} bill={bill} familyMembers={familyMembers} sourceLabel={sourceLabel}
                        onAnswer={(adjustmentId, choice, applied) => actions.answerCredit(bill.id, adjustmentId, choice, applied)} />
                </div>
            )}
            {change === 'ended' && (
                <div className="yer-bill-body">
                    <div className="yer-grid3">
                        <MonthSelect id={`last-${bill.id}`} label="Last month of service" value={row.lastMonth} options={months} onChange={value => set({ lastMonth: value })} error={errors.lastMonth} />
                        <NumberField id={`override-${bill.id}`} label={overrideLabel} value={row.override} placeholder={item.base ? item.base.calc.computed.toFixed(2) : ''} onChange={value => set({ override: value === null ? undefined : value })} error={errors.override} hint="Leave blank to use the computed amount." disabled={lockedZero} />
                        <div className="payment-field-group yer-field">
                            <span className="yer-label">Next year</span>
                            <div className="yer-locked">Left out of {nextYearLabel}</div>
                        </div>
                    </div>
                    {errors._ && <p className="yer-error" role="alert">{errors._}</p>}
                    <CalcPanel item={item} bill={bill} familyMembers={familyMembers} next={nextYearLabel} />
                    <ExistingCredits billId={bill.id} item={item} bill={bill} familyMembers={familyMembers} sourceLabel={sourceLabel}
                        onAnswer={(adjustmentId, choice, applied) => actions.answerCredit(bill.id, adjustmentId, choice, applied)} />
                </div>
            )}
            {change === 'price_change' && (
                <div className="yer-next">
                    {nextField}
                    <span className="yer-hint">Defaults to the new price.</span>
                </div>
            )}
        </li>
    );
}

export default function BillsStep({ review, source, nextYearLabel }) {
    const { draft, derived, actions } = review;
    const sourceLabel = source.sourceYear.label;
    const months = useMemo(() => monthOptions(sourceLabel), [sourceLabel]);
    const errors = review.stepErrors[1];
    const { summary } = derived;
    const changedCount = summary.priceChanges + summary.ended;
    const ctx = { familyMembers: source.familyMembers, sourceLabel, nextYearLabel, months };
    return (
        <section aria-labelledby="yer-step-1">
            <h2 id="yer-step-1" className="yer-step-title">Bills</h2>
            <div className="yer-bar">
                <p className="yer-hint">Every bill starts Unchanged. Mark the ones whose price changed or that ended during {sourceLabel}, and confirm each bill’s {nextYearLabel} price.</p>
                <button type="button" className="btn btn-sm" onClick={actions.markNoPriceChanges}>No price changes this year</button>
            </div>
            {draft.confirmations.noBillChanges && changedCount === 0 && (
                <p className="yer-confirmed" role="status">Confirmed: no closing-year bill changes.</p>
            )}
            {source.bills.length === 0 && <p className="yer-hint">There are no bills in {sourceLabel}.</p>}
            <ul className="yer-list">
                {source.bills.map(bill => (
                    <BillRow key={bill.id} bill={bill} row={draft.bills[bill.id] || { change: 'unchanged' }} item={derived.bills[bill.id]} ctx={ctx} actions={actions} />
                ))}
            </ul>
            {errors.length === 0 && source.bills.length > 0 && (
                <div className="yer-summary" role="status">
                    <b>{summary.priceChanges} price {summary.priceChanges === 1 ? 'change' : 'changes'} · {summary.ended} ended · {summary.unchanged} unchanged.</b>{' '}
                    {summary.trueUpCents > 0 && `True-ups ${money(summary.trueUpCents / 100)} across ${summary.trueUpShares} member shares. `}
                    {summary.creditCents > 0 && `Service credits ${money(summary.creditCents / 100)} across ${summary.creditShares} member shares${summary.coveredCents > 0 ? ` (${money(summary.coveredCents / 100)} already covered by earlier credits)` : ''}. `}
                    Nothing is recorded yet.
                </div>
            )}
        </section>
    );
}
