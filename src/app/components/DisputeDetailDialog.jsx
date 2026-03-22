/**
 * DisputeDetailDialog — detail view for a single dispute with actions.
 * Port of showDisputeDetail() from main.js:3294.
 */
import { useState } from 'react';
import { DISPUTE_STATUS_LABELS } from '../../lib/constants.js';
import { disputeStatusClass, formatFileSize } from '../../lib/formatting.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const STATUS_ORDER = { open: 0, in_review: 1, resolved: 2, rejected: 3 };

function isTerminal(status) {
    return status === 'resolved' || status === 'rejected';
}

function formatDate(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString();
}

/**
 * @param {{ open: boolean, dispute: Object, onUpdate: function, onRemoveEvidence: function, onClose: function, showToast?: function }} props
 */
export default function DisputeDetailDialog({ open, dispute, onUpdate, onRemoveEvidence, onClose, showToast }) {
    const [resolutionNote, setResolutionNote] = useState(dispute ? (dispute.resolutionNote || '') : '');
    const [actionConfirm, setActionConfirm] = useState(null);

    if (!open || !dispute) return null;

    const terminal = isTerminal(dispute.status);
    const statusLabel = DISPUTE_STATUS_LABELS[dispute.status] || dispute.status;
    const statusCls = disputeStatusClass(dispute.status);

    async function doAction(newStatus) {
        const fields = { status: newStatus, resolutionNote };
        if (newStatus === 'resolved') fields.resolvedAt = new Date().toISOString();
        if (newStatus === 'rejected') fields.rejectedAt = new Date().toISOString();
        await onUpdate(dispute.id, fields);
        if (showToast) showToast('Dispute ' + newStatus);
        setActionConfirm(null);
        onClose();
    }

    async function handleRemoveEvidence(index) {
        await onRemoveEvidence(dispute.id, index);
        if (showToast) showToast('Evidence removed');
    }

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog dialog--wide" onClick={e => e.stopPropagation()}>
                <div className="dispute-detail-header">
                    <div className="dispute-detail-title">
                        <strong>{dispute.billName || 'Unknown Bill'}</strong>
                        <span className={'dispute-status-badge ' + statusCls}>{statusLabel}</span>
                    </div>
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>&times;</button>
                </div>

                <div className="dispute-detail-meta">
                    <span>From {dispute.memberName || 'Unknown'}</span>
                    <span>&middot;</span>
                    <span>{formatDate(dispute.createdAt)}</span>
                    {dispute.resolvedAt && <span>&middot; Resolved {formatDate(dispute.resolvedAt)}</span>}
                    {dispute.rejectedAt && <span>&middot; Rejected {formatDate(dispute.rejectedAt)}</span>}
                </div>

                <div className="dispute-detail-section">
                    <div className="dispute-detail-label">Message</div>
                    <p className="dispute-detail-message">{dispute.message || 'No message provided.'}</p>
                </div>

                {dispute.proposedCorrection && (
                    <div className="dispute-detail-section">
                        <div className="dispute-detail-label">Proposed Correction</div>
                        <p className="dispute-detail-correction">{dispute.proposedCorrection}</p>
                    </div>
                )}

                <div className="dispute-detail-section">
                    <div className="dispute-detail-label">Resolution Note</div>
                    <textarea
                        className="composer-input"
                        rows={3}
                        placeholder="Add a resolution note..."
                        value={resolutionNote}
                        onChange={e => setResolutionNote(e.target.value)}
                        disabled={terminal}
                    />
                </div>

                {dispute.evidence && dispute.evidence.length > 0 && (
                    <div className="dispute-detail-section">
                        <div className="dispute-detail-label">Evidence ({dispute.evidence.length} file{dispute.evidence.length !== 1 ? 's' : ''})</div>
                        <div className="evidence-list">
                            {dispute.evidence.map((item, i) => (
                                <div key={i} className="evidence-item">
                                    <div className="evidence-info">
                                        <span className="evidence-name">{item.name || 'File ' + (i + 1)}</span>
                                        {item.size > 0 && <span className="evidence-size">{formatFileSize(item.size)}</span>}
                                    </div>
                                    <div className="evidence-actions">
                                        {item.url && (
                                            <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-tertiary">
                                                View
                                            </a>
                                        )}
                                        {!terminal && (
                                            <button className="btn btn-sm btn-tertiary" style={{ color: 'var(--color-danger)' }} onClick={() => handleRemoveEvidence(i)}>
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {!terminal && (
                    <div className="dispute-detail-actions">
                        {dispute.status === 'open' && (
                            <button className="btn btn-sm btn-secondary" onClick={() => doAction('in_review')}>
                                Mark In Review
                            </button>
                        )}
                        <button className="btn btn-sm btn-primary" onClick={() => setActionConfirm('resolved')}>
                            Resolve
                        </button>
                        <button className="btn btn-sm btn-destructive" onClick={() => setActionConfirm('rejected')}>
                            Reject
                        </button>
                    </div>
                )}

                {terminal && (
                    <div className="dialog-buttons">
                        <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                    </div>
                )}

                <ConfirmDialog
                    open={actionConfirm !== null}
                    title={actionConfirm === 'resolved' ? 'Resolve Dispute' : 'Reject Dispute'}
                    message={actionConfirm === 'resolved'
                        ? 'Mark this dispute as resolved? The member will be notified.'
                        : 'Reject this dispute? The member will be notified.'}
                    confirmLabel={actionConfirm === 'resolved' ? 'Resolve' : 'Reject'}
                    destructive={actionConfirm === 'rejected'}
                    onConfirm={() => doAction(actionConfirm)}
                    onCancel={() => setActionConfirm(null)}
                />
            </div>
        </div>
    );
}
