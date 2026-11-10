/**
 * Step 3 — Member charges. Per household, the existing deferred Usage Charges
 * are prefilled read-only ("already recorded, carried once", never re-recorded)
 * and Add charge opens a composer with the Usage Charge validation. Charges
 * added here live only in the draft until Start (#609).
 */
import { useState } from 'react';
import { localDateString } from '../../../lib/validation.js';
import { Field, NumberField } from './fields.jsx';
import { deferredCharges, formatDate, householdsOf, memberName, money } from './yearEndReviewModel.js';

function Composer({ household, onAdd, onCancel }) {
    const [memberId, setMemberId] = useState(household.members[0].id);
    const [amount, setAmount] = useState(null);
    const [description, setDescription] = useState('');
    const [incurredDate, setIncurredDate] = useState(localDateString());
    const [errors, setErrors] = useState({});
    const key = String(household.id);
    function submit(event) {
        event.preventDefault();
        const next = {};
        if (!(typeof amount === 'number' && amount > 0)) next.amount = 'Enter an amount greater than zero.';
        if (!description.trim()) next.description = 'Enter a description.';
        if (!incurredDate) next.incurredDate = 'Choose the date this charge was incurred.';
        setErrors(next);
        if (Object.keys(next).length) return;
        onAdd({ memberId, amount, description, incurredDate });
    }
    return (
        <form className="yer-composer" onSubmit={submit} aria-label={`Add charge for ${household.name}`} noValidate>
            <div className="yer-grid4">
                <Field id={`charge-member-${key}`} label="Member">
                    <select id={`charge-member-${key}`} className="composer-input" value={memberId} onChange={event => setMemberId(household.members.find(member => String(member.id) === event.target.value).id)}>
                        {household.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                    </select>
                </Field>
                <NumberField id={`charge-amount-${key}`} label="Amount ($)" value={amount} placeholder="0.00" onChange={setAmount} error={errors.amount} />
                <Field id={`charge-date-${key}`} label="Date incurred" error={errors.incurredDate}>
                    <input id={`charge-date-${key}`} className="composer-input" type="date" value={incurredDate} onChange={event => setIncurredDate(event.target.value)} />
                </Field>
                <Field id={`charge-desc-${key}`} label="Description" error={errors.description}>
                    <input id={`charge-desc-${key}`} className="composer-input" type="text" value={description} placeholder="e.g. Roaming overage" onChange={event => setDescription(event.target.value)} />
                </Field>
            </div>
            <div className="yer-composer-foot">
                <span className="yer-hint">Recorded when you start the new year, not now. Amount and description are required.</span>
                <span className="yer-composer-btns">
                    <button type="button" className="btn btn-sm btn-header-secondary" onClick={onCancel}>Cancel</button>
                    <button type="submit" className="btn btn-sm btn-ink">Add to review</button>
                </span>
            </div>
        </form>
    );
}

export default function ChargesStep({ review, source, nextYearLabel }) {
    const { draft, actions } = review;
    const [composerFor, setComposerFor] = useState(null);
    const households = householdsOf(source.familyMembers);
    const deferred = deferredCharges(source.owedAdjustments);
    return (
        <section aria-labelledby="yer-step-3">
            <h2 id="yer-step-3" className="yer-step-title">Member charges</h2>
            <div className="yer-bar">
                <p className="yer-hint">Charges members ran up during {source.sourceYear.label} that were never billed. Deferred charges already on record are listed and carried once; add anything that is missing. Nothing is recorded until you start {nextYearLabel}.</p>
            </div>
            {draft.charges.length === 0 && (
                <label className="checkbox-item yer-confirm">
                    <input type="checkbox" checked={draft.confirmations.noExtraCharges} onChange={event => actions.setConfirmation('noExtraCharges', event.target.checked)} />
                    No additional member charges
                </label>
            )}
            {households.map(household => {
                const ids = new Set(household.members.map(member => member.id));
                const recorded = deferred.filter(record => ids.has(record.memberId));
                const added = draft.charges.filter(row => ids.has(row.memberId));
                return (
                    <div key={household.id} className="yer-household" data-testid={'household-' + household.id}>
                        <div className="yer-household-head">
                            <div>
                                <strong>{household.name}</strong>
                                <div className="yer-sub">{household.individual ? 'Individual' : `${household.members.length} members`}{recorded.length + added.length === 0 ? ' · no charges' : ''}</div>
                            </div>
                            {composerFor !== household.id && (
                                <button type="button" className="btn btn-sm" onClick={() => setComposerFor(household.id)} aria-label={`Add charge for ${household.name}`}>Add charge</button>
                            )}
                        </div>
                        {recorded.map(record => (
                            <div key={record.id} className="yer-charge">
                                <div className="yer-charge-main">
                                    <strong>{memberName(source.familyMembers, record.memberId)}</strong> · {record.description}
                                    <div className="yer-sub">{formatDate(record.incurredDate)} · already recorded, carried once</div>
                                </div>
                                <span className="yer-num">{money(record.amount)}</span>
                                <span className="status-badge status-badge--partial">Deferred</span>
                            </div>
                        ))}
                        {added.map(row => (
                            <div key={row.rowId} className="yer-charge" data-testid={'charge-' + row.rowId}>
                                <div className="yer-charge-main">
                                    <strong>{memberName(source.familyMembers, row.memberId)}</strong> · {row.description}
                                    <div className="yer-sub">{formatDate(row.incurredDate)} · recorded when you start {nextYearLabel}</div>
                                </div>
                                <span className="yer-num">{money(row.amount)}</span>
                                <button type="button" className="btn btn-sm btn-header-secondary" onClick={() => actions.removeCharge(row.rowId)} aria-label={`Remove ${row.description}`}>Remove</button>
                            </div>
                        ))}
                        {composerFor === household.id && (
                            <Composer household={household} onCancel={() => setComposerFor(null)}
                                onAdd={charge => { actions.addCharge(charge); setComposerFor(null); }} />
                        )}
                    </div>
                );
            })}
        </section>
    );
}
