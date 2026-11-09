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
import Dialog from './Dialog.jsx';
import FinancialUnavailable from './FinancialUnavailable.jsx';
import { getHouseholdFinancialAvailability } from '../../lib/financial-availability.js';
import { useFinancialAccess } from '../hooks/useFinancialAccess.js';

/**
 * @param {{ open: boolean, memberId: number, familyMembers: Array, bills: Array, payments: Array, activeYear: Object, settings: Object, userId?: string, billingYearId?: string, showToast?: function, onClose: function }} props
 */
export default function EmailInvoiceDialog({ getAvailability, open, memberId, familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], activeYear, settings, userId, billingYearId, showToast, onClose }) {
    const { user } = useAuth();
    const [variant, setVariant] = useState('text-link');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [copied, setCopied] = useState(false);
    const [sending, setSending] = useState(false);
    const [generatedShareUrl, setGeneratedShareUrl] = useState('');
    const bodyEditedRef = useRef(false);
    const generatedForContext = useRef(null);

    const ctx = getInvoiceSummaryContext(familyMembers, bills, payments, memberId, activeYear, settings, owedAdjustments, creditAdjustments);
    const contextKey = JSON.stringify(ctx);
    const access = useFinancialAccess(() => ({ available: ctx.ok && (getAvailability ? getAvailability()
        : getHouseholdFinancialAvailability({ familyMembers, bills, payments, creditAdjustments, owedAdjustments }, memberId)).available }),
        String(billingYearId) + ':' + memberId + ':' + contextKey, open);

    // Any changed source/identity invalidates old composed money, edits and pending work.
    useEffect(() => {
        setGeneratedShareUrl('');
        generatedForContext.current = null;
        setCopied(false);
        setSending(false);
    }, [open, contextKey, access.available]);

    // Variant changes rebuild text without invalidating a cached link or pending action.
    useEffect(() => {
        bodyEditedRef.current = false;
        if (!open || !access.available || !ctx.ok) {
            setSubject('');
            setBody('');
            return;
        }
        const nextSubject = buildInvoiceSubject(ctx.currentYear, ctx.member, settings?.emailSubject || '', ctx);
        const nextBody = buildInvoiceBody(ctx, variant, generatedForContext.current === contextKey ? generatedShareUrl : '', 'email');
        setSubject(nextSubject.ok ? nextSubject.value : '');
        setBody(nextBody.ok ? nextBody.value : '');
    }, [open, variant, contextKey, access.available]);

    if (!open) return null;
    if (!access.available) return <Dialog onClose={onClose} title="Financial data unavailable"
        footer={<button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>}>
        <FinancialUnavailable />
    </Dialog>;
    if (!ctx.ok) return null;

    const recipientEmail = ctx.member.email || '';
    const needsLink = variant === 'text-link' || variant === 'full';

    /**
     * Generate a share link at send time. Returns the URL or empty string.
     * Caches the result so repeated sends in the same dialog session reuse it.
     */
    async function ensureShareLink(ticket) {
        if (!access.canContinue(ticket)) return '';
        if (generatedShareUrl && generatedForContext.current === contextKey) return generatedShareUrl;
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
                owedAdjustments,
                activeYear,
                settings,
            });
            if (!access.canContinue(ticket)) return '';
            generatedForContext.current = contextKey;
            setGeneratedShareUrl(result.url);
            return result.url;
        } catch (err) {
            console.error('Failed to generate share link:', err);
            if (showToast) showToast('Could not generate share link: ' + (err.message || 'Unknown error'), { kind: 'failure' });
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
            const result = buildInvoiceBody(ctx, variant, url, 'email');
            return result.ok ? result.value : null;
        }
        // User manually edited — append link block only if not already present
        if (body.includes(url)) return body;
        return body + '\n\nView your billing summary: ' + url;
    }

    function handleBodyChange(e) {
        setBody(e.target.value);
        bodyEditedRef.current = true;
    }

    /** Copy only after any awaited link generation still belongs to an available dialog. */
    async function handleCopy() {
        const ticket = access.begin();
        if (ticket === null) return;
        let finalBody = body;
        if (needsLink) {
            const url = await ensureShareLink(ticket);
            if (!url) return; // abort — toast already shown by ensureShareLink
            finalBody = rebuildBodyWithUrl(url);
            if (typeof finalBody !== 'string') return;
            setBody(finalBody);
        }
        if (!access.canContinue(ticket) || typeof finalBody !== 'string') return;
        navigator.clipboard.writeText(finalBody).then(() => setCopied(true));
    }

    /** Recheck the action ticket before launching mail with a generated invoice body. */
    async function handleOpenMail() {
        const ticket = access.begin();
        if (ticket === null) return;
        let finalBody = body;
        if (needsLink) {
            const url = await ensureShareLink(ticket);
            if (!url) return; // abort — toast already shown by ensureShareLink
            finalBody = rebuildBodyWithUrl(url);
            if (typeof finalBody !== 'string') return;
            setBody(finalBody);
        }
        if (!access.canContinue(ticket)) return;
        const mailto = 'mailto:' + encodeURIComponent(recipientEmail)
            + '?subject=' + encodeURIComponent(subject)
            + '&body=' + encodeURIComponent(finalBody);
        window.location.href = mailto;
    }

    /** Recheck after link generation and before queueing; an already queued email is not cancelled. */
    async function handleSendEmail() {
        const ticket = access.begin();
        if (ticket === null) return;
        if (!recipientEmail) {
            if (showToast) showToast('No email address for this member.', { kind: 'failure' });
            return;
        }
        setSending(true);
        try {
            let finalBody = body;
            if (needsLink) {
                const url = await ensureShareLink(ticket);
                if (!url) { setSending(false); return; } // abort — toast already shown
                finalBody = rebuildBodyWithUrl(url);
                if (typeof finalBody !== 'string') return;
                setBody(finalBody);
            }
            if (!access.canContinue(ticket)) return;
            await queueEmail({ to: recipientEmail, subject, body: finalBody, uid: user ? user.uid : '' });
            if (showToast) showToast('Invoice emailed to ' + recipientEmail);
            onClose();
        } catch (err) {
            if (showToast) showToast('Send failed: ' + (err.message || 'Unknown error'), { kind: 'failure' });
        } finally {
            setSending(false);
        }
    }

    return (
        <Dialog
            onClose={onClose}
            wide
            title={<>Email Invoice for {ctx.member.name}</>}
            footer={(
                <>
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                    <button className="btn btn-sm btn-secondary" onClick={handleCopy} disabled={sending}>
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={handleOpenMail} disabled={sending}>
                        Open Mail App
                    </button>
                    <button
                        className="btn btn-sm btn-ink"
                        onClick={handleSendEmail}
                        disabled={sending || !recipientEmail}
                    >
                        {sending ? 'Sending\u2026' : 'Send Email'}
                    </button>
                </>
            )}
        >
            <div className="invoice-summary-meta">
                <div className="invoice-meta-row"><span className="invoice-meta-label">Recipient</span><span>{ctx.member.name}</span></div>
                <div className="invoice-meta-row"><span className="invoice-meta-label">Email</span><span>{recipientEmail || 'Not provided'}</span></div>
                <div className="invoice-meta-row"><span className="invoice-meta-label">Annual Total</span><span>{formatAnnualSummaryCurrency(ctx.combinedTotal)}</span></div>
                {ctx.refunded > 0 && <div className="invoice-meta-row"><span className="invoice-meta-label">Refunded</span><span>{formatAnnualSummaryCurrency(ctx.refunded)}</span></div>}
                {ctx.payment > 0 && (
                    <div className="invoice-meta-row"><span className="invoice-meta-label">Balance</span><span>{formatAnnualSummaryCurrency(ctx.balance)}</span></div>
                )}
                {generatedShareUrl && (
                    <div className="invoice-meta-row"><span className="invoice-meta-label">Share Link</span><span className="invoice-share-url">{generatedShareUrl}</span></div>
                )}
            </div>

            <div className="invoice-variant-selector">
                <label className="invoice-variant-option">
                    <input type="radio" disabled={sending} name="email-variant" value="text-only" checked={variant === 'text-only'} onChange={() => setVariant('text-only')} />
                    Text only
                </label>
                <label className="invoice-variant-option">
                    <input type="radio" disabled={sending} name="email-variant" value="text-link" checked={variant === 'text-link'} onChange={() => setVariant('text-link')} />
                    Text + link
                </label>
                <label className="invoice-variant-option">
                    <input type="radio" disabled={sending} name="email-variant" value="full" checked={variant === 'full'} onChange={() => setVariant('full')} />
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
        </Dialog>
    );
}
