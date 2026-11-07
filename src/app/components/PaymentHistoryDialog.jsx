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
} from '../../lib/calculations.js';
import { getPaymentMethodLabel, formatAnnualSummaryCurrency } from '../../lib/formatting.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import Dialog from './Dialog.jsx';
import FinancialUnavailable from './FinancialUnavailable.jsx';
import { FINANCIAL_UNAVAILABLE } from '../../lib/financial-availability.js';
import { findHouseholdContactId } from '../../lib/household.js';

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
    const summary = calculateAnnualSummary(familyMembers, bills.filter(bill => bill.members?.length && typeof bill.amount === 'number' && Number.isFinite(bill.amount)));
    const memberTotal = summary[memberId] ? summary[memberId].total : 0;

    // Reversal-after-refund warning (#331, ADR 0003). History stays member-bound,
    // but its current household contact may change while the dialog is open
    // (ADR 0011). Resolve the contact for household availability and warnings;
    // the member's audit ledger and reversal targets remain unchanged. If the
    // household carries an active
    // recorded Refund, reversing a payment is an informed action: it lowers Net
    // Contribution → the household flips to Outstanding, while the refund stays on the
    // books (never auto-clawed-back). We warn, but never block — pure display.
    const householdContactId = findHouseholdContactId(familyMembers, memberId);
    const household = familyMembers.find(m => m.id === householdContactId);

    /** Read full raw source under the current contact and caller reopening context. */
    function householdOwedAndContribution() {
        if (!household) return { owed: 0, netContribution: 0 };
        return getHouseholdFinancials(household, { familyMembers, bills, payments, creditAdjustments, owedAdjustments }, { reopenedAdjustmentIds });
    }

    const financials = householdOwedAndContribution();
    const available = financials.ok !== false;
    const totalPaid = available ? getPaymentTotalForMember(payments, memberId) : 0;
    const balance = memberTotal - totalPaid;
    const householdIds = household ? [household.id, ...(household.linkedMembers || [])] : [];
    const recordedRefund = available ? getHouseholdRecordedRefund(household, creditAdjustments)
        : { has: creditAdjustments.some(row => row && row.type === 'refund' && row.status !== 'cancelled'
            && householdIds.includes(row.memberId)) };

    /** Preserve audit correction access even when projected household money is unavailable. */
    function handleReverse() {
        if (!reverseTarget || !onReverse) return;
        onReverse(reverseTarget.id);
        setReverseTarget(null);
    }

    /** Confirm message for the reverse action — warns when the household has a recorded refund. */
    function reverseConfirmMessage() {
        if (!reverseTarget) return '';
        const amountLabel = typeof reverseTarget.amount === 'number' && Number.isFinite(reverseTarget.amount)
            ? formatAnnualSummaryCurrency(reverseTarget.amount) : FINANCIAL_UNAVAILABLE;
        const dateLabel = new Date(reverseTarget.receivedAt).toLocaleDateString();
        if (recordedRefund.has) {
            // The resulting Outstanding and the household's state BEFORE the reversal,
            // from the same financials the settlement board shows.
            if (financials.ok === false) {
                return 'This household has a recorded refund. ' + FINANCIAL_UNAVAILABLE
                    + '. The refund is not automatically clawed back. Reversing the ' + amountLabel
                    + ' payment from ' + dateLabel + ' creates a reversal entry in the audit trail. Reverse anyway?';
            }
            const refundLabel = formatAnnualSummaryCurrency(recordedRefund.total);
            let id = 'reversal-preview';
            while (payments.some(row => String(row.id) === id)) id += '_';
            const candidate = getHouseholdFinancials(household, { familyMembers, bills, creditAdjustments, owedAdjustments,
                payments: [...payments.map(row => row.id === reverseTarget.id ? { ...row, reversed: true } : row),
                    { id, memberId: reverseTarget.memberId, amount: -reverseTarget.amount, type: 'reversal', reversesPaymentId: reverseTarget.id }] }, { reopenedAdjustmentIds });
            if (!candidate.ok) return 'This household has a recorded refund. ' + FINANCIAL_UNAVAILABLE
                + '. The refund is not automatically clawed back. This creates a reversal entry in the audit trail. Reverse anyway?';
            const beforeOutstanding = financials.cents.balance;
            const resulting = Math.max(0, candidate.cents.balance);
            const resultingLabel = formatAnnualSummaryCurrency(resulting / 100);
            // Three cases (#331, #333):
            //  • still in credit after the reversal (partial refund) — don't claim a false "$0.00 Outstanding"
            //  • already Outstanding before the reversal — the reversal *increases* the balance to the new total
            //  • settled or in credit before — the reversal *makes* them Outstanding
            let impact;
            if (resulting <= 0) {
                impact = 'lowers their Net Contribution but leaves the household in credit';
            } else if (beforeOutstanding > 0) {
                impact = 'will increase their Outstanding balance to ' + resultingLabel;
            } else {
                impact = 'will make them Outstanding by ' + resultingLabel;
            }
            return 'This household received a ' + refundLabel + ' refund. Reversing the ' + amountLabel
                + ' payment from ' + dateLabel + ' ' + impact
                + ' — the refund is not automatically clawed back. This creates a reversal entry in the audit trail. Reverse anyway?';
        }
        return 'Reverse the ' + amountLabel + ' payment from ' + dateLabel
            + '? This creates a reversal entry in the audit trail.';
    }

    return (
        <Dialog
            onClose={onClose}
            wide
            title={'Payment History for ' + memberName}
            footer={<button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>}
        >
            {!available ? <FinancialUnavailable /> : <div className="payment-history-summary">
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
            </div>}

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
                                            {isReversal ? '-' : ''}{typeof p.amount === 'number' && Number.isFinite(p.amount)
                                                ? formatAnnualSummaryCurrency(Math.abs(p.amount)) : FINANCIAL_UNAVAILABLE}
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
                                                    className="btn btn-sm btn-destructive-outline payment-reverse-btn"
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
        </Dialog>
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
        <Dialog
            onClose={onCancel}
            title="Edit Payment"
            onSubmit={handleSave}
            footer={(
                <>
                    <button type="button" className="btn btn-sm btn-header-secondary" onClick={onCancel}>Cancel</button>
                    <button type="submit" className="btn btn-sm btn-ink">Save</button>
                </>
            )}
        >
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
        </Dialog>
    );
}
