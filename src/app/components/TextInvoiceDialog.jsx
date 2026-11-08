/**
 * TextInvoiceDialog — SMS invoice composer with variant selector.
 * Port of showTextInvoiceDialog() from main.js:4521.
 *
 * Share links are generated at send time (not on dialog open) to avoid
 * creating orphan links when the user closes without sending.
 */
import { useState, useEffect, useRef } from 'react';
import { getInvoiceSummaryContext, buildInvoiceBody } from '../../lib/invoice.js';
import { openSmsComposer } from '../../lib/sms.js';
import { formatAnnualSummaryCurrency } from '../../lib/formatting.js';
import { createAndPruneShareLink } from '../../lib/ShareLinkService.js';
import Dialog from './Dialog.jsx';
import FinancialUnavailable from './FinancialUnavailable.jsx';
import { getHouseholdFinancialAvailability } from '../../lib/financial-availability.js';
import { useFinancialAccess } from '../hooks/useFinancialAccess.js';

/**
 * @param {{ open: boolean, memberId: number, familyMembers: Array, bills: Array, payments: Array, activeYear: Object, settings: Object, userId?: string, billingYearId?: string, onClose: function, showToast?: function }} props
 */
export default function TextInvoiceDialog({ getAvailability, open, memberId, familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], activeYear, settings, userId, billingYearId, onClose, showToast }) {
    const [variant, setVariant] = useState('text-link');
    const [body, setBody] = useState('');
    const [copied, setCopied] = useState(false);
    const [generatedShareUrl, setGeneratedShareUrl] = useState('');
    const [generating, setGenerating] = useState(false);
    const bodyEditedRef = useRef(false);

    const ctx = getInvoiceSummaryContext(familyMembers, bills, payments, memberId, activeYear, settings, owedAdjustments, creditAdjustments);
    const contextKey = JSON.stringify(ctx);
    const access = useFinancialAccess(() => ({ available: ctx.ok && (getAvailability ? getAvailability()
        : getHouseholdFinancialAvailability({ familyMembers, bills, payments, creditAdjustments, owedAdjustments }, memberId)).available }),
        String(billingYearId) + ':' + memberId + ':' + contextKey, open);

    // Any changed source/identity invalidates old composed money, edits and pending work.
    useEffect(() => {
        setGeneratedShareUrl('');
        setCopied(false);
        setGenerating(false);
        bodyEditedRef.current = false;
        if (!open || !access.available || !ctx.ok) {
            setBody('');
            return;
        }
        const nextBody = buildInvoiceBody(ctx, variant, '', 'sms');
        setBody(nextBody.ok ? nextBody.value : '');
    }, [open, variant, contextKey, access.available]);

    if (!open) return null;
    if (!access.available) return <Dialog onClose={onClose} title="Financial data unavailable"
        footer={<button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>}>
        <FinancialUnavailable />
    </Dialog>;
    if (!ctx.ok) return null;

    const needsLink = variant === 'text-link';

    /**
     * Generate a share link at send time. Returns the URL or empty string.
     * Caches the result so repeated actions in the same dialog session reuse it.
     */
    async function ensureShareLink(ticket) {
        if (!access.canContinue(ticket)) return '';
        if (generatedShareUrl) return generatedShareUrl;
        if (!userId || !billingYearId || !ctx) return '';
        setGenerating(true);
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
            if (!access.canContinue(ticket)) { setGenerating(false); return ''; }
            setGeneratedShareUrl(result.url);
            setGenerating(false);
            return result.url;
        } catch (err) {
            console.error('Failed to generate share link:', err);
            if (showToast) showToast('Could not generate share link: ' + (err.message || 'Unknown error'), { kind: 'failure' });
            setGenerating(false);
            return '';
        }
    }

    /**
     * Rebuild body with share URL, respecting manual edits.
     */
    function rebuildBodyWithUrl(url) {
        if (!url) return body;
        if (!bodyEditedRef.current) {
            const result = buildInvoiceBody(ctx, variant, url, 'sms');
            return result.ok ? result.value : null;
        }
        if (body.includes(url)) return body;
        return body + '\n\n' + url;
    }

    function handleBodyChange(e) {
        setBody(e.target.value);
        bodyEditedRef.current = true;
    }

    /** Keep a held or replaced dialog from copying an invoice after awaiting its link. */
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

    /** Launch the SMS composer only while the original live household ticket remains valid. */
    async function handleOpenMessages() {
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
        openSmsComposer(ctx.member.phone, finalBody, () => {
            if (showToast) showToast('Message copied\u2014paste into your messaging app');
        });
    }

    return (
        <Dialog
            onClose={onClose}
            wide
            title={<>Text Invoice for {ctx.member.name}</>}
            footer={(
                <>
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                    <button className="btn btn-sm btn-secondary" onClick={handleCopy} disabled={generating}>
                        {copied ? 'Copied!' : 'Copy Message'}
                    </button>
                    <button className="btn btn-sm btn-ink" onClick={handleOpenMessages} disabled={generating}>
                        {generating ? 'Generating link\u2026' : 'Open Messages'}
                    </button>
                </>
            )}
        >
            <div className="invoice-summary-meta">
                <div className="invoice-meta-row"><span className="invoice-meta-label">Recipient</span><span>{ctx.member.name}</span></div>
                <div className="invoice-meta-row"><span className="invoice-meta-label">Phone</span><span>{ctx.member.phone || 'Not provided'}</span></div>
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
                    <input type="radio" name="sms-variant" value="text-only" checked={variant === 'text-only'} onChange={() => setVariant('text-only')} />
                    Text only
                </label>
                <label className="invoice-variant-option">
                    <input type="radio" name="sms-variant" value="text-link" checked={variant === 'text-link'} onChange={() => setVariant('text-link')} />
                    Text + link
                </label>
            </div>

            <div className="payment-dialog-fields">
                <div className="payment-field-group">
                    <label>Message</label>
                    <textarea className="composer-input invoice-body-textarea" rows={5} value={body} onChange={handleBodyChange} />
                </div>
            </div>
        </Dialog>
    );
}
