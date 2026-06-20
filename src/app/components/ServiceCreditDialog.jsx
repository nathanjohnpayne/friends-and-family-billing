/**
 * ServiceCreditDialog — issue a Service Credit against a bill (#321, ADR 0005).
 *
 * A Service Credit is the `−owed` mirror of a Usage Charge: a bill-level reduction
 * for a service that was canceled, reduced, discounted, or had an issue. It takes
 * effect immediately — it LOWERS the affected members' owed, and when a member has
 * already paid the surplus surfaces as a household Credit on the existing
 * refund/carry pipeline (no new disposition path). It does NOT edit the bill
 * (Option B): the bill's amount and history stay honest.
 *
 * The dialog is bill-scoped: it confirms the bill being credited, captures amount,
 * reason, and incurred date, and offers a bill-level split (default — divided among
 * the bill's members) vs a per-member variant (the whole amount on one member, for a
 * one-person issue). On submit it calls onSubmit with { amount, reason, incurredDate }
 * for the bill-level case, plus `memberId` for the per-member case. Errors from the
 * host are shown inline and the dialog stays open (mirrors UsageChargeDialog and the
 * #318 refund dialog — errors are never swallowed).
 */
import { useEffect, useState } from 'react';
import { localDateString } from '../../lib/validation.js';

/**
 * @param {{
 *   open: boolean,
 *   bill: { id: *, name: string, members?: Array },
 *   billMembers: Array<{ id: *, name: string }>,
 *   onSubmit: (data: { amount: number, reason: string, incurredDate: string, memberId?: * }) => void,
 *   onClose: () => void
 * }} props
 */
export default function ServiceCreditDialog({ open, bill, billMembers = [], onSubmit, onClose }) {
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [incurredDate, setIncurredDate] = useState(localDateString());
    // 'bill' (default — split among the bill's members) or 'member' (one member).
    const [scope, setScope] = useState('bill');
    const [memberId, setMemberId] = useState('');
    const [error, setError] = useState('');

    // Reset fields whenever the dialog (re)opens. Default the per-member select to
    // the first bill member so the per-member path always has a valid target.
    useEffect(() => {
        if (open) {
            setAmount('');
            setReason('');
            setIncurredDate(localDateString());
            setScope('bill');
            setMemberId(billMembers.length > 0 ? String(billMembers[0].id) : '');
            setError('');
        }
    }, [open, bill, billMembers]);

    // Close on Escape.
    useEffect(() => {
        if (!open) return;
        function handleKey(e) {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    if (!open) return null;

    function handleSubmit(e) {
        e.preventDefault();
        setError('');
        const amt = parseFloat(amount);
        if (!amt || amt <= 0) {
            setError('Enter an amount greater than zero.');
            return;
        }
        if (!reason.trim()) {
            setError('Enter a reason.');
            return;
        }
        if (!incurredDate) {
            setError('Choose the date this credit applies.');
            return;
        }
        const data = { amount: amt, reason: reason.trim(), incurredDate };
        if (scope === 'member') {
            if (memberId === '' || memberId === null || memberId === undefined) {
                setError('Choose the member to credit.');
                return;
            }
            // Match the stored member id type: bill member ids are numbers here.
            const numeric = Number(memberId);
            data.memberId = Number.isNaN(numeric) ? memberId : numeric;
        }
        try {
            onSubmit(data);
            onClose();
        } catch (err) {
            setError(err.message);
        }
    }

    function handleOverlayClick(e) {
        if (e.target === e.currentTarget) onClose();
    }

    return (
        <div className="dialog-overlay visible" onClick={handleOverlayClick} role="presentation">
            <div className="dialog" role="dialog" aria-modal="true" aria-label="Issue Service Credit">
                <div className="dialog-title">Issue Service Credit</div>
                <form onSubmit={handleSubmit}>
                    <p className="payment-dialog-for">
                        For bill: <strong>{bill ? bill.name : ''}</strong>
                    </p>
                    <p className="share-hint">
                        Lowers the owed for the affected members for a service that was canceled,
                        reduced, or had an issue. This does not change the bill itself.
                    </p>
                    <div className="payment-dialog-fields">
                        <div className="payment-field-group">
                            <label htmlFor="service-credit-amount">Amount ($)</label>
                            <input
                                id="service-credit-amount"
                                className="composer-input"
                                type="number"
                                step="0.01"
                                min="0.01"
                                placeholder="0.00"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="payment-field-group">
                            <label htmlFor="service-credit-reason">Reason</label>
                            <input
                                id="service-credit-reason"
                                className="composer-input"
                                type="text"
                                placeholder="e.g. Service outage credit"
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                            />
                        </div>
                        <div className="payment-field-group">
                            <label htmlFor="service-credit-date">Incurred date</label>
                            <input
                                id="service-credit-date"
                                className="composer-input"
                                type="date"
                                value={incurredDate}
                                onChange={e => setIncurredDate(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Apply-to choice: whole bill (split) vs a single member. */}
                    <fieldset className="service-credit-scope">
                        <legend className="service-credit-scope-legend">Apply to</legend>
                        <div className="checkbox-item">
                            <input
                                type="radio"
                                id="service-credit-scope-bill"
                                name="service-credit-scope"
                                checked={scope === 'bill'}
                                onChange={() => setScope('bill')}
                            />
                            <label htmlFor="service-credit-scope-bill">
                                Whole bill (split among {bill && bill.members ? bill.members.length : billMembers.length} members)
                            </label>
                        </div>
                        <div className="checkbox-item">
                            <input
                                type="radio"
                                id="service-credit-scope-member"
                                name="service-credit-scope"
                                checked={scope === 'member'}
                                onChange={() => setScope('member')}
                            />
                            <label htmlFor="service-credit-scope-member">A specific member</label>
                        </div>
                        {scope === 'member' && (
                            <div className="payment-field-group">
                                <label htmlFor="service-credit-member">Member</label>
                                <select
                                    id="service-credit-member"
                                    className="composer-input"
                                    value={memberId}
                                    onChange={e => setMemberId(e.target.value)}
                                >
                                    {billMembers.map(m => (
                                        <option key={m.id} value={String(m.id)}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </fieldset>

                    {error && <p className="composer-error">{error}</p>}
                    <div className="dialog-buttons">
                        <button type="button" className="btn btn-sm btn-header-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-sm btn-primary">Save Credit</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
