/**
 * PaymentHistoryDialog — shows a member's payment timeline with reversal support.
 * Port of showPaymentHistory() from main.js:5310.
 */
import { useState } from 'react';
import { getMemberPayments, getPaymentTotalForMember, calculateAnnualSummary } from '../../lib/calculations.js';
import { getPaymentMethodLabel, formatAnnualSummaryCurrency } from '../../lib/formatting.js';
import ConfirmDialog from './ConfirmDialog.jsx';

/**
 * @param {{ open: boolean, memberId: number, memberName: string, familyMembers: Array, bills: Array, payments: Array, readOnly: boolean, onReverse?: function, onClose: function }} props
 */
export default function PaymentHistoryDialog({ open, memberId, memberName, familyMembers, bills, payments, readOnly, onReverse, onClose }) {
    const [reverseTarget, setReverseTarget] = useState(null);

    if (!open) return null;

    const memberPayments = getMemberPayments(payments, memberId);
    const totalPaid = getPaymentTotalForMember(payments, memberId);
    const summary = calculateAnnualSummary(familyMembers, bills);
    const memberTotal = summary[memberId] ? summary[memberId].total : 0;
    const balance = memberTotal - totalPaid;

    function handleReverse() {
        if (!reverseTarget || !onReverse) return;
        onReverse(reverseTarget.id);
        setReverseTarget(null);
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
                        <span className={'payment-history-stat-value' + (balance > 0 ? ' balance-owed' : ' balance-paid')}>
                            {formatAnnualSummaryCurrency(balance)}
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
                                                <button
                                                    className="btn btn-sm btn-tertiary payment-reverse-btn"
                                                    onClick={() => setReverseTarget(p)}
                                                    title="Reverse this payment"
                                                >
                                                    &times;
                                                </button>
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
                    title="Reverse Payment"
                    message={reverseTarget
                        ? 'Reverse the ' + formatAnnualSummaryCurrency(reverseTarget.amount) + ' payment from ' + new Date(reverseTarget.receivedAt).toLocaleDateString() + '? This creates a reversal entry in the audit trail.'
                        : ''}
                    confirmLabel="Reverse"
                    destructive
                    onConfirm={handleReverse}
                    onCancel={() => setReverseTarget(null)}
                />
            </div>
        </div>
    );
}
