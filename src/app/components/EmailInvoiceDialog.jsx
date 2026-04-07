/**
 * EmailInvoiceDialog — email invoice composer with variant selector.
 * Port of showEmailInvoiceDialog() from main.js:4724.
 * Sends HTML email via Firestore mail queue (processed by processMailQueue Cloud Function).
 *
 * Share links are generated at send time (not on dialog open) to avoid
 * creating orphan links when the user closes without sending.
 */
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { queueEmail } from '../../lib/mail.js';
import { getInvoiceSummaryContext, buildInvoiceSubject, buildInvoiceBody } from '../../lib/invoice.js';
import { formatAnnualSummaryCurrency } from '../../lib/formatting.js';
import { createAndPruneShareLink } from '../../lib/ShareLinkService.js';

/**
 * @param {{ open: boolean, memberId: number, familyMembers: Array, bills: Array, payments: Array, activeYear: Object, settings: Object, userId?: string, billingYearId?: string, showToast?: function, onClose: function }} props
 */
export default function EmailInvoiceDialog({ open, memberId, familyMembers, bills, payments, activeYear, settings, userId, billingYearId, showToast, onClose }) {
    const { user } = useAuth();
    const [variant, setVariant] = useState('text-link');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [copied, setCopied] = useState(false);
    const [sending, setSending] = useState(false);
    const [generatedShareUrl, setGeneratedShareUrl] = useState('');
    const bodyEditedRef = useRef(false);

    const ctx = open ? getInvoiceSummaryContext(familyMembers, bills, payments, memberId, activeYear, settings) : null;

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setGeneratedShareUrl('');
            bodyEditedRef.current = false;
        }
    }, [open, memberId]);

    // Build body whenever variant changes (but not when share URL arrives — that's handled at send time)
    useEffect(() => {
        if (!ctx) return;
        const subjectTemplate = (settings && settings.emailSubject) || '';
        setSubject(buildInvoiceSubject(ctx.currentYear, ctx.member, subjectTemplate, ctx));
        setBody(buildInvoiceBody(ctx, variant, generatedShareUrl, 'email'));
        setCopied(false);
        bodyEditedRef.current = false;
    }, [open, variant, memberId]);

    if (!open || !ctx) return null;

    const recipientEmail = ctx.member.email || '';
    const needsLink = variant === 'text-link' || variant === 'full';

    /**
     * Generate a share link at send time. Returns the URL or empty string.
     * Caches the result so repeated sends in the same dialog session reuse it.
     */
    async function ensureShareLink() {
        if (generatedShareUrl) return generatedShareUrl;
        if (!userId || !billingYearId || !ctx) return '';
        try {
            const result = await createAndPruneShareLink({
                userId,
                memberId,
                memberName: ctx.member.name,
                billingYearId,
                familyMembers,
                bills,
                payments,
                activeYear,
                settings,
            });
            setGeneratedShareUrl(result.url);
            return result.url;
        } catch (err) {
            console.error('Failed to generate share link:', err);
            if (showToast) showToast('Could not generate share link: ' + (err.message || 'Unknown error'));
            return '';
        }
    }

    /**
     * Rebuild body with share URL, respecting manual edits.
     * - Not edited: full rebuild from template with share URL.
     * - Edited: preserve user text, append share link block if URL not already present.
     */
    function rebuildBodyWithUrl(url) {
        if (!url) return body;
        if (!bodyEditedRef.current) {
            return buildInvoiceBody(ctx, variant, url, 'email');
        }
        // User manually edited — append link block only if not already present
        if (body.includes(url)) return body;
        return body + '\n\nView your billing summary: ' + url;
    }

    function handleBodyChange(e) {
        setBody(e.target.value);
        bodyEditedRef.current = true;
    }

    async function handleCopy() {
        let finalBody = body;
        if (needsLink) {
            const url = await ensureShareLink();
            if (!url) return; // abort — toast already shown by ensureShareLink
            finalBody = rebuildBodyWithUrl(url);
            setBody(finalBody);
        }
        navigator.clipboard.writeText(finalBody).then(() => setCopied(true));
    }

    async function handleOpenMail() {
        let finalBody = body;
        if (needsLink) {
            const url = await ensureShareLink();
            if (!url) return; // abort — toast already shown by ensureShareLink
            finalBody = rebuildBodyWithUrl(url);
            setBody(finalBody);
        }
        const mailto = 'mailto:' + encodeURIComponent(recipientEmail)
            + '?subject=' + encodeURIComponent(subject)
            + '&body=' + encodeURIComponent(finalBody);
        window.location.href = mailto;
    }

    async function handleSendEmail() {
        if (!recipientEmail) {
            if (showToast) showToast('No email address for this member.');
            return;
        }
        setSending(true);
        try {
            let finalBody = body;
            if (needsLink) {
                const url = await ensureShareLink();
                if (!url) { setSending(false); return; } // abort — toast already shown
                finalBody = rebuildBodyWithUrl(url);
                setBody(finalBody);
            }
            await queueEmail({ to: recipientEmail, subject, body: finalBody, uid: user ? user.uid : '' });
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
                    {generatedShareUrl && (
                        <div className="invoice-meta-row"><span className="invoice-meta-label">Share Link</span><span className="invoice-share-url">{generatedShareUrl}</span></div>
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
                        <textarea className="composer-input invoice-body-textarea" rows={10} value={body} onChange={handleBodyChange} />
                    </div>
                </div>

                <div className="dialog-buttons">
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                    <button className="btn btn-sm btn-secondary" onClick={handleCopy} disabled={sending}>
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={handleOpenMail} disabled={sending}>
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
