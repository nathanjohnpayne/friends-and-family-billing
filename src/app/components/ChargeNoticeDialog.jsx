/**
 * ChargeNoticeDialog — preview and confirm an off-cycle Charge Notice (#320).
 *
 * The administrator off-cycle-bills a member's deferred Usage Charges as a single
 * invoice (the debit mirror of a Refund Notice). The dialog shows a preview of the
 * charges that will be billed, defaulting to ALL deferred charges with a "This
 * month" preset, and the combined total. Confirming bills those charges (deferred →
 * billed, raising the member's owed) and emails the member; the member pays via the
 * normal ledger or contests via a Review Request.
 */
import { useEffect, useMemo, useState } from 'react';
import { selectBillableCharges, monthRange, summarizeChargePreview } from '../../lib/chargeNotice.js';
import { formatAnnualSummaryCurrency } from '../../lib/formatting.js';

/**
 * @param {{
 *   open: boolean,
 *   memberName: string,
 *   charges: Array,                // candidate deferred charges { id, description, amount, incurredDate }
 *   now?: Date,                    // injectable "today" for the This-month preset (tests)
 *   onConfirm: (chargeIds: string[]) => void,
 *   onClose: () => void
 * }} props
 */
export default function ChargeNoticeDialog({ open, memberName, charges, now, onConfirm, onClose }) {
    // 'all' = every deferred charge; 'month' = only those incurred this calendar month.
    const [period, setPeriod] = useState('all');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setPeriod('all');
            setError('');
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        function handleKey(e) { if (e.key === 'Escape') onClose(); }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    const candidates = useMemo(() => charges || [], [charges]);

    // Apply the selected period to the candidate charges (selectBillableCharges
    // ignores status here — these are already the member's deferred charges — and
    // just applies the incurred-date range + chronological sort).
    const selected = useMemo(() => {
        const range = period === 'month' ? monthRange(now || new Date()) : {};
        return selectBillableCharges(
            candidates.map(c => ({ ...c, kind: 'usage_charge', status: 'deferred', memberId: '__preview__' })),
            '__preview__',
            range
        );
    }, [candidates, period, now]);

    const preview = useMemo(() => summarizeChargePreview(selected), [selected]);

    if (!open) return null;

    function handleConfirm(e) {
        e.preventDefault();
        setError('');
        if (preview.count === 0) {
            setError('No deferred charges to bill for the selected period.');
            return;
        }
        try {
            onConfirm(selected.map(c => c.id));
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
            <div className="dialog" role="dialog" aria-modal="true" aria-label="Bill Charges">
                <div className="dialog-title">Bill Charges</div>
                <form onSubmit={handleConfirm}>
                    <p className="payment-dialog-for">
                        For: <strong>{memberName}</strong>
                    </p>
                    <p className="share-hint">
                        Billing sends a Charge Notice and moves these charges to owed-now. The member
                        pays it like a normal bill, or can request a review.
                    </p>

                    <div className="charge-notice-period" role="group" aria-label="Period">
                        <label className="charge-notice-period-option">
                            <input
                                type="radio"
                                name="charge-notice-period"
                                value="all"
                                checked={period === 'all'}
                                onChange={() => setPeriod('all')}
                            />
                            All deferred
                        </label>
                        <label className="charge-notice-period-option">
                            <input
                                type="radio"
                                name="charge-notice-period"
                                value="month"
                                checked={period === 'month'}
                                onChange={() => setPeriod('month')}
                            />
                            This month
                        </label>
                    </div>

                    <div className="charge-notice-preview">
                        {preview.count === 0 ? (
                            <p className="charge-notice-empty">No deferred charges in this period.</p>
                        ) : (
                            <ul className="charge-notice-list">
                                {preview.charges.map(c => (
                                    <li key={c.id} className="charge-notice-line">
                                        <span className="charge-notice-line-desc">{c.description}</span>
                                        <span className="charge-notice-line-date">{c.incurredDate}</span>
                                        <span className="charge-notice-line-amt">{formatAnnualSummaryCurrency(c.amount)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="charge-notice-total">
                            <span>Total to bill</span>
                            <strong>{formatAnnualSummaryCurrency(preview.total)}</strong>
                        </div>
                    </div>

                    {error && <p className="composer-error">{error}</p>}
                    <div className="dialog-buttons">
                        <button type="button" className="btn btn-sm btn-header-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-sm btn-primary" disabled={preview.count === 0}>
                            Bill &amp; Notify
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
