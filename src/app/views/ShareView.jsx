/**
 * ShareView — public billing summary page (no auth required).
 * Port of share.html inline JS (~700 lines) to React.
 * Reads share token from URL, resolves via publicShares or Cloud Function,
 * renders member summary, bill tables, payment progress, payment methods.
 */
import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { hashToken } from '../../lib/validation.js';
import { getPaymentMethodIcon } from '../../lib/formatting.js';
import CompanyLogo from '../components/CompanyLogo.jsx';

const STATUS_LABELS = { open: 'Open', in_review: 'In Review', resolved: 'Resolved', rejected: 'Rejected' };

function formatCurrency(amount) {
    return '$' + Number(amount || 0).toFixed(2);
}

export default function ShareView() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [data, setData] = useState(null);
    const [timedOut, setTimedOut] = useState(false);
    const [shareCtx, setShareCtx] = useState({ token: null, tokenHash: null, ownerId: null, billingYearId: null, memberId: null, memberName: '', canDispute: false, canDisputeRead: false });

    useEffect(() => {
        loadShareData();
        const timer = setTimeout(() => setTimedOut(true), 12000);
        return () => clearTimeout(timer);
    }, []);

    async function loadShareData() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        if (!token) {
            setError('No share token provided. Please check your link.');
            setLoading(false);
            return;
        }

        try {
            const tokenHash = await hashToken(token);
            let shareData = null;

            // Try publicShares first (eager cache)
            const publicDoc = await getDoc(doc(db, 'publicShares', tokenHash));
            if (publicDoc.exists()) {
                shareData = publicDoc.data();
                // Bump access count
                updateDoc(doc(db, 'publicShares', tokenHash), {
                    accessCount: increment(1),
                    lastAccessedAt: new Date().toISOString()
                }).catch(() => {});

                // If cache is stale (>1 hour), refresh in background via Cloud Function
                // so next visit gets fresh data (e.g., preferred payment method changes)
                const CACHE_MAX_AGE_MS = 60 * 60 * 1000;
                const updatedAt = shareData.updatedAt && shareData.updatedAt.toDate ? shareData.updatedAt.toDate() : null;
                if (!updatedAt || (Date.now() - updatedAt.getTime() > CACHE_MAX_AGE_MS)) {
                    fetch('/resolveShareToken', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token })
                    }).catch(() => {});
                }
            } else {
                // Fall back to Cloud Function
                const resp = await fetch('/resolveShareToken', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                if (!resp.ok) {
                    const errData = await resp.json().catch(() => ({}));
                    setError(errData.error || 'This link is invalid or has been removed.');
                    setLoading(false);
                    return;
                }
                shareData = await resp.json();
            }

            const scopes = shareData.scopes || [];
            setShareCtx({
                token,
                tokenHash,
                ownerId: shareData.ownerId || null,
                billingYearId: shareData.billingYearId || null,
                memberId: shareData.memberId || (shareData.summary && shareData.summary.memberId) || null,
                memberName: shareData.memberName || '',
                canDispute: scopes.includes('disputes:create'),
                canDisputeRead: scopes.includes('disputes:read')
            });
            setData(shareData);
        } catch (err) {
            console.error('Share page error:', err);
            setError('Could not connect to the server. Please try again later.');
        }
        setLoading(false);
    }

    if (loading) {
        return (
            <div className="share-page share-loading">
                <div className="share-state-card">
                    <div className="share-spinner" />
                    <h2>Loading your annual billing summary...</h2>
                    <p>This secure page is preparing your latest billing details.</p>
                    {timedOut && (
                        <div className="share-timeout-hint">
                            <p>This is taking longer than expected.</p>
                            <button className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>Retry</button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="share-page share-error">
                <div className="share-state-card">
                    <h2>Unable to Load Summary</h2>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="share-page">
            <ShareHeader data={data} />
            {data.summary && <HouseholdBillsSection data={data} canDispute={shareCtx.canDispute} shareCtx={shareCtx} />}
            {data.paymentSummary && <PaymentSummarySection ps={data.paymentSummary} year={data.year} />}
            {data.paymentMethods && data.paymentMethods.length > 0 && <PaymentMethodsSection methods={data.paymentMethods} ownerId={shareCtx.ownerId} />}
            {data.disputes && data.disputes.length > 0 && <DisputesSection disputes={data.disputes} shareCtx={shareCtx} />}
        </div>
    );
}

function deriveLastName(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : fullName;
}

function ShareHeader({ data }) {
    const lastName = deriveLastName(data.memberName);
    return (
        <header className="share-header">
            <h1>{lastName} Family's Annual Billing Summary</h1>
            <p className="share-subtitle">Your shared billing summary for {data.year}.</p>
        </header>
    );
}

function MemberRow({ member, canDispute, onRequestReview, defaultExpanded }) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const billCount = member.bills ? member.bills.length : 0;
    const monthlyTotal = member.bills ? member.bills.reduce((s, b) => s + (b.monthlyShare || 0), 0) : 0;

    if (defaultExpanded) {
        return (
            <div className="share-member-row">
                <h3 className="share-member-name">{member.name}</h3>
                <BillsTable bills={member.bills} canDispute={canDispute} onRequestReview={onRequestReview} />
            </div>
        );
    }

    return (
        <div className="share-member-row">
            <button className="share-member-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
                <span className={'share-member-arrow' + (expanded ? ' expanded' : '')}>&#9654;</span>
                <span>{member.name}—{billCount} {billCount === 1 ? 'bill' : 'bills'} ({formatCurrency(monthlyTotal)}/mo)</span>
            </button>
            {expanded && (
                <BillsTable bills={member.bills} canDispute={canDispute} onRequestReview={onRequestReview} />
            )}
        </div>
    );
}

function HouseholdBillsSection({ data, canDispute, shareCtx }) {
    const [disputeForm, setDisputeForm] = useState(null);
    const allMembers = [data.summary, ...(data.linkedMembers || [])];
    const isSingleMember = allMembers.length === 1;

    return (
        <div className="share-section">
            {!isSingleMember && data.paymentSummary && (
                <div className="share-household-total">
                    Household Total: {formatCurrency(data.paymentSummary.combinedMonthlyTotal)}/mo · {formatCurrency(data.paymentSummary.combinedAnnualTotal)}/yr
                </div>
            )}

            {allMembers.map(member => (
                <MemberRow
                    key={member.memberId || member.name}
                    member={member}
                    canDispute={canDispute}
                    onRequestReview={bill => setDisputeForm(bill)}
                    defaultExpanded={isSingleMember}
                />
            ))}

            {disputeForm && (
                <DisputeFormOverlay
                    bill={disputeForm}
                    shareCtx={shareCtx}
                    onClose={() => setDisputeForm(null)}
                />
            )}
        </div>
    );
}

function BillsTable({ bills, canDispute, onRequestReview }) {
    if (!bills || bills.length === 0) return <p className="share-hint">No bills assigned.</p>;
    const total = bills.reduce((s, b) => s + (b.annualShare || 0), 0);

    return (
        <div className="share-table-wrap">
            <table className="share-table">
                <thead>
                    <tr>
                        <th>Bill</th>
                        <th className="share-cell-number">Monthly</th>
                        <th className="share-cell-number">Split</th>
                        <th className="share-cell-number">Share</th>
                        <th className="share-cell-number">Annual</th>
                        {canDispute && <th></th>}
                    </tr>
                </thead>
                <tbody>
                    {bills.map((b, i) => (
                        <tr key={b.billId || i}>
                            <td style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CompanyLogo logo={b.logo} website={b.website} name={b.name || 'Bill'} size={28} />
                                <strong>{b.name || 'Unnamed Bill'}</strong>
                            </td>
                            <td className="share-cell-number">{formatCurrency(b.monthlyAmount)}</td>
                            <td className="share-cell-number">{b.splitCount} {b.splitCount === 1 ? 'member' : 'members'}</td>
                            <td className="share-cell-number">{formatCurrency(b.monthlyShare)}</td>
                            <td className="share-cell-number">{formatCurrency(b.annualShare)}</td>
                            {canDispute && (
                                <td><button className="share-review-btn" onClick={() => onRequestReview(b)}>Question This</button></td>
                            )}
                        </tr>
                    ))}
                    <tr className="share-total-row">
                        <td colSpan={3}>TOTAL</td>
                        <td className="share-cell-number">{formatCurrency(total / 12)}</td>
                        <td className="share-cell-number"><strong>{formatCurrency(total)}</strong></td>
                        {canDispute && <td></td>}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

function PaymentSummarySection({ ps, year }) {
    const pctPaid = ps.combinedAnnualTotal > 0 ? Math.min(100, Math.round((ps.totalPaid / ps.combinedAnnualTotal) * 100)) : 0;
    const balClass = ps.balanceRemaining > 0 ? 'owed' : '';

    return (
        <div className="share-section">
            <h2>Payment Summary</h2>
            <div className="share-stat-grid">
                <div className="share-stat-card"><div className="share-stat-label">Annual Total</div><div className="share-stat-value">{formatCurrency(ps.combinedAnnualTotal)}</div></div>
                <div className="share-stat-card"><div className="share-stat-label">Monthly</div><div className="share-stat-value">{formatCurrency(ps.combinedMonthlyTotal)}</div></div>
                <div className="share-stat-card"><div className="share-stat-label">Paid to Date</div><div className="share-stat-value paid">{formatCurrency(ps.totalPaid)}</div></div>
                <div className="share-stat-card"><div className="share-stat-label">Balance Remaining</div><div className={'share-stat-value ' + balClass}>{formatCurrency(ps.balanceRemaining)}</div></div>
            </div>
            <div className="share-progress">
                <div className="share-progress-bar" style={{ width: pctPaid + '%' }} />
            </div>
            <div className="share-progress-label">{pctPaid}% paid</div>

            {ps.balanceRemaining > 0 && (
                <div className="share-callout outstanding">
                    <strong>You still have an outstanding balance for {year}.</strong>
                    <p>Amount Remaining: {formatCurrency(ps.balanceRemaining)}</p>
                </div>
            )}
            {ps.balanceRemaining <= 0 && ps.totalPaid > 0 && (
                <div className="share-callout settled">
                    <strong>You're all settled for {year}. Thank you!</strong>
                </div>
            )}
        </div>
    );
}

function PaymentMethodsSection({ methods, ownerId }) {
    const [qrModal, setQrModal] = useState(null);
    const [loadingQr, setLoadingQr] = useState(null);

    function copyText(text, e) {
        const btn = e.currentTarget;
        navigator.clipboard.writeText(text).then(() => {
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        });
    }

    async function loadQrCode(methodId, label) {
        if (!ownerId || !methodId) return;
        if (loadingQr) return; // prevent duplicate clicks
        setLoadingQr(methodId);
        const docId = ownerId + '_' + methodId;
        try {
            const qrDoc = await getDoc(doc(db, 'publicQrCodes', docId));
            if (qrDoc.exists() && qrDoc.data().qrCode) {
                setQrModal({ src: qrDoc.data().qrCode, label });
            } else {
                setQrModal({ src: null, label, missing: true });
            }
        } catch (err) {
            console.error('Failed to load QR code:', err);
            setQrModal({ src: null, label, missing: true });
        }
        setLoadingQr(null);
    }

    const preferredMethod = methods.find(m => m.preferred);
    const otherMethods = methods.filter(m => !m.preferred).sort((a, b) => a.label.localeCompare(b.label));

    function renderCard(pm, className) {
        return (
            <div key={pm.id} className={className}>
                <div className="share-pm-header">
                    <span className="share-pm-icon" dangerouslySetInnerHTML={{ __html: getPaymentMethodIcon(pm.type) }} />
                    <strong>{pm.label}</strong>
                    {pm.preferred && <span className="share-pm-preferred-badge">&#9733; Preferred</span>}
                </div>
                <div className="share-pm-body">
                    {pm.type === 'zelle' && [pm.email, pm.phone].filter(Boolean).map(c => (
                        <div key={c} className="share-pm-detail">
                            <span>{c}</span>
                            <button className="share-copy-btn" onClick={e => copyText(c, e)}>Copy</button>
                        </div>
                    ))}
                    {pm.type === 'apple_cash' && [pm.phone, pm.email].filter(Boolean).map(c => (
                        <div key={c} className="share-pm-detail">
                            <span>{c}</span>
                            <button className="share-copy-btn" onClick={e => copyText(c, e)}>Copy</button>
                        </div>
                    ))}
                    {pm.type !== 'zelle' && pm.type !== 'apple_cash' && pm.handle && (
                        <div className="share-pm-detail">
                            <span>{pm.handle}</span>
                            <button className="share-copy-btn" onClick={e => copyText(pm.handle, e)}>Copy</button>
                        </div>
                    )}
                    {pm.type !== 'zelle' && pm.type !== 'apple_cash' && pm.url && (
                        <div className="share-pm-detail">
                            <a href={pm.url} target="_blank" rel="noopener noreferrer">{pm.url}</a>
                            <button className="share-copy-btn" onClick={e => copyText(pm.url, e)}>Copy link</button>
                        </div>
                    )}
                    {pm.instructions && <p className="share-pm-instructions">{pm.instructions}</p>}
                </div>
                {(pm.qrCode || pm.hasQrCode) && (
                    <button className="share-qr-btn" disabled={loadingQr === pm.id} onClick={() => {
                        if (pm.qrCode) {
                            setQrModal({ src: pm.qrCode, label: pm.label });
                        } else {
                            loadQrCode(pm.id, pm.label);
                        }
                    }}>{loadingQr === pm.id ? 'Loading...' : 'Show QR Code'}</button>
                )}
            </div>
        );
    }

    return (
        <div className="share-section">
            <h2>Payment Methods</h2>
            <p className="share-trust-note">Pay directly through the apps below—Friends &amp; Family Billing doesn't process payments.</p>
            {preferredMethod && renderCard(preferredMethod, 'share-pm-card share-pm-card--preferred')}
            {otherMethods.length > 0 && (
                <div className="share-pm-grid">
                    {otherMethods.map(pm => renderCard(pm, 'share-pm-card'))}
                </div>
            )}

            {qrModal && (
                <div className="dialog-overlay" onClick={() => setQrModal(null)}>
                    <div className="dialog" onClick={e => e.stopPropagation()}>
                        <div className="dialog-title">QR Code — {qrModal.label}</div>
                        {qrModal.src ? (
                            <div className="dialog-body-padded">
                                <img src={qrModal.src} alt={'QR Code for ' + qrModal.label} style={{ maxWidth: '250px', margin: '0 auto', display: 'block' }} />
                            </div>
                        ) : (
                            <p className="dialog-body-padded" style={{ color: 'var(--color-text-secondary, #5B6475)' }}>
                                No QR code available for this payment method.
                            </p>
                        )}
                        <div className="dialog-buttons">
                            <button className="btn btn-sm btn-header-secondary" onClick={() => setQrModal(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function DisputesSection({ disputes, shareCtx }) {
    return (
        <div className="share-section">
            <h2>Your Review Requests</h2>
            <div className="share-disputes-list">
                {disputes.map(d => (
                    <ShareDisputeCard key={d.id} dispute={d} shareCtx={shareCtx} />
                ))}
            </div>
        </div>
    );
}

function ShareDisputeCard({ dispute, shareCtx }) {
    // Only seed from terminal decisions — 'requested' is the actionable state, not a decision.
    const initialDecision = dispute.userReview && dispute.userReview.state !== 'requested'
        ? dispute.userReview.state : null;
    const [decision, setDecision] = useState(initialDecision);
    const d = dispute;
    const label = STATUS_LABELS[d.status] || d.status;
    const created = d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '';

    async function submitDecision(type, decisionNote) {
        if (!shareCtx.token || !shareCtx.ownerId || !shareCtx.billingYearId) return;
        try {
            const resp = await fetch('/submitDisputeDecision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: shareCtx.token,
                    disputeId: d.id,
                    decision: type === 'approve' ? 'approve' : 'reject',
                    ...(type === 'reject' ? { note: decisionNote } : {})
                })
            });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || 'Decision failed');
            }
            setDecision(type === 'approve' ? 'approved_by_user' : 'rejected_by_user');
        } catch (err) {
            console.error('Decision error:', err);
        }
    }

    return (
        <div className={'share-dispute-item share-dispute--' + (d.status || 'open')}>
            <div className="share-dispute-header">
                <strong>{d.billName}</strong>
                <span className={'share-dispute-badge share-dispute-badge--' + d.status}>{label}</span>
            </div>
            {created && <div className="share-dispute-meta">{created}</div>}
            <p className="share-dispute-message">{d.message}</p>
            {d.proposedCorrection && <p className="share-dispute-correction">Suggested: {d.proposedCorrection}</p>}
            {d.resolutionNote && <p className="share-dispute-resolution">Resolution: {d.resolutionNote}</p>}

            {d.evidence && d.evidence.length > 0 && (
                <div className="share-evidence-list">
                    {d.evidence.map((ev, i) => (
                        <ShareEvidenceItem key={i} evidence={ev} index={i} disputeId={d.id} shareCtx={shareCtx} />
                    ))}
                </div>
            )}

            {d.userReview && d.userReview.state === 'requested' && !decision && (
                <div className="share-dispute-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => submitDecision('approve')}>Approve</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => {
                        const note = prompt('Please explain why you are rejecting:');
                        if (note !== null && note.trim()) submitDecision('reject', note.trim());
                    }}>Reject</button>
                </div>
            )}
            {(decision === 'approved_by_user' || (d.userReview && d.userReview.state === 'approved_by_user')) && (
                <p className="share-dispute-decision approved">You approved this resolution.</p>
            )}
            {(decision === 'rejected_by_user' || (d.userReview && d.userReview.state === 'rejected_by_user')) && (
                <p className="share-dispute-decision rejected">You rejected this resolution.</p>
            )}
        </div>
    );
}

function ShareEvidenceItem({ evidence, index, disputeId, shareCtx }) {
    const [loading, setLoading] = useState(false);

    async function handleView() {
        // If downloadUrl is available, use it directly
        if (evidence.downloadUrl) {
            window.open(evidence.downloadUrl, '_blank', 'noopener,noreferrer');
            return;
        }
        // Otherwise fetch via Cloud Function (mirrors share.html:397)
        setLoading(true);
        try {
            const resp = await fetch('/getEvidenceUrl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: shareCtx.token, disputeId, evidenceIndex: index })
            });
            const data = await resp.json();
            if (resp.ok && data.url) {
                window.open(data.url, '_blank', 'noopener,noreferrer');
            }
        } catch (err) {
            console.error('Evidence URL error:', err);
        }
        setLoading(false);
    }

    const isImage = evidence.contentType && evidence.contentType.startsWith('image/');
    return (
        <div className="share-evidence-item">
            <span>{isImage ? '\ud83d\udcf7' : '\ud83d\udcc4'}</span>
            <button className="share-evidence-link" onClick={handleView} disabled={loading}>
                {loading ? 'Loading...' : (evidence.name || 'File ' + (index + 1))}
            </button>
        </div>
    );
}

function DisputeFormOverlay({ bill, shareCtx, onClose }) {
    const [message, setMessage] = useState('');
    const [correction, setCorrection] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [msgError, setMsgError] = useState(false);

    async function handleSubmit() {
        if (!message.trim()) {
            setMsgError(true);
            return;
        }
        if (!shareCtx.token || !shareCtx.ownerId || !shareCtx.billingYearId || !shareCtx.memberId) return;
        setSubmitting(true);
        try {
            const resp = await fetch('/submitDispute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: shareCtx.token,
                    billId: bill.billId,
                    billName: (bill.name || '').trim(),
                    message: message.trim(),
                    proposedCorrection: correction.trim() || null
                })
            });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || 'Submission failed');
            }
            setSuccess(true);
        } catch (err) {
            console.error('Dispute submission error:', err);
        }
        setSubmitting(false);
    }

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog dialog--wide" onClick={e => e.stopPropagation()}>
                {success ? (
                    <>
                        <div className="dialog-title">Question Submitted</div>
                        <p>The account owner will be notified of your request.</p>
                        <div className="dialog-buttons">
                            <button className="btn btn-sm btn-primary" onClick={onClose}>Close</button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="dialog-title">Question This Charge</div>
                        <p className="share-hint">Flagging <strong>{bill.name}</strong> for review.</p>
                        <div className="payment-dialog-fields">
                            <div className="payment-field-group">
                                <label>What looks wrong?</label>
                                <textarea
                                    className={'composer-input' + (msgError ? ' input-error' : '')}
                                    rows={4}
                                    placeholder="Describe the issue..."
                                    value={message}
                                    onChange={e => { setMessage(e.target.value); setMsgError(false); }}
                                    maxLength={2000}
                                />
                            </div>
                            <div className="payment-field-group">
                                <label>Suggested correction (optional)</label>
                                <input
                                    className="composer-input"
                                    placeholder="e.g. Should be $45/mo instead of $60"
                                    value={correction}
                                    onChange={e => setCorrection(e.target.value)}
                                    maxLength={500}
                                />
                            </div>
                        </div>
                        <div className="dialog-buttons">
                            <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Cancel</button>
                            <button className="btn btn-sm btn-primary" onClick={handleSubmit} disabled={submitting}>
                                {submitting ? 'Submitting...' : 'Submit'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
