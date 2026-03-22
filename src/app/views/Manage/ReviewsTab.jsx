/**
 * ReviewsTab — dispute cards with filter bar and detail dialog.
 * Port of loadDisputes()/renderDisputes() from main.js:3116.
 */
import { useState } from 'react';
import { useDisputes } from '../../hooks/useDisputes.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { DISPUTE_STATUS_LABELS } from '../../../lib/constants.js';
import { disputeStatusClass, formatFileSize } from '../../../lib/formatting.js';
import EmptyState from '../../components/EmptyState.jsx';
import DisputeDetailDialog from '../../components/DisputeDetailDialog.jsx';

const STATUS_ORDER = { open: 0, in_review: 1, resolved: 2, rejected: 3 };
const ALL_STATUSES = ['open', 'in_review', 'resolved', 'rejected'];

function formatDate(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString();
}

export default function ReviewsTab() {
    const { disputes, loading, error, updateDispute, removeEvidence } = useDisputes();
    const { showToast } = useToast();
    const [filter, setFilter] = useState('actionable');
    const [selectedDispute, setSelectedDispute] = useState(null);

    if (loading) return <p style={{ color: '#666' }}>Loading…</p>;
    if (error) return <p className="composer-error">Error loading review requests: {error}</p>;

    // Compute counts
    const counts = { actionable: 0, all: disputes.length };
    ALL_STATUSES.forEach(s => { counts[s] = 0; });
    disputes.forEach(d => {
        if (counts[d.status] !== undefined) counts[d.status]++;
        if (d.status === 'open' || d.status === 'in_review') counts.actionable++;
    });

    // Filter
    let filtered;
    if (filter === 'actionable') {
        filtered = disputes.filter(d => d.status === 'open' || d.status === 'in_review');
    } else if (filter === 'all') {
        filtered = disputes;
    } else {
        filtered = disputes.filter(d => d.status === filter);
    }

    // Sort: open → in_review → resolved → rejected
    filtered.sort((a, b) => (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0));

    // Use compact filter bar for ≤3 disputes
    const compact = disputes.length <= 3;

    const filters = compact
        ? [
            { key: 'actionable', label: 'Actionable' },
            { key: 'all', label: 'All Requests' }
        ]
        : [
            { key: 'actionable', label: 'Actionable' },
            { key: 'all', label: 'All' },
            ...ALL_STATUSES.map(s => ({ key: s, label: DISPUTE_STATUS_LABELS[s] || s }))
        ];

    return (
        <div className="reviews-tab">
            <div className="tab-header">
                <h3>Review Requests ({disputes.length})</h3>
            </div>

            {disputes.length > 0 && (
                <div className="dispute-filter-bar">
                    {filters.map(f => (
                        <button
                            key={f.key}
                            className={'dispute-filter-btn' + (filter === f.key ? ' active' : '')}
                            data-status={f.key}
                            onClick={() => setFilter(f.key)}
                        >
                            {f.label}
                            <span className="dispute-filter-count">{counts[f.key] ?? 0}</span>
                        </button>
                    ))}
                </div>
            )}

            {disputes.length === 0 ? (
                <EmptyState
                    title="No review requests"
                    message="Review requests from members will appear here when submitted via share links."
                />
            ) : filtered.length === 0 ? (
                <p className="dispute-empty">No disputes match this filter.</p>
            ) : (
                <div className="dispute-list">
                    {filtered.map(d => (
                        <DisputeCard
                            key={d.id}
                            dispute={d}
                            onClick={() => setSelectedDispute(d)}
                        />
                    ))}
                </div>
            )}

            <DisputeDetailDialog
                open={selectedDispute !== null}
                dispute={selectedDispute}
                onUpdate={async (id, fields) => {
                    await updateDispute(id, fields);
                    setSelectedDispute(null);
                }}
                onRemoveEvidence={removeEvidence}
                onClose={() => setSelectedDispute(null)}
                showToast={showToast}
            />
        </div>
    );
}

function DisputeCard({ dispute, onClick }) {
    const statusLabel = DISPUTE_STATUS_LABELS[dispute.status] || dispute.status;
    const statusCls = disputeStatusClass(dispute.status);
    const evidenceCount = (dispute.evidence || []).length;
    const userReview = dispute.userReview;

    let userReviewLabel = '';
    if (userReview) {
        if (userReview.state === 'requested') userReviewLabel = 'Awaiting User';
        else if (userReview.state === 'approved_by_user') userReviewLabel = 'User Approved';
        else if (userReview.state === 'rejected_by_user') userReviewLabel = 'User Rejected';
    }

    return (
        <div className={'dispute-card dispute-card--' + dispute.status} onClick={onClick}>
            <div className="dispute-card-header">
                <span className="dispute-card-bill">{dispute.billName || 'Unknown Bill'}</span>
                <div className="dispute-card-badges">
                    {evidenceCount > 0 && (
                        <span className="dispute-evidence-badge">{evidenceCount} file{evidenceCount !== 1 ? 's' : ''}</span>
                    )}
                    {userReviewLabel && (
                        <span className={'dispute-user-review-badge dispute-user-review--' + (userReview.state || '')}>{userReviewLabel}</span>
                    )}
                    <span className={'dispute-status-badge ' + statusCls}>{statusLabel}</span>
                </div>
            </div>
            <div className="dispute-card-meta">
                From {dispute.memberName || 'Unknown'} &middot; {formatDate(dispute.createdAt)}
            </div>
            {dispute.message && (
                <p className="dispute-card-message">{dispute.message.length > 120 ? dispute.message.slice(0, 120) + '…' : dispute.message}</p>
            )}
            {dispute.proposedCorrection && (
                <p className="dispute-card-correction">Correction: {dispute.proposedCorrection}</p>
            )}
        </div>
    );
}
