/**
 * TextInvoiceDialog — SMS invoice composer with variant selector.
 * Port of showTextInvoiceDialog() from main.js:4521.
 */
import { useState, useEffect } from 'react';
import { getInvoiceSummaryContext, buildInvoiceBody } from '../../lib/invoice.js';
import { openSmsComposer } from '../../lib/sms.js';
import { formatAnnualSummaryCurrency } from '../../lib/formatting.js';

/**
 * @param {{ open: boolean, memberId: number, familyMembers: Array, bills: Array, payments: Array, activeYear: Object, settings: Object, shareUrl?: string, onClose: function, showToast?: function }} props
 */
export default function TextInvoiceDialog({ open, memberId, familyMembers, bills, payments, activeYear, settings, shareUrl, onClose, showToast }) {
    const [variant, setVariant] = useState('text-link');
    const [body, setBody] = useState('');
    const [copied, setCopied] = useState(false);

    const ctx = open ? getInvoiceSummaryContext(familyMembers, bills, payments, memberId, activeYear, settings) : null;

    useEffect(() => {
        if (!ctx) return;
        setBody(buildInvoiceBody(ctx, variant, shareUrl || '', 'sms'));
        setCopied(false);
    }, [open, variant, memberId, shareUrl]);

    if (!open || !ctx) return null;

    function handleCopy() {
        navigator.clipboard.writeText(body).then(() => setCopied(true));
    }

    function handleOpenMessages() {
        openSmsComposer(ctx.member.phone, body, () => {
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
                    {shareUrl && (
                        <div className="invoice-meta-row"><span className="invoice-meta-label">Share Link</span><span className="invoice-share-url">{shareUrl}</span></div>
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
                        <textarea className="composer-input invoice-body-textarea" rows={5} value={body} onChange={e => setBody(e.target.value)} />
                    </div>
                </div>

                <div className="dialog-buttons">
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                    <button className="btn btn-sm btn-secondary" onClick={handleCopy}>
                        {copied ? 'Copied!' : 'Copy Message'}
                    </button>
                    <button className="btn btn-sm btn-primary" onClick={handleOpenMessages}>Open Messages</button>
                </div>
            </div>
        </div>
    );
}
