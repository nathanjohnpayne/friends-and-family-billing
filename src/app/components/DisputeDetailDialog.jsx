/**
 * DisputeDetailDialog — detail view for a single dispute with actions.
 * Port of showDisputeDetail() from main.js:3294.
 */
import { useState, useEffect, useRef } from 'react';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase.js';
import { DISPUTE_STATUS_LABELS } from '../../lib/constants.js';
import { disputeStatusClass, formatFileSize } from '../../lib/formatting.js';
import ConfirmDialog from './ConfirmDialog.jsx';

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
    const [resolutionNote, setResolutionNote] = useState('');
    const [actionConfirm, setActionConfirm] = useState(null);
    const [noteError, setNoteError] = useState('');
    const noteRef = useRef(null);

    // Sync resolutionNote when dispute changes (fixes note bleed between disputes)
    useEffect(() => {
        setResolutionNote(dispute ? (dispute.resolutionNote || '') : '');
        setNoteError('');
        setActionConfirm(null);
    }, [dispute?.id]);

    if (!open || !dispute) return null;

    const terminal = isTerminal(dispute.status);
    const statusLabel = DISPUTE_STATUS_LABELS[dispute.status] || dispute.status;
    const statusCls = disputeStatusClass(dispute.status);

    function handleActionClick(newStatus) {
        // Enforce resolution note for resolve/reject (mirrors main.js:3533)
        if ((newStatus === 'resolved' || newStatus === 'rejected') && !resolutionNote.trim()) {
            setNoteError('Please add a resolution note before ' + (newStatus === 'resolved' ? 'resolving' : 'rejecting') + '.');
            if (noteRef.current) noteRef.current.focus();
            return;
        }
        setNoteError('');
        setActionConfirm(newStatus);
    }

    async function doAction(newStatus) {
        const fields = { status: newStatus, resolutionNote: resolutionNote.trim() };
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
                        ref={noteRef}
                        className={'composer-input' + (noteError ? ' input-error' : '')}
                        rows={3}
                        placeholder="Add a resolution note..."
                        value={resolutionNote}
                        onChange={e => { setResolutionNote(e.target.value); setNoteError(''); }}
                        disabled={terminal}
                    />
                    {noteError && <p className="composer-error">{noteError}</p>}
                </div>

                {dispute.evidence && dispute.evidence.length > 0 && (
                    <div className="dispute-detail-section">
                        <div className="dispute-detail-label">Evidence ({dispute.evidence.length} file{dispute.evidence.length !== 1 ? 's' : ''})</div>
                        <div className="evidence-list">
                            {dispute.evidence.map((item, i) => (
                                <EvidenceItem
                                    key={i}
                                    item={item}
                                    index={i}
                                    terminal={terminal}
                                    onRemove={handleRemoveEvidence}
                                />
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
                        <button className="btn btn-sm btn-primary" onClick={() => handleActionClick('resolved')}>
                            Resolve
                        </button>
                        <button className="btn btn-sm btn-destructive" onClick={() => handleActionClick('rejected')}>
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

/** Evidence item that resolves storagePath to downloadUrl on demand. */
function EvidenceItem({ item, index, terminal, onRemove }) {
    const [viewUrl, setViewUrl] = useState(item.downloadUrl || null);
    const [loading, setLoading] = useState(false);

    async function handleView() {
        if (viewUrl) {
            window.open(viewUrl, '_blank', 'noopener,noreferrer');
            return;
        }
        if (!item.storagePath) return;
        setLoading(true);
        try {
            const url = await getDownloadURL(ref(storage, item.storagePath));
            setViewUrl(url);
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err) {
            console.error('Failed to get download URL:', err);
        }
        setLoading(false);
    }

    const canView = !!(item.downloadUrl || item.storagePath);

    return (
        <div className="evidence-item">
            <div className="evidence-info">
                <span className="evidence-name">{item.name || 'File ' + (index + 1)}</span>
                {item.size > 0 && <span className="evidence-size">{formatFileSize(item.size)}</span>}
            </div>
            <div className="evidence-actions">
                {canView && (
                    <button className="btn btn-sm btn-tertiary" onClick={handleView} disabled={loading}>
                        {loading ? 'Loading...' : 'View'}
                    </button>
                )}
                {!terminal && (
                    <button className="btn btn-sm btn-tertiary" style={{ color: 'var(--color-danger)' }} onClick={() => onRemove(index)}>
                        Remove
                    </button>
                )}
            </div>
        </div>
    );
}
