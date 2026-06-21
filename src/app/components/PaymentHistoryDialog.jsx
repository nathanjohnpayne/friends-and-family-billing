/**
 * PaymentHistoryDialog — shows a member's payment timeline with reversal support.
 * Port of showPaymentHistory() from main.js:5310.
 */
import { useState } from 'react';
import {
    getMemberPayments,
    getPaymentTotalForMember,
    calculateAnnualSummary,
    getHouseholdRecordedRefund,
    getHouseholdFinancials,
    getHouseholdOpeningBalance,
    CREDIT_EPSILON
} from '../../lib/calculations.js';
import { getPaymentMethodLabel, formatAnnualSummaryCurrency } from '../../lib/formatting.js';
import ConfirmDialog from './ConfirmDialog.jsx';

/** Payment method options matching SettlementBoard.jsx */
const PAYMENT_METHODS = [
    { value: 'cash', label: 'Cash' },
    { value: 'check', label: 'Check' },
    { value: 'venmo', label: 'Venmo' },
    { value: 'zelle', label: 'Zelle' },
    { value: 'paypal', label: 'PayPal' },
    { value: 'cashapp', label: 'Cash App' },
    { value: 'apple_cash', label: 'Apple Cash' },
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'other', label: 'Other' }
];

/**
 * @param {{ open: boolean, memberId: number, memberName: string, familyMembers: Array, bills: Array, payments: Array, creditAdjustments?: Array, owedAdjustments?: Array, reopenedAdjustmentIds?: Set<string>|null, readOnly: boolean, onReverse?: function, onEditPayment?: function, onClose: function }} props
 */
