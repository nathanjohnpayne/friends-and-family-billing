/**
 * BillAuditHistoryDialog — audit log for a single bill.
 * Port of showBillAuditHistory() from main.js:1473.
 */
import { BILLING_EVENT_LABELS } from '../../lib/formatting.js';

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
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog dialog--wide" onClick={e => e.stopPropagation()}>
                <div className="dialog-title">History: {billName}</div>

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

                <div className="dialog-buttons">
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
