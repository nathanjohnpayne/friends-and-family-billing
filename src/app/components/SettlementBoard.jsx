/**
 * SettlementBoard — household cards showing per-member settlement status.
 * Port of updateSummary() from main.js:1914.
 */
import { useState } from 'react';
import { calculateAnnualSummary, getPaymentTotalForMember, isLinkedToAnyone } from '../../lib/calculations.js';
import { getInitials, formatAnnualSummaryCurrency } from '../../lib/formatting.js';
import StatusBadge, { getPaymentStatus } from './StatusBadge.jsx';

/**
 * @param {{ familyMembers: Array, bills: Array, payments: Array, readOnly: boolean }} props
 */
export default function SettlementBoard({ familyMembers, bills, payments, readOnly }) {
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
                </div>
            </div>

            <div className="settlement-rows">
                {filtered.length === 0 ? (
                    <p className="settlement-empty">No households match this filter.</p>
                ) : (
                    filtered.map(row => (
                        <HouseholdCard key={row.member.id} row={row} payments={payments} />
                    ))
                )}
            </div>
        </div>
    );
}

function HouseholdCard({ row, payments }) {
    const [expanded, setExpanded] = useState(false);
    const { member, data, combinedTotal, linkedData, payment, balance, status } = row;
    const hasLinked = (member.linkedMembers || []).length > 0;

    return (
        <div className={'settlement-card settlement-card--' + status}>
            <div className="settlement-card-main" onClick={() => setExpanded(!expanded)}>
                <div className="settlement-card-left">
                    <div className="settlement-avatar">
                        {member.avatar
                            ? <img src={member.avatar} alt={member.name} className="settlement-avatar-img" />
                            : <span className="settlement-avatar-initials">{getInitials(member.name)}</span>
                        }
                    </div>
                    <div className="settlement-card-info">
                        <strong>{member.name}</strong>
                        <span className="settlement-card-meta">
                            {hasLinked
                                ? 'Household · ' + member.linkedMembers.length + ' linked'
                                : 'Individual'}
                        </span>
                    </div>
                </div>
                <div className="settlement-card-right">
                    <div className="settlement-card-amounts">
                        <span className="settlement-card-total">{formatAnnualSummaryCurrency(combinedTotal)}</span>
                        <span className="settlement-card-paid">Paid {formatAnnualSummaryCurrency(payment)}</span>
                    </div>
                    <StatusBadge status={status} />
                    <span className="settlement-expand-icon">{expanded ? '▾' : '▸'}</span>
                </div>
            </div>

            {expanded && (
                <div className="settlement-card-detail">
                    <div className="settlement-breakdown">
                        <div className="settlement-breakdown-header">Bill breakdown for {member.name}</div>
                        {data.bills.length === 0 ? (
                            <p className="settlement-breakdown-empty">No bills assigned</p>
                        ) : (
                            data.bills.map(b => (
                                <div key={b.bill.id} className="settlement-breakdown-row">
                                    <span>{b.bill.name}</span>
                                    <span>{formatAnnualSummaryCurrency(b.annualShare)} / yr</span>
                                </div>
                            ))
                        )}
                    </div>

                    {linkedData.map(ls => {
                        const childPayment = getPaymentTotalForMember(payments, ls.member.id);
                        const childBalance = ls.total - childPayment;
                        const childStatus = getPaymentStatus(ls.total, childPayment);
                        return (
                            <div key={ls.member.id} className="settlement-linked-row">
                                <div className="settlement-linked-member">
                                    <span className="child-indicator">↳</span>
                                    <div className="settlement-avatar settlement-avatar--sm">
                                        {ls.member.avatar
                                            ? <img src={ls.member.avatar} alt={ls.member.name} className="settlement-avatar-img" />
                                            : <span className="settlement-avatar-initials">{getInitials(ls.member.name)}</span>
                                        }
                                    </div>
                                    <strong>{ls.member.name}</strong>
                                </div>
                                <div className="settlement-linked-amounts">
                                    <span>{formatAnnualSummaryCurrency(ls.total)}</span>
                                    <span>Paid {formatAnnualSummaryCurrency(childPayment)}</span>
                                    <span className={childBalance > 0 ? 'balance-owed' : 'balance-paid'}>
                                        Bal {formatAnnualSummaryCurrency(childBalance)}
                                    </span>
                                    {childStatus && <StatusBadge status={childStatus} />}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
