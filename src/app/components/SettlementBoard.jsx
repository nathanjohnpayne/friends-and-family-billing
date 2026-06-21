/**
 * SettlementBoard — household cards showing per-member settlement status.
 * Port of updateSummary() from main.js:1914.
 */
import { useState } from 'react';
import { calculateAnnualSummary, getPaymentTotalForMember, isLinkedToAnyone, getHouseholdFinancials, getHouseholdDeferredCharges, getHouseholdOpeningBalance, CREDIT_EPSILON } from '../../lib/calculations.js';
import { getInitials, getGravatarUrl, formatAnnualSummaryCurrency } from '../../lib/formatting.js';
import StatusBadge, { getPaymentStatus } from './StatusBadge.jsx';
import ActionMenu, { ActionMenuItem } from './ActionMenu.jsx';
import CompanyLogo from './CompanyLogo.jsx';

/** Avatar with Gravatar fallback: manual upload → Gravatar → initials. */
function MemberAvatar({ member }) {
    const [gravatarFailed, setGravatarFailed] = useState(false);
    if (member.avatar) {
        return <img src={member.avatar} alt={member.name} className="settlement-avatar-img" />;
    }
    const gravatarUrl = getGravatarUrl(member.email);
    if (gravatarUrl && !gravatarFailed) {
        return <img src={gravatarUrl} alt={member.name} className="settlement-avatar-img" onError={() => setGravatarFailed(true)} />;
    }
    return <span className="settlement-avatar-initials">{getInitials(member.name)}</span>;
}

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
export default function SettlementBoard({ familyMembers, bills, payments, creditAdjustments = [], reopenedAdjustmentIds = null, owedAdjustments = [], readOnly, onRecordPayment, onIssueRefund, onTextInvoice, onEmailInvoice, onGenerateShareLink, onManageShareLinks, onViewHistory, onAddCharge, onBillCharges }) {
    const [filter, setFilter] = useState('all');

    if (familyMembers.length === 0) return null;

    const summary = calculateAnnualSummary(familyMembers, bills);

    // Only show parent/independent members as top-level rows (mirrors main.js:1932)
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));

    const rows = mainMembers.map(member => {
        const data = summary[member.id];
        if (!data) return null;

        let billsTotal = data.total;
        const linkedData = [];

        (member.linkedMembers || []).forEach(linkedId => {
            const ls = summary[linkedId];
            if (ls) {
                billsTotal += ls.total;
                linkedData.push(ls);
            }
        });

        // Carried opening balance (#322, ADR 0005/0006): a carried credit (negative)
        // lowers the household's owed/annual total, a carried charge (positive) raises
        // it. Floored at 0 to match getHouseholdFinancials. combinedTotal is the
        // household's effective owed for THIS year (bills ± carried opening balance).
        const openingBalance = getHouseholdOpeningBalance(member, owedAdjustments);
        const combinedTotal = Math.max(0, billsTotal + openingBalance);

        const payment = getPaymentTotalForMember(payments, member.id)
            + (member.linkedMembers || []).reduce((s, id) => s + getPaymentTotalForMember(payments, id), 0);

        // Household-grain credit (ADR 0001): Net Contribution = gross paid minus
        // recorded refunds/carry-forwards. Status, the collectable balance, and the
        // Record-Payment gate all derive from Net Contribution, so a refunded
        // household (net == owed) reads Settled, and a household pushed net-underpaid
        // shows an honest collectable balance instead of "Paid". The "Paid" box keeps
        // showing gross money received.
        //
        // ADR 0003 (#319): a refund whose member reported an active, unresolved
        // not_received is re-opened (its disposition excluded), so Net Contribution
        // rises back and the household's credit is owed again while the year is open.
        //
        // `owed` here is the fully-composed owed from getHouseholdFinancials: an active
        // service_credit (#321) LOWERS it, a billed Usage Charge / Charge Notice (#320)
        // RAISES it, and the carried opening balance (#322) adjusts it (credit −, charge
        // +). The card balance, status, credit, and Record-Payment gate all derive from
        // this adjusted figure (matching the dashboard Outstanding KPI), not just the
        // gross bill split. Deferred charges (#317) are excluded — they never raise owed.
        // `combinedTotal` (above) stays the gross bill split ± the carried opening balance
        // for the displayed "Annual" figure; service credits and billed charges follow
        // Option B and surface only in the balance, not the bill's own amount.
        const { owed, netContribution, credit } = getHouseholdFinancials(member, summary, payments, creditAdjustments, reopenedAdjustmentIds, owedAdjustments, openingBalance);
        const balance = owed - netContribution;
        const netForStatus = Math.abs(netContribution - owed) <= CREDIT_EPSILON ? owed : netContribution;
        const status = getPaymentStatus(owed, netForStatus) || 'settled';

        // Deferred Usage Charges (#317) — household-grain pending count/total.
        // These are NOT-YET-DUE and deliberately excluded from balance/status above.
        const pendingCharges = getHouseholdDeferredCharges(member, owedAdjustments);

        return { member, data, combinedTotal, owed, linkedData, payment, balance, credit, status, pendingCharges };
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
                            onAddCharge={onAddCharge}
                            onBillCharges={onBillCharges}
                            onIssueRefund={onIssueRefund}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

/**
 * Build a formula string showing how a bill split is calculated.
 * e.g. "$300.00 / month × 12 ÷ 8 members = $450.00" or "$1,200.00 / year ÷ 3 members = $400.00"
 */
function formatBillFormula(bill, annualShare) {
    const memberCount = bill.members.length;
    const divisorLabel = memberCount + ' ' + (memberCount === 1 ? 'member' : 'members');
    if (bill.billingFrequency === 'annual') {
        return formatAnnualSummaryCurrency(bill.amount) + ' / year \u00F7 ' + divisorLabel + ' = ' + formatAnnualSummaryCurrency(annualShare);
    }
    return formatAnnualSummaryCurrency(bill.amount) + ' / month \u00D7 12 \u00F7 ' + divisorLabel + ' = ' + formatAnnualSummaryCurrency(annualShare);
}

function formatBillFormulaShort(bill, annualShare) {
    const n = bill.members.length;
    const mem = n + ' mem';
    if (bill.billingFrequency === 'annual') {
        return formatAnnualSummaryCurrency(bill.amount) + '/yr \u00F7 ' + mem + ' = ' + formatAnnualSummaryCurrency(annualShare);
    }
    return formatAnnualSummaryCurrency(bill.amount) + '/mo \u00D7 12 \u00F7 ' + mem + ' = ' + formatAnnualSummaryCurrency(annualShare);
}

/** Bill breakdown row with responsive name/formula. */
function BillBreakdownRow({ bill, annualShare }) {
    return (
        <div className="settlement-breakdown-row">
            <span className="settlement-bill-name">
                <CompanyLogo logo={bill.logo} website={bill.website} name={bill.name} size={16} className="settlement-bill-logo" />
                <span className="settlement-bill-text">{bill.name}</span>
            </span>
            <span className="settlement-breakdown-formula settlement-formula-full">
                {formatBillFormula(bill, annualShare)}
            </span>
            <span className="settlement-breakdown-formula settlement-formula-short">
                {formatBillFormulaShort(bill, annualShare)}
            </span>
        </div>
    );
}

/** Check whether two member summaries from calculateAnnualSummary share the exact same bill set. */
function hasSameBillSet(dataA, dataB) {
    if (dataA.bills.length !== dataB.bills.length) return false;
    const idsA = [...dataA.bills.map(b => b.bill.id)].sort();
    const idsB = [...dataB.bills.map(b => b.bill.id)].sort();
    return idsA.every((id, i) => id === idsB[i]);
}

function HouseholdCard({ row, payments, readOnly, onRecordPayment, onIssueRefund, onTextInvoice, onEmailInvoice, onGenerateShareLink, onManageShareLinks, onViewHistory, onAddCharge, onBillCharges }) {
    const [expanded, setExpanded] = useState(false);
    const [linkedExpanded, setLinkedExpanded] = useState({});
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [paymentNote, setPaymentNote] = useState('');
    const [paymentError, setPaymentError] = useState('');
    const [distribute, setDistribute] = useState(true);
    const [refundOpen, setRefundOpen] = useState(false);
    const [refundAmount, setRefundAmount] = useState('');
    const [refundMethod, setRefundMethod] = useState('venmo');
    const [refundReason, setRefundReason] = useState('');
    const [refundError, setRefundError] = useState('');

    function toggleLinkedBreakdown(memberId) {
        setLinkedExpanded(prev => ({ ...prev, [memberId]: !prev[memberId] }));
    }

    const { member, data, combinedTotal, linkedData, payment, balance, credit, status, pendingCharges } = row;
    const hasLinked = linkedData.length > 0;
    const hasPendingCharges = pendingCharges && pendingCharges.count > 0;
    // balance is the net shortfall (owed − Net Contribution); a sub-cent residue
    // reads as settled, matching the status badge and the credit epsilon.
    const showPaymentAction = !readOnly && balance > CREDIT_EPSILON;
    // A household with a Credit can be refunded (#318); the refund is issued to the primary member.
    const showRefundAction = !readOnly && credit > CREDIT_EPSILON;

    function openRefund() {
        setRefundAmount(credit.toFixed(2));
        setRefundMethod('venmo');
        setRefundReason('');
        setRefundError('');
        setRefundOpen(true);
    }

    function cancelRefund() {
        setRefundOpen(false);
        setRefundAmount('');
        setRefundReason('');
        setRefundError('');
    }

    function handleIssueRefund(e) {
        e.preventDefault();
        setRefundError('');
        const amt = Math.round((parseFloat(refundAmount) || 0) * 100) / 100;
        if (!amt || amt <= 0) {
            setRefundError('Enter a valid amount.');
            return;
        }
        if (amt > credit + CREDIT_EPSILON) {
            setRefundError('Refund cannot exceed the credit of ' + formatAnnualSummaryCurrency(credit) + '.');
            return;
        }
        if (!refundReason.trim()) {
            setRefundError('A reason is required.');
            return;
        }
        try {
            if (onIssueRefund) {
                onIssueRefund({ memberId: member.id, amount: amt, method: refundMethod, reason: refundReason.trim() });
            }
            cancelRefund();
        } catch (err) {
            setRefundError(err.message);
        }
    }

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
                        <MemberAvatar member={member} />
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
                        {hasPendingCharges && (
                            <span className="settlement-card-pending" title="Deferred usage charges — not yet billed">
                                Pending charges: {formatAnnualSummaryCurrency(pendingCharges.total)}
                                {' '}
                                <span className="settlement-pending-count">
                                    ({pendingCharges.count} {pendingCharges.count === 1 ? 'charge' : 'charges'})
                                </span>
                            </span>
                        )}
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
                        {credit > 0 ? (
                            <div className="settlement-summary-box">
                                <span className="settlement-summary-label">Credit</span>
                                <span className="settlement-summary-value settlement-summary-credit">{formatAnnualSummaryCurrency(credit)}</span>
                            </div>
                        ) : (
                            <div className="settlement-summary-box">
                                <span className="settlement-summary-label">Balance</span>
                                <span className={'settlement-summary-value' + (balance > CREDIT_EPSILON ? ' settlement-summary-balance' : ' settled-zero')}>{balance > CREDIT_EPSILON ? formatAnnualSummaryCurrency(balance) : 'Paid'}</span>
                            </div>
                        )}
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
                    {/* 1. Primary member bill breakdown — always first */}
                    <div className="settlement-breakdown">
                        <div className="settlement-breakdown-header">
                            {hasLinked ? 'Primary Member Calculation' : 'Bill Breakdown for ' + member.name}
                        </div>
                        {data.bills.length === 0 ? (
                            <p className="settlement-breakdown-empty">No bills assigned</p>
                        ) : (
                            <>
                                {data.bills.map(b => (
                                    <BillBreakdownRow key={b.bill.id} bill={b.bill} annualShare={b.annualShare} />
                                ))}
                                <div className="settlement-breakdown-row settlement-breakdown-total">
                                    <span>Total ({member.name})</span>
                                    <span>{formatAnnualSummaryCurrency(data.total)}</span>
                                </div>
                            </>
                        )}
                    </div>

                    {/* 2. Linked members — shown after primary breakdown */}
                    {hasLinked && (
                        <div className="settlement-linked-section">
                            <div className="settlement-section-label">Linked Members</div>
                            {linkedData.map(ls => {
                                const childPayment = getPaymentTotalForMember(payments, ls.member.id);
                                const childBalance = ls.total - childPayment;
                                const childStatus = getPaymentStatus(ls.total, childPayment);
                                const isLinkedExpanded = !!linkedExpanded[ls.member.id];
                                const sameBills = hasSameBillSet(data, ls);
                                return (
                                    <div key={ls.member.id} className="settlement-linked-row">
                                        <div className="settlement-linked-member" role="button" aria-expanded={isLinkedExpanded} onClick={() => toggleLinkedBreakdown(ls.member.id)}>
                                            <span className="child-indicator" aria-hidden="true"></span>
                                            <div className="settlement-avatar settlement-avatar--sm">
                                                <MemberAvatar member={ls.member} />
                                            </div>
                                            <strong>{ls.member.name}</strong>
                                            {childStatus && <StatusBadge status={childStatus} />}
                                            <span className="settlement-linked-toggle-hint" aria-hidden="true">
                                                {isLinkedExpanded ? '\u25B2' : '\u25BC'}
                                            </span>
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
                                                <span className={'settlement-summary-value' + (childBalance > 0 ? ' settlement-summary-balance' : ' settled-zero')}>{childBalance > 0 ? formatAnnualSummaryCurrency(childBalance) : 'Paid'}</span>
                                            </div>
                                        </div>
                                        {isLinkedExpanded && (
                                            <div className="settlement-linked-breakdown">
                                                {sameBills ? (
                                                    <p className="settlement-same-bills-note">Same bills as {member.name}</p>
                                                ) : (
                                                    <>
                                                        {ls.bills.map(b => (
                                                            <BillBreakdownRow key={b.bill.id} bill={b.bill} annualShare={b.annualShare} />
                                                        ))}
                                                        <div className="settlement-breakdown-row settlement-breakdown-total">
                                                            <span>Total ({ls.member.name})</span>
                                                            <span>{formatAnnualSummaryCurrency(ls.total)}</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* 3. Household / Individual Total */}
                    {hasLinked && (
                        <div className="settlement-breakdown">
                            <div className="settlement-breakdown-row settlement-breakdown-grand-total">
                                <span>Household Total</span>
                                <span>{formatAnnualSummaryCurrency(combinedTotal)}</span>
                            </div>
                        </div>
                    )}

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
                        {showRefundAction && (
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={openRefund}
                            >
                                Issue Refund
                            </button>
                        )}
                        <button
                            className="btn btn-tertiary btn-sm"
                            onClick={() => onViewHistory && onViewHistory(member.id)}
                        >
                            Payment History
                        </button>
                        {!readOnly && onAddCharge && (
                            <button
                                className="btn btn-tertiary btn-sm"
                                onClick={() => onAddCharge(member.id)}
                            >
                                Add Charge
                            </button>
                        )}
                        {!readOnly && onBillCharges && hasPendingCharges && (
                            <button
                                className="btn btn-tertiary btn-sm"
                                onClick={() => onBillCharges(member.id)}
                                title="Off-cycle-bill this household's deferred charges as a single Charge Notice"
                            >
                                Bill Charges
                            </button>
                        )}
                        {member.phone && (
                            <button
                                className="btn btn-tertiary btn-sm"
                                onClick={() => onTextInvoice && onTextInvoice(member.id)}
                            >
                                Text Invoice
                            </button>
                        )}
                        <ActionMenu label={'More actions for ' + member.name}>
                            <ActionMenuItem onClick={() => onEmailInvoice && onEmailInvoice(member.id, balance <= CREDIT_EPSILON)}>
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
                                {balance > CREDIT_EPSILON && (
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

            {refundOpen && (
                <div className="dialog-overlay" onClick={cancelRefund}>
                    <div className="dialog" onClick={e => e.stopPropagation()}>
                        <div className="dialog-title">Issue Refund</div>
                        <form onSubmit={handleIssueRefund}>
                            <p className="payment-dialog-for">
                                For: <strong>{member.name}</strong>
                                <span className="payment-dialog-balance">
                                    {' '}(Credit: {formatAnnualSummaryCurrency(credit)})
                                </span>
                            </p>
                            <div className="payment-dialog-fields">
                                <div className="payment-field-group">
                                    <label htmlFor={'refund-amount-' + member.id}>Refund amount ($)</label>
                                    <input
                                        id={'refund-amount-' + member.id}
                                        className="composer-input"
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        max={credit.toFixed(2)}
                                        placeholder="0.00"
                                        value={refundAmount}
                                        onChange={e => setRefundAmount(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className="payment-field-group">
                                    <label htmlFor={'refund-method-' + member.id}>Method</label>
                                    <select
                                        id={'refund-method-' + member.id}
                                        className="composer-input"
                                        value={refundMethod}
                                        onChange={e => setRefundMethod(e.target.value)}
                                    >
                                        {PAYMENT_METHODS.map(m => (
                                            <option key={m.value} value={m.value}>{m.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="payment-field-group">
                                    <label htmlFor={'refund-reason-' + member.id}>Reason</label>
                                    <input
                                        id={'refund-reason-' + member.id}
                                        className="composer-input"
                                        type="text"
                                        placeholder="e.g., Returned Q1 overpayment"
                                        value={refundReason}
                                        onChange={e => setRefundReason(e.target.value)}
                                    />
                                </div>
                            </div>
                            {refundError && <p className="composer-error">{refundError}</p>}
                            <div className="dialog-buttons">
                                <button type="button" className="btn btn-sm btn-header-secondary" onClick={cancelRefund}>Cancel</button>
                                <button type="submit" className="btn btn-sm btn-primary">Save Refund</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
