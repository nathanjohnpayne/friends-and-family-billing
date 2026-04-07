/**
 * ShareLinkDialog — generate new share links and manage existing ones.
 * Port of generateShareLink() (main.js:3985) and showShareLinks() (main.js:4154).
 *
 * Uses ShareLinkService for link creation + pruning.
 * Reads access metrics from publicShares (with shareTokens fallback).
 */
import { useState, useEffect } from 'react';
import { doc, setDoc, getDoc, getDocs, collection, query, where, deleteDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { buildShareScopes, buildShareUrl, isShareTokenStale } from '../../lib/share.js';
import { createAndPruneShareLink } from '../../lib/ShareLinkService.js';

function formatLastViewed(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * @param {{ open: boolean, memberId: number, memberName: string, userId: string, billingYearId: string, yearLabel: string, initialTab?: string, familyMembers?: Array, bills?: Array, payments?: Array, activeYear?: Object, settings?: Object, onClose: function, showToast?: function, onLinkGenerated?: function }} props
 */
export default function ShareLinkDialog({ open, memberId, memberName, userId, billingYearId, yearLabel, initialTab, familyMembers, bills, payments, activeYear, settings, onClose, showToast, onLinkGenerated }) {
    const [tab, setTab] = useState(initialTab || 'generate');
    const [expiryDays, setExpiryDays] = useState(0);
    const [allowDispute, setAllowDispute] = useState(false);
    const [allowDisputeRead, setAllowDisputeRead] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [generatedUrl, setGeneratedUrl] = useState('');
    const [links, setLinks] = useState([]);
    const [loadingLinks, setLoadingLinks] = useState(false);
    const [copied, setCopied] = useState('');

    useEffect(() => {
        if (open) {
            setTab(initialTab || 'generate');
            setGeneratedUrl('');
            setCopied('');
        }
    }, [open, initialTab]);

    useEffect(() => {
        if (open && tab === 'manage') loadLinks();
    }, [open, tab]);

    if (!open) return null;

    async function loadLinks() {
        setLoadingLinks(true);
        try {
            const q = query(
                collection(db, 'shareTokens'),
                where('ownerId', '==', userId),
                where('memberId', '==', memberId)
            );
            const snap = await getDocs(q);
            const now = new Date();
            const items = snap.docs.map(d => {
                const data = d.data();
                const status = data.revoked ? 'revoked'
                    : isShareTokenStale(data, now) ? 'expired'
                    : 'active';
                const createdAt = data.createdAt && data.createdAt.toDate
                    ? data.createdAt.toDate().toLocaleDateString()
                    : '';
                const url = data.rawToken ? buildShareUrl(window.location.origin, data.rawToken) : '';
                return {
                    id: d.id,
                    ...data,
                    status,
                    createdAt,
                    url,
                    accessCount: data.accessCount || 0,
                    lastAccessedAt: data.lastAccessedAt || null,
                };
            });
            items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

            // Merge access metrics from publicShares for active links
            const activeItems = items.filter(i => i.status === 'active');
            if (activeItems.length > 0) {
                const publicReads = await Promise.all(
                    activeItems.map(i => getDoc(doc(db, 'publicShares', i.id)))
                );
                publicReads.forEach((pubSnap, idx) => {
                    if (pubSnap.exists()) {
                        const pd = pubSnap.data();
                        activeItems[idx].accessCount = pd.accessCount || 0;
                        activeItems[idx].lastAccessedAt = pd.lastAccessedAt || null;
                    }
                });
            }

            setLinks(items);
        } catch (err) {
            console.error('Failed to load share links:', err);
        }
        setLoadingLinks(false);
    }

    async function handleGenerate() {
        setGenerating(true);
        try {
            const scopes = buildShareScopes(allowDispute, allowDisputeRead);
            const result = await createAndPruneShareLink({
                userId,
                memberId,
                memberName,
                billingYearId,
                scopes,
                expiryDays: expiryDays || undefined,
                familyMembers,
                bills,
                payments,
                activeYear,
                settings,
            });

            setGeneratedUrl(result.url);
            try { await navigator.clipboard.writeText(result.url); } catch (_) { /* clipboard may be blocked */ }
            if (onLinkGenerated) onLinkGenerated(result.url);
            if (showToast) showToast('Share link generated!');
        } catch (err) {
            console.error('Failed to generate share link:', err);
            if (showToast) showToast('Failed to generate share link: ' + err.message);
        }
        setGenerating(false);
    }

    async function handleRevoke(tokenHash) {
        try {
            await setDoc(doc(db, 'shareTokens', tokenHash), { revoked: true }, { merge: true });
            try { await deleteDoc(doc(db, 'publicShares', tokenHash)); } catch (_) { /* may not exist */ }
            if (showToast) showToast('Share link revoked');
            loadLinks();
        } catch (err) {
            console.error('Failed to revoke:', err);
        }
    }

    function handleCopy(url, id) {
        navigator.clipboard.writeText(url).then(() => setCopied(id));
    }

    const expiryOptions = [
        { value: 0, label: 'No expiry' },
        { value: 7, label: '7 days' },
        { value: 30, label: '30 days' },
        { value: 90, label: '90 days' },
        { value: 365, label: '1 year' }
    ];

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog dialog--wide" onClick={e => e.stopPropagation()}>
                <div className="dialog-title">Share Links for {memberName}</div>

                <div className="share-link-tabs">
                    <button
                        className={'settlement-filter-chip' + (tab === 'generate' ? ' active' : '')}
                        onClick={() => setTab('generate')}
                    >New Link</button>
                    <button
                        className={'settlement-filter-chip' + (tab === 'manage' ? ' active' : '')}
                        onClick={() => setTab('manage')}
                    >Manage Links</button>
                </div>

                {tab === 'generate' && (
                    <div className="share-link-generate">
                        <p className="link-manager-hint">
                            Generate a shareable billing summary link for {memberName} ({yearLabel}).
                        </p>
                        <div className="payment-dialog-fields">
                            <div className="payment-field-group">
                                <label>Link Expiry</label>
                                <select className="composer-input" value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value))}>
                                    {expiryOptions.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="checkbox-item">
                                <input type="checkbox" id="allow-dispute" checked={allowDispute} onChange={e => setAllowDispute(e.target.checked)} />
                                <label htmlFor="allow-dispute">Allow member to request bill reviews</label>
                            </div>
                            <div className="checkbox-item">
                                <input type="checkbox" id="allow-dispute-read" checked={allowDisputeRead} onChange={e => setAllowDisputeRead(e.target.checked)} />
                                <label htmlFor="allow-dispute-read">Allow member to view review requests &amp; evidence</label>
                            </div>
                        </div>

                        {generatedUrl && (
                            <div className="share-link-result">
                                <span className="share-link-url">{generatedUrl}</span>
                                <button className="btn btn-sm btn-secondary" onClick={() => handleCopy(generatedUrl, 'generated')}>
                                    {copied === 'generated' ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                        )}

                        <div className="dialog-buttons">
                            <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                            <button className="btn btn-sm btn-primary" onClick={handleGenerate} disabled={generating}>
                                {generating ? 'Generating...' : 'Generate & Copy Link'}
                            </button>
                        </div>
                    </div>
                )}

                {tab === 'manage' && (
                    <div className="share-link-manage">
                        {loadingLinks ? (
                            <p className="link-manager-hint">Loading share links...</p>
                        ) : links.length === 0 ? (
                            <p className="link-manager-empty">No share links generated yet for this member.</p>
                        ) : (
                            <div className="share-link-list">
                                {links.map(link => (
                                    <div key={link.id} className="share-link-item">
                                        <div className="share-link-item-header">
                                            <span className="share-link-year">{yearLabel}</span>
                                            <span className="share-link-date">{link.createdAt}</span>
                                            <span className={'share-link-status share-link-status--' + link.status}>{link.status}</span>
                                        </div>
                                        {link.url && (
                                            <div className="share-link-url-row">
                                                <span className="share-link-url share-link-url-truncated">{link.url}</span>
                                                <button className="btn btn-sm btn-tertiary" onClick={() => handleCopy(link.url, link.id)}>
                                                    {copied === link.id ? 'Copied!' : 'Copy'}
                                                </button>
                                                {link.status === 'active' && (
                                                    <button className="btn btn-sm btn-tertiary" style={{ color: 'var(--color-danger, #C65A5A)' }} onClick={() => handleRevoke(link.id)}>
                                                        Revoke
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        <div className="share-link-meta">
                                            {link.accessCount > 0
                                                ? link.accessCount + ' view' + (link.accessCount !== 1 ? 's' : '') + ', last ' + formatLastViewed(link.lastAccessedAt)
                                                : 'Never viewed'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="dialog-buttons">
                            <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Close</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
