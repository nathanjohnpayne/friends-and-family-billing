/**
 * RefundNoticesTab — the administrator's view of outbound Refund Notices (#319).
 *
 * Refund Notices are NOT Review Requests (ADR 0002): they live on their own tab,
 * excluded from the Open Reviews KPI and the actionable review filter. The one
 * actionable state here is an ACTIVE, UNRESOLVED `not_received` report — surfaced
 * as a follow-up with three resolution paths (re-send / cancel / dismiss-with-
 * reason, ADR 0003). Resolving writes a resolution forward on the notice; it never
 * reopens a closed year (ADR 0007).
 */
import { useToast } from '../../contexts/ToastContext.jsx';
import { useRefundNotices } from '../../hooks/useRefundNotices.js';
import { refundNoticeConfirmationLabel, isActiveNotReceived } from '../../../lib/refundNotice.js';
import { getPaymentMethodLabel, formatAnnualSummaryCurrency } from '../../../lib/formatting.js';
import EmptyState from '../../components/EmptyState.jsx';

function formatDate(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString();
}

export default function RefundNoticesTab() {
    const { refundNotices, loading, error, activeNotReceivedCount, resolveNotice } = useRefundNotices();
    const { showToast } = useToast();

    if (loading) return <p style={{ color: '#666' }}>Loading…</p>;
    if (error) return <p className="composer-error">Error loading refund notices: {error}</p>;

    async function handleResolve(noticeId, resolution, toastMsg) {
        try {
            await resolveNotice(noticeId, resolution);
            showToast(toastMsg);
        } catch (err) {
            showToast('Error: ' + err.message);
        }
    }

    function onResend(notice) {
        handleResolve(notice.id, { type: 'resent' }, 'Refund notice marked re-sent');
    }
    function onCancel(notice) {
        handleResolve(notice.id, { type: 'cancelled' }, 'Refund notice cancelled');
    }
    function onDismiss(notice) {
        // A dismissal must keep the member's objection in the audit trail (ADR 0003):
        // require a logged reason.
        const note = window.prompt('Why are you dismissing this not-received report? (logged)');
        if (note === null || !note.trim()) return;
        handleResolve(notice.id, { type: 'dismissed', note: note.trim() }, 'Not-received report dismissed');
    }

    return (
        <div className="refund-notices-tab">
            <div className="tab-header">
                <h3>Refund Notices ({refundNotices.length})</h3>
            </div>

            {activeNotReceivedCount > 0 && (
                <div className="admin-hint refund-followup-banner">
                    {activeNotReceivedCount} refund{activeNotReceivedCount === 1 ? '' : 's'} reported as
                    {' '}not received—needs follow-up.
                </div>
            )}

            {refundNotices.length === 0 ? (
                <EmptyState
                    title="No refund notices"
                    message="When you issue a refund, the member is notified here and can confirm receipt."
                />
            ) : (
                <div className="refund-notice-list">
                    {refundNotices.map(n => (
                        <RefundNoticeCard
                            key={n.id}
                            notice={n}
                            onResend={() => onResend(n)}
                            onCancel={() => onCancel(n)}
                            onDismiss={() => onDismiss(n)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function RefundNoticeCard({ notice, onResend, onCancel, onDismiss }) {
    const actionable = isActiveNotReceived(notice);
    const resolved = !!notice.resolution;
    const confirmationLabel = refundNoticeConfirmationLabel(notice.confirmation);
    const stateClass = notice.confirmation === 'not_received'
        ? 'refund-notice--not-received'
        : notice.confirmation === 'confirmed_by_member'
            ? 'refund-notice--confirmed'
            : 'refund-notice--sent';

    return (
        <div className={'refund-notice-card ' + stateClass}>
            <div className="refund-notice-header">
                <span className="refund-notice-amount">{formatAnnualSummaryCurrency(notice.amount)}</span>
                <span className={'refund-notice-badge refund-notice-badge--' + (notice.confirmation || 'sent')}>
                    {confirmationLabel}
                </span>
            </div>
            <div className="refund-notice-meta">
                To {notice.memberName || 'Unknown'} · {getPaymentMethodLabel(notice.method)} · {formatDate(notice.createdAt)}
            </div>
            {notice.reason && <p className="refund-notice-reason">Reason: {notice.reason}</p>}

            {actionable && (
                <div className="refund-notice-actions">
                    <button className="btn btn-sm btn-primary" onClick={onResend}>Re-send Refund</button>
                    <button className="btn btn-sm btn-secondary" onClick={onCancel}>Cancel Refund</button>
                    <button className="btn btn-sm btn-tertiary" onClick={onDismiss}>Dismiss Report</button>
                </div>
            )}
            {resolved && (
                <p className="refund-notice-resolution">
                    Resolved ({notice.resolution.type}){notice.resolution.note ? ': ' + notice.resolution.note : ''}
                </p>
            )}
        </div>
    );
}
