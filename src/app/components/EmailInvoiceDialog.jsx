/**
 * EmailInvoiceDialog — email invoice composer with variant selector.
 * Port of showEmailInvoiceDialog() from main.js:4724.
 */
import { useState, useEffect } from 'react';
import { getInvoiceSummaryContext, buildInvoiceSubject, buildInvoiceBody } from '../../lib/invoice.js';
import { formatAnnualSummaryCurrency } from '../../lib/formatting.js';

/**
 * @param {{ open: boolean, memberId: number, familyMembers: Array, bills: Array, payments: Array, activeYear: Object, settings: Object, shareUrl?: string, onClose: function }} props
 */
export default function EmailInvoiceDialog({ open, memberId, familyMembers, bills, payments, activeYear, settings, shareUrl, onClose }) {
    const [variant, setVariant] = useState('text-link');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [copied, setCopied] = useState(false);

    const ctx = open ? getInvoiceSummaryContext(familyMembers, bills, payments, memberId, activeYear, settings) : null;

    useEffect(() => {
        if (!ctx) return;
        setSubject(buildInvoiceSubject(ctx.currentYear, ctx.member));
        setBody(buildInvoiceBody(ctx, variant, shareUrl || '', 'email'));
        setCopied(false);
    }, [open, variant, memberId, shareUrl]);

    if (!open || !ctx) return null;

    function handleCopy() {
        navigator.clipboard.writeText(body).then(() => setCopied(true));
    }

    function handleOpenMail() {
        const mailto = 'mailto:' + encodeURIComponent(ctx.member.email || '')
            + '?subject=' + encodeURIComponent(subject)
            + '&body=' + encodeURIComponent(body);
        window.location.href = mailto;
    }

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog dialog--wide" onClick={e => e.stopPropagation()}>
                <div className="dialog-title">Email Invoice for {ctx.member.name}</div>

                <div className="invoice-summary-meta">
                    <div className="invoice-meta-row"><span className="invoice-meta-label">Recipient</span><span>{ctx.member.name}</span></div>
                    <div className="invoice-meta-row"><span className="invoice-meta-label">Email</span><span>{ctx.member.email || 'Not provided'}</span></div>
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
                        {copied ? 'Copied!' : 'Copy Email'}
                    </button>
                    <button className="btn btn-sm btn-primary" onClick={handleOpenMail}>Open Mail App</button>
                </div>
            </div>
        </div>
    );
}
