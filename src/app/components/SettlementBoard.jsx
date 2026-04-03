/**
 * SettlementBoard — household cards showing per-member settlement status.
 * Port of updateSummary() from main.js:1914.
 */
import { useState } from 'react';
import { calculateAnnualSummary, getBillAnnualAmount, getPaymentTotalForMember, isLinkedToAnyone } from '../../lib/calculations.js';
import { getInitials, formatAnnualSummaryCurrency } from '../../lib/formatting.js';
import StatusBadge, { getPaymentStatus } from './StatusBadge.jsx';
import ActionMenu, { ActionMenuItem } from './ActionMenu.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

/** Payment method options matching legacy main.js:5173 */
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
 * @param {{ familyMembers: Array, bills: Array, payments: Array, readOnly: boolean, onRecordPayment?: function, onTextInvoice?: function, onEmailInvoice?: function, onGenerateShareLink?: function, onViewHistory?: function }} props
 */
export default function SettlementBoard({ familyMembers, bills, payments, readOnly, onRecordPayment, onTextInvoice, onEmailInvoice, onGenerateShareLink, onManageShareLinks, onViewHistory }) {
    const [filter, setFilter] = useState('all');

    if (familyMembers.length === 0) return null;

    const summary = calculateAnnualSummary(familyMembers, bills);

    // Only show parent/independent members as top-level rows (mirrors main.js:1932)
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));

    const rows = mainMembers.map(member => {
        const data = summary[member.id];
        if (!data) return null;

        let combinedTotal = data.total;
        const linkedData = [];

        (member.linkedMembers || []).forEach(linkedId => {
            const ls = summary[linkedId];
            if (ls) {
                combinedTotal += ls.total;
                linkedData.push(ls);
            }
        });

        const payment = getPaymentTotalForMember(payments, member.id)
            + (member.linkedMembers || []).reduce((s, id) => s + getPaymentTotalForMember(payments, id), 0);

        const balance = combinedTotal - payment;
        const status = getPaymentStatus(combinedTotal, payment) || 'settled';

        return { member, data, combinedTotal, linkedData, payment, balance, status };
    }).filter(Boolean);

    // Sort: outstanding → partial → settled (mirrors main.js:1964)
    const sortOrder = { outstanding: 0, partial: 1, settled: 2, overpaid: 3 };
    rows.sort((a, b) => (sortOrder[a.status] || 0) - (sortOrder[b.status] || 0));

    // Filter counts
    const counts = { all: rows.length, outstanding: 0, partial: 0, settled: 0 };
    rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

    // Count households with linked members
    const linkedGroupCount = rows.filter(r => r.linkedData.length > 0).length;

    const filtered = filter === 'all' ? rows : rows.filter(r => r.status === filter);

    const filters = [
        { key: 'all', label: 'All' },
        { key: 'outstanding', label: 'Outstanding' },
        { key: 'partial', label: 'Partial' },
        { key: 'settled', label: 'Settled' }
    ];

    return (
        <div className="settlement-board">
            <div className="settlement-header">
                <h3>Settlement Board</h3>
                <div className="settlement-filters">
                    {filters.map(f => (
                        <button
                            key={f.key}
                            className={'settlement-filter-chip' + (filter === f.key ? ' active' : '')}
                            onClick={() => setFilter(f.key)}
                        >
                            {f.label} <span className="settlement-filter-count">{counts[f.key] ?? 0}</span>
                        </button>
                    ))}
                    {linkedGroupCount > 0 && (
                        <span className="settlement-filter-info">Linked Groups {linkedGroupCount}</span>
                    )}
                </div>
            </div>

            <div className="settlement-rows">
                {filtered.length === 0 ? (
                    <p className="settlement-empty">No households match this filter.</p>
                ) : (
                    filtered.map(row => (
                        <HouseholdCard
                            key={row.member.id}
                            row={row}
                            payments={payments}
                            readOnly={readOnly}
                            onRecordPayment={onRecordPayment}
                            onTextInvoice={onTextInvoice}
                            onEmailInvoice={onEmailInvoice}
                            onGenerateShareLink={onGenerateShareLink}
                            onManageShareLinks={onManageShareLinks}
                            onViewHistory={onViewHistory}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

/**
 * Build a formula string showing how a bill split is calculated.
 * e.g. "$300.00 / month × 12 ÷ 8 = $450.00" or "$1,200.00 / year ÷ 3 = $400.00"
 */
function formatBillFormula(bill, annualShare) {
    const memberCount = bill.members.length;
    if (bill.billingFrequency === 'annual') {
        return formatAnnualSummaryCurrency(bill.amount) + ' / year ÷ ' + memberCount + ' = ' + formatAnnualSummaryCurrency(annualShare);
    }
    return formatAnnualSummaryCurrency(bill.amount) + ' / month × 12 ÷ ' + memberCount + ' = ' + formatAnnualSummaryCurrency(annualShare);
}

function HouseholdCard({ row, payments, readOnly, onRecordPayment, onTextInvoice, onEmailInvoice, onGenerateShareLink, onManageShareLinks, onViewHistory }) {
    const [expanded, setExpanded] = useState(false);
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [paymentNote, setPaymentNote] = useState('');
    const [paymentError, setPaymentError] = useState('');
    const [distribute, setDistribute] = useState(true);

    const { member, data, combinedTotal, linkedData, payment, balance, status } = row;
    const hasLinked = linkedData.length > 0;
    const showPaymentAction = !readOnly && balance > 0;

    function handleRecordPayment(e) {
        e.preventDefault();
        setPaymentError('');
        const amt = parseFloat(paymentAmount);
        if (!amt || amt <= 0) {
            setPaymentError('Enter a valid amount.');
            return;
        }
        try {
            if (onRecordPayment) {
                onRecordPayment({
                    memberId: member.id,
                    amount: amt,
                    method: paymentMethod,
                    note: paymentNote,
                    distribute: hasLinked && distribute
                });
            }
            setPaymentOpen(false);
            setPaymentAmount('');
            setPaymentMethod('cash');
            setPaymentNote('');
            setDistribute(true);
        } catch (err) {
            setPaymentError(err.message);
        }
    }

    function cancelPayment() {
        setPaymentOpen(false);
        setPaymentAmount('');
        setPaymentMethod('cash');
        setPaymentNote('');
        setPaymentError('');
        setDistribute(true);
    }

    return (
        <div className={'settlement-card settlement-card--' + status}>
            {/* ── Card Header ─────────────────────────────────── */}
            <div className="settlement-card-main" onClick={() => setExpanded(!expanded)}>
                <div className="settlement-card-left">
                    <div className="settlement-avatar">
                        {member.avatar
                            ? <img src={member.avatar} alt={member.name} className="settlement-avatar-img" />
                            : <span className="settlement-avatar-initials">{getInitials(member.name)}</span>
                        }
                    </div>
                    <div className="settlement-card-info">
                        <div className="settlement-card-name-row">
                            <strong>{member.name}</strong>
                            {hasLinked && (
                                <span className="settlement-linked-badge">+{linkedData.length}</span>
                            )}
                        </div>
                        <span className="settlement-card-meta">
                            {hasLinked
                                ? 'Household includes ' + linkedData.length + ' linked member' + (linkedData.length > 1 ? 's' : '')
                                : 'Individual'}
                        </span>
                    </div>
                </div>
                <div className="settlement-card-right">
                    {/* Summary boxes */}
                    <div className="settlement-summary-boxes">
                        <div className="settlement-summary-box">
                            <span className="settlement-summary-label">Annual</span>
                            <span className="settlement-summary-value">{formatAnnualSummaryCurrency(combinedTotal)}</span>
                        </div>
                        <div className="settlement-summary-box">
                            <span className="settlement-summary-label">Paid</span>
                            <span className="settlement-summary-value settlement-summary-paid">{formatAnnualSummaryCurrency(payment)}</span>
                        </div>
                        <div className="settlement-summary-box">
                            <span className="settlement-summary-label">Balance</span>
                            <span className="settlement-summary-value settlement-summary-balance">{formatAnnualSummaryCurrency(balance > 0 ? balance : 0)}</span>
                        </div>
                    </div>
                    <StatusBadge status={status} />
                    <span className="settlement-expand-toggle">
                        {expanded ? 'Hide details \u25B2' : 'Details \u25BC'}
                    </span>
                </div>
            </div>

            {/* ── Expanded Detail ─────────────────────────────── */}
            {expanded && (
                <div className="settlement-card-detail">
                    {/* Linked members — shown before breakdown for clear hierarchy */}
                    {hasLinked && (
                        <div className="settlement-linked-section">
                            <div className="settlement-section-label">Linked Members</div>
                            {linkedData.map(ls => {
                                const childPayment = getPaymentTotalForMember(payments, ls.member.id);
                                const childBalance = ls.total - childPayment;
                                const childStatus = getPaymentStatus(ls.total, childPayment);
                                return (
                                    <div key={ls.member.id} className="settlement-linked-row">
                                        <div className="settlement-linked-member">
                                            <span className="child-indicator" aria-hidden="true"></span>
                                            <div className="settlement-avatar settlement-avatar--sm">
                                                {ls.member.avatar
                                                    ? <img src={ls.member.avatar} alt={ls.member.name} className="settlement-avatar-img" />
                                                    : <span className="settlement-avatar-initials">{getInitials(ls.member.name)}</span>
                                                }
                                            </div>
                                            <strong>{ls.member.name}</strong>
                                            {childStatus && <StatusBadge status={childStatus} />}
                                        </div>
                                        <div className="settlement-summary-boxes settlement-summary-boxes--linked">
                                            <div className="settlement-summary-box">
                                                <span className="settlement-summary-label">Annual</span>
                                                <span className="settlement-summary-value">{formatAnnualSummaryCurrency(ls.total)}</span>
                                            </div>
                                            <div className="settlement-summary-box">
                                                <span className="settlement-summary-label">Paid</span>
                                                <span className="settlement-summary-value settlement-summary-paid">{formatAnnualSummaryCurrency(childPayment)}</span>
                                            </div>
                                            <div className="settlement-summary-box">
                                                <span className="settlement-summary-label">Balance</span>
                                                <span className="settlement-summary-value settlement-summary-balance">{formatAnnualSummaryCurrency(childBalance > 0 ? childBalance : 0)}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Bill breakdown */}
                    <div className="settlement-breakdown">
                        <div className="settlement-breakdown-header">
                            {hasLinked ? 'Primary Member Calculation' : 'Bill breakdown for ' + member.name}
                        </div>
                        {data.bills.length === 0 ? (
                            <p className="settlement-breakdown-empty">No bills assigned</p>
                        ) : (
                            <>
                                {data.bills.map(b => (
                                    <div key={b.bill.id} className="settlement-breakdown-row">
                                        <span>{b.bill.name}</span>
                                        <span className="settlement-breakdown-formula">
                                            {formatBillFormula(b.bill, b.annualShare)}
                                        </span>
                                    </div>
                                ))}
                                <div className="settlement-breakdown-row settlement-breakdown-total">
                                    <span>Total ({member.name})</span>
                                    <span>{formatAnnualSummaryCurrency(data.total)}</span>
                                </div>
                                {hasLinked && (
                                    <>
                                        {linkedData.map(ls => (
                                            <div key={ls.member.id} className="settlement-breakdown-row settlement-breakdown-linked">
                                                <span>{ls.member.name}</span>
                                                <span>{formatAnnualSummaryCurrency(ls.total)}</span>
                                            </div>
                                        ))}
                                        <div className="settlement-breakdown-row settlement-breakdown-grand-total">
                                            <span>Household Total</span>
                                            <span>{formatAnnualSummaryCurrency(combinedTotal)}</span>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>

                    {/* Actions — primary + overflow menu */}
                    <div className="settlement-detail-actions">
                        {showPaymentAction && (
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => setPaymentOpen(true)}
                            >
                                Record Payment
                            </button>
                        )}
                        <button
                            className="btn btn-tertiary btn-sm"
                            onClick={() => onViewHistory && onViewHistory(member.id)}
                        >
                            Payment History
                        </button>
                        {member.phone && (
                            <button
                                className="btn btn-tertiary btn-sm"
                                onClick={() => onTextInvoice && onTextInvoice(member.id)}
                            >
                                Text Invoice
                            </button>
                        )}
                        <ActionMenu label={'More actions for ' + member.name}>
                            <ActionMenuItem onClick={() => onEmailInvoice && onEmailInvoice(member.id, balance <= 0)}>
                                Email Invoice
                            </ActionMenuItem>
                            <ActionMenuItem onClick={() => onGenerateShareLink && onGenerateShareLink(member.id)}>
                                Generate Share Link
                            </ActionMenuItem>
                            <ActionMenuItem onClick={() => onManageShareLinks && onManageShareLinks(member.id)}>
                                Manage Share Links
                            </ActionMenuItem>
                        </ActionMenu>
                    </div>
                </div>
            )}

            {paymentOpen && (
                <div className="dialog-overlay" onClick={cancelPayment}>
                    <div className="dialog" onClick={e => e.stopPropagation()}>
                        <div className="dialog-title">Record Payment</div>
                        <form onSubmit={handleRecordPayment}>
                            <p className="payment-dialog-for">
                                For: <strong>{member.name}</strong>
                                {balance > 0 && (
                                    <span className="payment-dialog-balance">
                                        {' '}(Balance: {formatAnnualSummaryCurrency(balance)})
                                    </span>
                                )}
                            </p>
                            <div className="payment-dialog-fields">
                                <div className="payment-field-group">
                                    <label htmlFor={'pay-amount-' + member.id}>Amount ($)</label>
                                    <input
                                        id={'pay-amount-' + member.id}
                                        className="composer-input"
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        placeholder="0.00"
                                        value={paymentAmount}
                                        onChange={e => setPaymentAmount(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className="payment-field-group">
                                    <label htmlFor={'pay-method-' + member.id}>Method</label>
                                    <select
                                        id={'pay-method-' + member.id}
                                        className="composer-input"
                                        value={paymentMethod}
                                        onChange={e => setPaymentMethod(e.target.value)}
                                    >
                                        {PAYMENT_METHODS.map(m => (
                                            <option key={m.value} value={m.value}>{m.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="payment-field-group">
                                    <label htmlFor={'pay-note-' + member.id}>Note (optional)</label>
                                    <input
                                        id={'pay-note-' + member.id}
                                        className="composer-input"
                                        type="text"
                                        placeholder="e.g., Q1 payment"
                                        value={paymentNote}
                                        onChange={e => setPaymentNote(e.target.value)}
                                    />
                                </div>
                            </div>
                            {hasLinked && (
                                <div className="checkbox-item payment-distribute-option">
                                    <input
                                        type="checkbox"
                                        id={'pay-distribute-' + member.id}
                                        checked={distribute}
                                        onChange={e => setDistribute(e.target.checked)}
                                    />
                                    <label htmlFor={'pay-distribute-' + member.id}>
                                        Distribute across household proportionally
                                    </label>
                                </div>
                            )}
                            {paymentError && <p className="composer-error">{paymentError}</p>}
                            <div className="dialog-buttons">
                                <button type="button" className="btn btn-sm btn-header-secondary" onClick={cancelPayment}>Cancel</button>
                                <button type="submit" className="btn btn-sm btn-primary">Save Payment</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
