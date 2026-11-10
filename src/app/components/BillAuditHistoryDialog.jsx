/**
 * BillAuditHistoryDialog — audit log for a single bill.
 * Port of showBillAuditHistory() from main.js:1473.
 */
import { BILLING_EVENT_LABELS } from '../../lib/formatting.js';
import Dialog from './Dialog.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = value => '$' + value.toFixed(2);
const isMoney = value => typeof value === 'number' && Number.isFinite(value);

/** 'YYYY-MM' → 'Jul'; null when the value is not a month. */
function monthAbbr(value) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
    return MONTHS[Number(value.slice(5)) - 1];
}

function acrossMembers(amount, count) {
    return money(amount) + ' across ' + count + ' member' + (count === 1 ? '' : 's');
}

/**
 * Year-End Review detail lines (specs/year-end-review.md § Bill history). Returns null
 * for an event without the review payload, so it renders as it did before.
 */
function reviewDetail(evt) {
    const p = evt.payload;
    switch (evt.eventType) {
        case 'BILL_PRICE_ROLLED_OVER':
            if (!isMoney(p.previousValue) || !isMoney(p.newValue)) return null;
            return money(p.previousValue) + ' → ' + money(p.newValue) + (p.fromYear ? ' (from ' + p.fromYear + ')' : '');
        case 'TRUE_UP_RECORDED': {
            const calc = p.calc || {};
            const first = monthAbbr(calc.firstMonth);
            if (!first || !isMoney(p.amount) || !Number.isInteger(p.memberCount)) return null;
            const total = acrossMembers(p.amount, p.memberCount);
            if (p.basis === 'late_start' && isMoney(calc.toAmount)) {
                return 'Started ' + first + ' at ' + money(calc.toAmount) + (calc.frequency === 'annual' ? ' / year' : ' / month') + ' · ' + total;
            }
            if (p.basis === 'price_change' && isMoney(calc.fromAmount) && isMoney(calc.toAmount)) {
                return money(calc.fromAmount) + ' → ' + money(calc.toAmount) + ' from ' + first + ' · ' + total;
            }
            return null;
        }
        case 'SERVICE_CREDIT_RECORDED': {
            const last = monthAbbr(p.calc?.lastMonth);
            if (p.basis !== 'ended' || !last || !isMoney(p.amount) || !Number.isInteger(p.memberCount)) return null;
            return 'Ended after ' + last + ' · ' + acrossMembers(p.amount, p.memberCount);
        }
        default:
            return null;
    }
}

/**
 * @param {{ open: boolean, billId: number, billName: string, billingEvents: Array, onClose: function }} props
 */
export default function BillAuditHistoryDialog({ open, billId, billName, billingEvents, onClose }) {
    if (!open) return null;

    const events = (billingEvents || [])
        .filter(e => e.payload && e.payload.billId === billId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    function getDetail(evt) {
        if (!evt.payload) return '';
        const review = reviewDetail(evt);
        if (review) return review;
        switch (evt.eventType) {
            case 'BILL_CREATED': {
                const freq = evt.payload.billingFrequency === 'annual' ? ' / year' : ' / month';
                return '$' + (evt.payload.amount || 0).toFixed(2) + freq;
            }
            case 'BILL_UPDATED':
                if (evt.payload.field === 'amount') {
                    return '$' + (evt.payload.previousValue || 0).toFixed(2) + ' \u2192 $' + (evt.payload.newValue || 0).toFixed(2);
                }
                if (evt.payload.field === 'name' || evt.payload.field === 'billingFrequency') {
                    return (evt.payload.previousValue || '') + ' \u2192 ' + (evt.payload.newValue || '');
                }
                return '';
            case 'MEMBER_ADDED_TO_BILL':
                return (evt.payload.memberName || '') + ' joined';
            case 'MEMBER_REMOVED_FROM_BILL':
                return (evt.payload.memberName || '') + ' left';
            case 'BILL_DELETED':
                return 'Bill removed';
            default:
                return '';
        }
    }

    return (
        <Dialog
            onClose={onClose}
            wide
            title={<>History: {billName}</>}
            footer={<button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>}
        >
            {events.length === 0 ? (
                <p className="audit-empty">No history recorded yet</p>
            ) : (
                <div className="audit-event-list">
                    {events.map(evt => {
                        const date = new Date(evt.timestamp).toLocaleString();
                        const label = BILLING_EVENT_LABELS[evt.eventType] || evt.eventType;
                        const detail = getDetail(evt);
                        return (
                            <div key={evt.id} className="audit-event-item">
                                <div className="audit-event-header">
                                    <span className="audit-event-label">{label}</span>
                                    <span className="audit-event-date">{date}</span>
                                </div>
                                {detail && <div className="audit-event-detail">{detail}</div>}
                                {evt.note && <div className="audit-event-note">{evt.note}</div>}
                            </div>
                        );
                    })}
                </div>
            )}
        </Dialog>
    );
}