export default function PaymentHistoryDialog({ open, memberId, memberName, familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], reopenedAdjustmentIds = null, readOnly, onReverse, onEditPayment, onClose }) {
    const [reverseTarget, setReverseTarget] = useState(null);
    const [editTarget, setEditTarget] = useState(null);

    if (!open) return null;

    const memberPayments = getMemberPayments(payments, memberId);
    const totalPaid = getPaymentTotalForMember(payments, memberId);
    const summary = calculateAnnualSummary(familyMembers, bills);
    const memberTotal = summary[memberId] ? summary[memberId].total : 0;
    const balance = memberTotal - totalPaid;

    // Reversal-after-refund warning (#331, ADR 0003). PaymentHistoryDialog is opened
    // for the household primary (SettlementBoard wires onViewHistory(member.id)), so
    // its linkedMembers give the whole household. If the household carries an active
    // recorded Refund, reversing a payment is an informed action: it lowers Net
    // Contribution → the household flips to Outstanding, while the refund stays on the
    // books (never auto-clawed-back). We warn, but never block — pure display.
    const household = familyMembers.find(m => m.id === memberId);
    const recordedRefund = getHouseholdRecordedRefund(household, creditAdjustments);

    /**
     * Resulting household Outstanding if `target` (a positive original payment) is
     * reversed: reversing appends a −amount entry, so Net Contribution drops by that
     * amount and the collectable shortfall rises by it. Derived from the same
     * household financials the settlement board shows, so the figure matches the card.
     */
    function resultingOutstandingAfterReversal(target) {
        if (!household || !target) return 0;
        const openingBalance = getHouseholdOpeningBalance(household, owedAdjustments);
        const { owed, netContribution } = getHouseholdFinancials(
            household, summary, payments, creditAdjustments, reopenedAdjustmentIds, owedAdjustments, openingBalance
        );
        return Math.max(0, (owed - netContribution) + Math.abs(target.amount));
    }

    function handleReverse() {
        if (!reverseTarget || !onReverse) return;
        onReverse(reverseTarget.id);
        setReverseTarget(null);
    }

    /** Confirm message for the reverse action — warns when the household has a recorded refund. */
    function reverseConfirmMessage() {
        if (!reverseTarget) return '';
        const amountLabel = formatAnnualSummaryCurrency(reverseTarget.amount);
        const dateLabel = new Date(reverseTarget.receivedAt).toLocaleDateString();
        if (recordedRefund.has) {
            const refundLabel = formatAnnualSummaryCurrency(recordedRefund.total);
            const resulting = resultingOutstandingAfterReversal(reverseTarget);
            // Usually the reversal flips the household Outstanding; with a partial refund
            // the household can keep residual credit, so don't claim a false "$0.00 Outstanding".
            const impact = resulting > CREDIT_EPSILON
                ? 'will make them Outstanding by ' + formatAnnualSummaryCurrency(resulting)
                : 'lowers their Net Contribution but leaves the household in credit';
            return 'This household received a ' + refundLabel + ' refund. Reversing the ' + amountLabel
                + ' payment from ' + dateLabel + ' ' + impact
                + ' — the refund is not automatically clawed back. This creates a reversal entry in the audit trail. Reverse anyway?';
        }
        return 'Reverse the ' + amountLabel + ' payment from ' + dateLabel
            + '? This creates a reversal entry in the audit trail.';
    }

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog dialog--wide" onClick={e => e.stopPropagation()}>
                <div className="dialog-title">Payment History for {memberName}</div>

                <div className="payment-history-summary">
                    <div className="payment-history-stat">
                        <span className="payment-history-stat-label">Total Paid</span>
                        <span className="payment-history-stat-value">{formatAnnualSummaryCurrency(totalPaid)}</span>
                    </div>
                    <div className="payment-history-stat">
                        <span className="payment-history-stat-label">Remaining Balance</span>
                        <span className={'payment-history-stat-value' + (balance > 0 ? ' balance-owed' : ' settled-zero')}>
                            {balance > 0 ? formatAnnualSummaryCurrency(balance) : 'Paid'}
                        </span>
                    </div>
                </div>

                {memberPayments.length === 0 ? (
                    <p className="payment-history-empty">No payments recorded yet.</p>
                ) : (
                    <div className="payment-history-list">
                        {memberPayments.map(p => {
                            const isReversal = p.type === 'reversal';
                            const isReversed = p.reversed === true;
                            const date = p.receivedAt ? new Date(p.receivedAt).toLocaleDateString() : '';
                            const canReverse = !readOnly && !isReversed && !isReversal;

                            return (
                                <div key={p.id} className={'payment-history-item' + (isReversed ? ' payment-reversed' : '') + (isReversal ? ' payment-reversal' : '')}>
                                    <div className="payment-history-item-main">
                                        <div className="payment-history-item-left">
                                            <span className="payment-history-date">{date}</span>
                                            <span className={'payment-history-amount' + (isReversal ? ' reversal-amount' : '')}>
                                                {isReversal ? '-' : ''}{formatAnnualSummaryCurrency(Math.abs(p.amount))}
                                            </span>
                                        </div>
                                        <div className="payment-history-item-right">
                                            <span className="payment-history-method">{getPaymentMethodLabel(p.method)}</span>
                                            {isReversed && <span className="payment-history-tag tag-reversed">Reversed</span>}
                                            {isReversal && <span className="payment-history-tag tag-reversal">Reversal</span>}
                                            {canReverse && (
                                                <>
                                                    <button
                                                        className="btn btn-sm btn-tertiary"
                                                        onClick={() => setEditTarget({ ...p })}
                                                        title="Edit payment method or note"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        className="btn btn-sm btn-tertiary payment-reverse-btn"
                                                        onClick={() => setReverseTarget(p)}
                                                        title="Reverse this payment"
                                                    >
                                                        &times;
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {p.note && <div className="payment-history-note">{p.note}</div>}
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="dialog-buttons">
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                </div>

                <ConfirmDialog
                    open={reverseTarget !== null}
                    title={recordedRefund.has ? 'Reverse Payment — Refund on Record' : 'Reverse Payment'}
                    message={reverseConfirmMessage()}
                    confirmLabel="Reverse"
                    destructive
                    onConfirm={handleReverse}
                    onCancel={() => setReverseTarget(null)}
                />

                {editTarget && (
                    <PaymentEditDialog
                        payment={editTarget}
                        onSave={updated => {
                            if (onEditPayment) onEditPayment(updated.id, { method: updated.method, note: updated.note });
                            setEditTarget(null);
                        }}
                        onCancel={() => setEditTarget(null)}
                    />
                )}
            </div>
        </div>
    );
}

/** Inline edit dialog for payment method and note. */
function PaymentEditDialog({ payment, onSave, onCancel }) {
    const [method, setMethod] = useState(payment.method || 'other');
    const [note, setNote] = useState(payment.note || '');

    function handleSave(e) {
        e.preventDefault();
        onSave({ ...payment, method, note });
    }

    return (
        <div className="dialog-overlay" onClick={onCancel}>
            <div className="dialog" onClick={e => e.stopPropagation()}>
                <div className="dialog-title">Edit Payment</div>
                <form onSubmit={handleSave}>
                    <div className="payment-dialog-fields">
                        <div className="payment-field-group">
                            <label>Amount</label>
                            <input
                                className="composer-input"
                                type="text"
                                value={formatAnnualSummaryCurrency(payment.amount)}
                                disabled
                            />
                        </div>
                        <div className="payment-field-group">
                            <label htmlFor="edit-pay-method">Method</label>
                            <select
                                id="edit-pay-method"
                                className="composer-input"
                                value={method}
                                onChange={e => setMethod(e.target.value)}
                            >
                                {PAYMENT_METHODS.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="payment-field-group">
                            <label htmlFor="edit-pay-note">Note</label>
                            <input
                                id="edit-pay-note"
                                className="composer-input"
                                type="text"
                                placeholder="e.g., Q1 payment"
                                value={note}
                                onChange={e => setNote(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="dialog-buttons">
                        <button type="button" className="btn btn-sm btn-header-secondary" onClick={onCancel}>Cancel</button>
                        <button type="submit" className="btn btn-sm btn-primary">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
