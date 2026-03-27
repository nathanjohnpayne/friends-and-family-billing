/**
 * TextInvoiceDialog — SMS invoice composer with variant selector.
 * Port of showTextInvoiceDialog() from main.js:4521.
 */
import { useState, useEffect } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { getInvoiceSummaryContext, buildInvoiceBody } from '../../lib/invoice.js';
import { openSmsComposer } from '../../lib/sms.js';
import { formatAnnualSummaryCurrency } from '../../lib/formatting.js';
import { generateRawToken, hashToken } from '../../lib/validation.js';
import { buildShareScopes, buildShareTokenDoc, buildShareUrl, buildPublicShareData } from '../../lib/share.js';

/**
 * @param {{ open: boolean, memberId: number, familyMembers: Array, bills: Array, payments: Array, activeYear: Object, settings: Object, userId?: string, billingYearId?: string, shareUrl?: string, onClose: function, showToast?: function }} props
 */
export default function TextInvoiceDialog({ open, memberId, familyMembers, bills, payments, activeYear, settings, userId, billingYearId, shareUrl: externalShareUrl, onClose, showToast }) {
    const [variant, setVariant] = useState('text-link');
    const [body, setBody] = useState('');
    const [copied, setCopied] = useState(false);
    const [generatedShareUrl, setGeneratedShareUrl] = useState('');
    const [generating, setGenerating] = useState(false);

    const shareUrl = externalShareUrl || generatedShareUrl;
    const ctx = open ? getInvoiceSummaryContext(familyMembers, bills, payments, memberId, activeYear, settings) : null;

    // Reset generated URL when dialog reopens
    useEffect(() => {
        if (open) { setGeneratedShareUrl(''); setGenerating(false); }
    }, [open, memberId]);

    // Auto-generate a share link when text-link variant is selected and none exists
    useEffect(() => {
        if (!open || variant !== 'text-link' || shareUrl || generating || !userId || !billingYearId || !ctx) return;
        let cancelled = false;
        (async () => {
            setGenerating(true);
            try {
                const rawToken = generateRawToken();
                const tokenHash = await hashToken(rawToken);
                const scopes = buildShareScopes(false, false);
                const tokenDoc = buildShareTokenDoc(userId, memberId, ctx.member.name, billingYearId, rawToken, null, scopes);
                await setDoc(doc(db, 'shareTokens', tokenHash), { ...tokenDoc, createdAt: serverTimestamp() });
                const publicData = buildPublicShareData(familyMembers, bills, payments, memberId, scopes, userId, activeYear, settings);
                if (publicData) {
                    await setDoc(doc(db, 'publicShares', tokenHash), { ...publicData, updatedAt: serverTimestamp() });
                }
                const url = buildShareUrl(window.location.origin, rawToken);
                if (!cancelled) setGeneratedShareUrl(url);
            } catch (err) {
                console.error('Failed to auto-generate share link:', err);
            }
            if (!cancelled) setGenerating(false);
        })();
        return () => { cancelled = true; };
    }, [open, variant, memberId, userId, billingYearId]);

    useEffect(() => {
        if (!ctx) return;
        setBody(buildInvoiceBody(ctx, variant, shareUrl, 'sms'));
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
