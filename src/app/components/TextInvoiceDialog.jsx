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

/**
 * @param {{ open: boolean, memberId: number, familyMembers: Array, bills: Array, payments: Array, activeYear: Object, settings: Object, userId?: string, billingYearId?: string, onClose: function, showToast?: function }} props
 */
export default function TextInvoiceDialog({ open, memberId, familyMembers, bills, payments, activeYear, settings, userId, billingYearId, onClose, showToast }) {
    const [variant, setVariant] = useState('text-link');
    const [body, setBody] = useState('');
    const [copied, setCopied] = useState(false);
    const [generatedShareUrl, setGeneratedShareUrl] = useState('');
    const [generating, setGenerating] = useState(false);
    const bodyEditedRef = useRef(false);

    const ctx = open ? getInvoiceSummaryContext(familyMembers, bills, payments, memberId, activeYear, settings) : null;

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setGeneratedShareUrl('');
            setGenerating(false);
            bodyEditedRef.current = false;
        }
    }, [open, memberId]);

    // Build body when variant changes
    useEffect(() => {
        if (!ctx) return;
        setBody(buildInvoiceBody(ctx, variant, generatedShareUrl, 'sms'));
        setCopied(false);
        bodyEditedRef.current = false;
    }, [open, variant, memberId]);

    if (!open || !ctx) return null;

    const needsLink = variant === 'text-link';

    /**
     * Generate a share link at send time. Returns the URL or empty string.
     * Caches the result so repeated actions in the same dialog session reuse it.
     */
    async function ensureShareLink() {
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
                activeYear,
                settings,
            });
            setGeneratedShareUrl(result.url);
            setGenerating(false);
            return result.url;
        } catch (err) {
            console.error('Failed to generate share link:', err);
            if (showToast) showToast('Could not generate share link: ' + (err.message || 'Unknown error'));
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
            return buildInvoiceBody(ctx, variant, url, 'sms');
        }
        if (body.includes(url)) return body;
        return body + '\n\n' + url;
    }

    function handleBodyChange(e) {
        setBody(e.target.value);
        bodyEditedRef.current = true;
    }

    async function handleCopy() {
        let finalBody = body;
        if (needsLink) {
            const url = await ensureShareLink();
            finalBody = rebuildBodyWithUrl(url);
            setBody(finalBody);
        }
        navigator.clipboard.writeText(finalBody).then(() => setCopied(true));
    }

    async function handleOpenMessages() {
        let finalBody = body;
        if (needsLink) {
            const url = await ensureShareLink();
            finalBody = rebuildBodyWithUrl(url);
            setBody(finalBody);
        }
        openSmsComposer(ctx.member.phone, finalBody, () => {
            if (showToast) showToast('Message copied\u2014paste into your messaging app');
        });
    }

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog dialog--wide" onClick={e => e.stopPropagation()}>
                <div className="dialog-title">Text Invoice for {ctx.member.name}</div>

                <div className="invoice-summary-meta">
                    <div className="invoice-meta-row"><span className="invoice-meta-label">Recipient</span><span>{ctx.member.name}</span></div>
                    <div className="invoice-meta-row"><span className="invoice-meta-label">Phone</span><span>{ctx.member.phone || 'Not provided'}</span></div>
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

                <div className="dialog-buttons">
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                    <button className="btn btn-sm btn-secondary" onClick={handleCopy} disabled={generating}>
                        {copied ? 'Copied!' : 'Copy Message'}
                    </button>
                    <button className="btn btn-sm btn-primary" onClick={handleOpenMessages} disabled={generating}>
                        {generating ? 'Generating link\u2026' : 'Open Messages'}
                    </button>
                </div>
            </div>
        </div>
    );
}
