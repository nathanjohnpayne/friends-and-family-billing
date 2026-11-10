/**
 * Step 2 — New subscriptions. Empty by default and fast to skip. A row is a
 * subscription that started during the closing year and was never billed: it
 * computes a late-start True-up and creates next year's bill. Its `billId` is
 * allocated once when the row is created and stored on the draft.
 */
import { useMemo } from 'react';
import { MonthSelect, NumberField, Segmented, Field } from './fields.jsx';
import { memberName, money, monthOptions } from './yearEndReviewModel.js';

function NewBillRow({ row, item, source, nextYearLabel, months, actions }) {
    const set = patch => actions.updateNewBill(row.rowId, patch);
    const errors = item.errors;
    const result = item.result;
    const unit = row.frequency === 'annual' ? 'year' : 'month';
    const toggleMember = memberId => {
        const members = row.members.includes(memberId) ? row.members.filter(id => id !== memberId) : [...row.members, memberId];
        set({ members });
    };
    return (
        <li className="yer-bill yer-bill--price" data-testid={'new-' + row.rowId}>
            <div className="yer-bill-head">
                <div className="yer-bill-title">
                    <strong>{row.name.trim() || 'New subscription'}</strong>
                    <span className="yer-sub">{row.website ? row.website.replace(/^https?:\/\//, '') + ' · ' : ''}new in {source.sourceYear.label}</span>
                </div>
                <button type="button" className="btn btn-sm btn-header-secondary" onClick={() => actions.removeNewBill(row.rowId)} aria-label={`Remove ${row.name.trim() || 'new subscription'}`}>Remove</button>
            </div>
            <div className="yer-bill-body">
                <div className="yer-grid3">
                    <Field id={`new-name-${row.rowId}`} label="Name" error={errors.name}>
                        <input id={`new-name-${row.rowId}`} className="composer-input" type="text" value={row.name} aria-invalid={errors.name ? 'true' : undefined}
                            onChange={event => set({ name: event.target.value })} />
                    </Field>
                    <NumberField id={`new-amount-${row.rowId}`} label={`Price / ${unit}`} value={row.amount} onChange={value => set({ amount: value === null ? undefined : value })} error={errors.amount} />
                    <div className="payment-field-group yer-field">
                        <span className="yer-label">Billed</span>
                        <Segmented label="Billing frequency" value={row.frequency} onChange={value => set({ frequency: value })}
                            options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }]} />
                    </div>
                </div>
                <div className="yer-grid3">
                    <Field id={`new-site-${row.rowId}`} label="Website (for the logo, optional)">
                        <input id={`new-site-${row.rowId}`} className="composer-input" type="text" value={row.website} placeholder="https://example.com"
                            onChange={event => set({ website: event.target.value })} />
                    </Field>
                    <MonthSelect id={`new-first-${row.rowId}`} label="First month of service" value={row.firstMonth} options={months} onChange={value => set({ firstMonth: value })} error={errors.firstMonth} />
                    <NumberField id={`new-override-${row.rowId}`} label="True-up amount ($)" value={row.override} placeholder={result ? result.calc.computed.toFixed(2) : ''}
                        onChange={value => set({ override: value === null ? undefined : value })} error={errors.override} hint="Leave blank to use the computed amount." />
                </div>
                <fieldset className="yer-members">
                    <legend>Members</legend>
                    <div className="yer-member-grid">
                        {source.familyMembers.map(member => (
                            <label key={member.id} className="checkbox-item">
                                <input type="checkbox" checked={row.members.includes(member.id)} onChange={() => toggleMember(member.id)} />
                                {member.name}
                            </label>
                        ))}
                    </div>
                    {errors.members && <p className="yer-error" role="alert">{errors.members}</p>}
                </fieldset>
                {errors._ && <p className="yer-error" role="alert">{errors._}</p>}
                {result && (
                    <div className="yer-calc" data-testid={'calc-new-' + row.rowId}>
                        <div className="yer-calc-head">
                            <span className="status-badge status-badge--partial">True-up · {money(result.calc.recorded)}</span>
                            <span className="yer-sub">{result.calc.months} months of service in {source.sourceYear.label} never billed</span>
                        </div>
                        <p className="yer-formula yer-num">{result.formula}</p>
                        <ul className="yer-split" aria-label="Per-member split">
                            {result.shares.map(share => <li key={share.memberId} className="yer-chip">{memberName(source.familyMembers, share.memberId)} <b className="yer-num">{money(share.netCents / 100)}</b></li>)}
                        </ul>
                    </div>
                )}
            </div>
            <div className="yer-next">
                <span className="yer-label">{nextYearLabel} bill</span>
                <span>{row.name.trim() || 'New subscription'}{row.amount > 0 ? ` · ${money(row.amount)} / ${unit}` : ''}</span>
                <span className="yer-hint">Created in {nextYearLabel} with these members; absent from {source.sourceYear.label}’s bill list.</span>
            </div>
        </li>
    );
}

export default function NewSubscriptionsStep({ review, source, nextYearLabel }) {
    const { draft, derived, actions } = review;
    const months = useMemo(() => monthOptions(source.sourceYear.label), [source.sourceYear.label]);
    return (
        <section aria-labelledby="yer-step-2">
            <h2 id="yer-step-2" className="yer-step-title">New subscriptions</h2>
            <div className="yer-bar">
                <p className="yer-hint">Subscriptions that started during {source.sourceYear.label} and were never billed. Empty is the usual case—skip ahead if there are none.</p>
                <button type="button" className="btn btn-sm" onClick={actions.addNewBill}>Add subscription</button>
            </div>
            {draft.newBills.length === 0 && (
                <label className="checkbox-item yer-confirm">
                    <input type="checkbox" checked={draft.confirmations.noNewSubscriptions} onChange={event => actions.setConfirmation('noNewSubscriptions', event.target.checked)} />
                    No new subscriptions started in {source.sourceYear.label}
                </label>
            )}
            <ul className="yer-list">
                {draft.newBills.map(row => (
                    <NewBillRow key={row.rowId} row={row} item={derived.newBills[row.rowId]} source={source} nextYearLabel={nextYearLabel} months={months} actions={actions} />
                ))}
            </ul>
        </section>
    );
}
