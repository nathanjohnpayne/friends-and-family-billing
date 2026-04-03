/**
 * EmailInvoiceDialog — email invoice composer with variant selector.
 * Port of showEmailInvoiceDialog() from main.js:4724.
 * Sends HTML email via Firestore mail queue (processed by processMailQueue Cloud Function).
 */
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { queueEmail } from '../../lib/mail.js';
import { getInvoiceSummaryContext, buildInvoiceSubject, buildInvoiceBody } from '../../lib/invoice.js';
import { formatAnnualSummaryCurrency } from '../../lib/formatting.js';

/**
 * @param {{ open: boolean, memberId: number, familyMembers: Array, bills: Array, payments: Array, activeYear: Object, settings: Object, shareUrl?: string, showToast?: function, onClose: function }} props
 */
export default function EmailInvoiceDialog({ open, memberId, familyMembers, bills, payments, activeYear, settings, shareUrl, showToast, onClose }) {
    const { user } = useAuth();
    const [variant, setVariant] = useState('text-link');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [copied, setCopied] = useState(false);
    const [sending, setSending] = useState(false);

    const ctx = open ? getInvoiceSummaryContext(familyMembers, bills, payments, memberId, activeYear, settings) : null;

    useEffect(() => {
        if (!ctx) return;
        const subjectTemplate = (settings && settings.emailSubject) || '';
        setSubject(buildInvoiceSubject(ctx.currentYear, ctx.member, subjectTemplate, ctx));
        setBody(buildInvoiceBody(ctx, variant, shareUrl || '', 'email'));
        setCopied(false);
    }, [open, variant, memberId, shareUrl]);

    if (!open || !ctx) return null;

    const recipientEmail = ctx.member.email || '';

    function handleCopy() {
        navigator.clipboard.writeText(body).then(() => setCopied(true));
    }

    function handleOpenMail() {
        const mailto = 'mailto:' + encodeURIComponent(recipientEmail)
            + '?subject=' + encodeURIComponent(subject)
            + '&body=' + encodeURIComponent(body);
        window.location.href = mailto;
    }

    async function handleSendEmail() {
        if (!recipientEmail) {
            if (showToast) showToast('No email address for this member.');
            return;
        }
        setSending(true);
        try {
            await queueEmail({ to: recipientEmail, subject, body, uid: user ? user.uid : '' });
            if (showToast) showToast('Invoice emailed to ' + recipientEmail);
            onClose();
        } catch (err) {
            if (showToast) showToast('Send failed: ' + (err.message || 'Unknown error'));
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog dialog--wide" onClick={e => e.stopPropagation()}>
                <div className="dialog-title">Email Invoice for {ctx.member.name}</div>

                <div className="invoice-summary-meta">
                    <div className="invoice-meta-row"><span className="invoice-meta-label">Recipient</span><span>{ctx.member.name}</span></div>
                    <div className="invoice-meta-row"><span className="invoice-meta-label">Email</span><span>{recipientEmail || 'Not provided'}</span></div>
                    <div className="invoice-meta-row"><span className="invoice-meta-label">Annual Total</span><span>{formatAnnualSummaryCurrency(ctx.combinedTotal)}</span></div>
                    {ctx.payment > 0 && (
                        <div className="invoice-meta-row"><span className="invoice-meta-label">Balance</span><span>{formatAnnualSummaryCurrency(ctx.balance)}</span></div>
                    )}
                    {shareUrl && (
                        <div className="invoice-meta-row"><span className="invoice-meta-label">Share Link</span><span className="invoice-share-url">{shareUrl}</span></div>
                    )}
                </div>

                <div className="invoice-variant-selector">
                    <label className="invoice-variant-option">
                        <input type="radio" name="email-variant" value="text-only" checked={variant === 'text-only'} onChange={() => setVariant('text-only')} />
                        Text only
                    </label>
                    <label className="invoice-variant-option">
                        <input type="radio" name="email-variant" value="text-link" checked={variant === 'text-link'} onChange={() => setVariant('text-link')} />
                        Text + link
                    </label>
                    <label className="invoice-variant-option">
                        <input type="radio" name="email-variant" value="full" checked={variant === 'full'} onChange={() => setVariant('full')} />
                        Full invoice
                    </label>
                </div>

                <div className="payment-dialog-fields">
                    <div className="payment-field-group">
                        <label>Subject</label>
                        <input className="composer-input" value={subject} onChange={e => setSubject(e.target.value)} />
                    </div>
                    <div className="payment-field-group">
                        <label>Message</label>
                        <textarea className="composer-input invoice-body-textarea" rows={10} value={body} onChange={e => setBody(e.target.value)} />
                    </div>
                </div>

                <div className="dialog-buttons">
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                    <button className="btn btn-sm btn-secondary" onClick={handleCopy}>
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={handleOpenMail}>
                        Open Mail App
                    </button>
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={handleSendEmail}
                        disabled={sending || !recipientEmail}
                    >
                        {sending ? 'Sending\u2026' : 'Send Email'}
                    </button>
                </div>
            </div>
        </div>
    );
}
