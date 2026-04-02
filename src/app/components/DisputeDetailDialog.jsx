/**
 * DisputeDetailDialog — detail view for a single dispute with actions.
 * Port of showDisputeDetail() from main.js:3294.
 */
import { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage, functions } from '../../lib/firebase.js';
import { DISPUTE_STATUS_LABELS } from '../../lib/constants.js';
import { disputeStatusClass, formatFileSize } from '../../lib/formatting.js';
import { openSmsComposer } from '../../lib/sms.js';
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
 * @param {{ open: boolean, dispute: Object, onUpdate: function, onStatusChange: function, onUploadEvidence: function, onRemoveEvidence: function, onClose: function, showToast?: function, familyMembers?: Array, activeYear?: Object }} props
 */
export default function DisputeDetailDialog({ open, dispute, onUpdate, onStatusChange, onUploadEvidence, onRemoveEvidence, onClose, showToast, familyMembers, activeYear }) {
    const [resolutionNote, setResolutionNote] = useState('');
    const [actionConfirm, setActionConfirm] = useState(null);
    const [noteError, setNoteError] = useState('');
    const [uploading, setUploading] = useState(false);
    const noteRef = useRef(null);
    const fileInputRef = useRef(null);

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
        // Use onStatusChange (closes modal) for terminal actions, onUpdate for in_review
        const handler = (newStatus === 'resolved' || newStatus === 'rejected') ? (onStatusChange || onUpdate) : onUpdate;
        await handler(dispute.id, fields);
        if (showToast) showToast('Dispute ' + newStatus);
        setActionConfirm(null);
        if (newStatus === 'in_review') return; // keep dialog open for in_review
        onClose();
    }

    async function handleRemoveEvidence(index) {
        await onRemoveEvidence(dispute.id, index);
        if (showToast) showToast('Evidence removed');
    }

    async function handleUploadEvidence(e) {
        const file = e.target.files && e.target.files[0];
        if (!file || !onUploadEvidence) return;
        setUploading(true);
        try {
            await onUploadEvidence(dispute.id, file);
            if (showToast) showToast('Evidence uploaded: ' + file.name);
        } catch (err) {
            if (showToast) showToast(err.message);
        }
        setUploading(false);
        // Reset input so same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    async function toggleUserReview(checked) {
        // Mirrors main.js:3549 — set userReview.state to 'requested' or remove it
        if (checked) {
            await onUpdate(dispute.id, { userReview: { state: 'requested' } });
        } else {
            await onUpdate(dispute.id, { userReview: null });
        }
        if (showToast) showToast(checked ? 'User approval requested' : 'User approval request removed');
    }

    const userReviewState = dispute.userReview ? dispute.userReview.state : null;
    const evidenceCount = (dispute.evidence || []).length;

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog dialog--wide dispute-detail-dialog" onClick={e => e.stopPropagation()}>
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

                <div className="dispute-detail-section">
                    <div className="dispute-detail-label">Evidence ({evidenceCount} file{evidenceCount !== 1 ? 's' : ''})</div>
                    {evidenceCount > 0 && (
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
                    )}
                    {!terminal && evidenceCount < 10 && (
                        <div className="evidence-upload">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/pdf,image/png,image/jpeg"
                                onChange={handleUploadEvidence}
                                style={{ display: 'none' }}
                            />
                            <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                                disabled={uploading}
                            >
                                {uploading ? 'Uploading...' : 'Upload Evidence'}
                            </button>
                        </div>
                    )}
                </div>

                {!terminal && (
                    <div className="dispute-detail-section">
                        <div className="checkbox-item">
                            <input
                                type="checkbox"
                                id="dispute-user-review"
                                checked={userReviewState === 'requested'}
                                onChange={e => toggleUserReview(e.target.checked)}
                            />
                            <label htmlFor="dispute-user-review">Request user approval before finalizing</label>
                        </div>
                    </div>
                )}

                {terminal && userReviewState && (
                    <div className="dispute-detail-section">
                        <div className="dispute-detail-label">User Decision</div>
                        <p className="dispute-detail-message">
                            {userReviewState === 'approved_by_user' ? 'Approved by user'
                                : userReviewState === 'rejected_by_user' ? 'Rejected by user'
                                : userReviewState}
                            {dispute.userReview && dispute.userReview.rejectionNote
                                ? '\u2014' + dispute.userReview.rejectionNote
                                : ''}
                        </p>
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

                {terminal && dispute.resolutionNote && (() => {
                    const member = (familyMembers || []).find(m => m.id === dispute.memberId);
                    const yearLabel = activeYear ? (activeYear.label || activeYear.id) : '';
                    const statusWord = dispute.status === 'resolved' ? 'resolved' : 'reviewed';

                    function buildResolutionText() {
                        let text = 'Hi ' + (member ? member.name : 'there') + ',\n\n';
                        text += 'Your review request for ' + dispute.billName + ' (' + yearLabel + ') has been ' + statusWord + '.\n\n';
                        text += 'Resolution: ' + dispute.resolutionNote + '\n';
                        if (dispute.proposedCorrection) text += 'Your suggestion: ' + dispute.proposedCorrection + '\n';
                        text += '\nIf you have questions, please reach out.\n\nThanks!';
                        return text;
                    }

                    return (
                        <div className="dispute-share-actions">
                            <span className="dispute-share-label">Share Resolution:</span>
                            {member && member.email && (
                                <button className="btn btn-sm btn-secondary" onClick={async () => {
                                    const subject = 'Review Request Update\u2014' + dispute.billName + ' (' + yearLabel + ')';
                                    const body = buildResolutionText();
                                    try {
                                        const sendEmail = httpsCallable(functions, 'sendEmail');
                                        await sendEmail({ to: member.email, subject, body });
                                        if (showToast) showToast('Resolution emailed to ' + member.email);
                                    } catch (err) {
                                        if (showToast) showToast('Send failed: ' + (err.message || 'Unknown error'));
                                    }
                                }}>Email</button>
                            )}
                            {member && member.phone && (
                                <button className="btn btn-sm btn-secondary" onClick={() => {
                                    openSmsComposer(member.phone, buildResolutionText(), () => {
                                        if (showToast) showToast('Resolution copied\u2014paste into your messaging app');
                                    });
                                }}>Text</button>
                            )}
                            <button className="btn btn-sm btn-secondary" onClick={() => {
                                navigator.clipboard.writeText(buildResolutionText()).then(() => {
                                    if (showToast) showToast('Resolution copied');
                                });
                            }}>Copy</button>
                        </div>
                    );
                })()}

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
