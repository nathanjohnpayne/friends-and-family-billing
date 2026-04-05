/**
 * InvoicingTab — TipTap WYSIWYG email template editor with tabbed
 * Edit/Preview layout, token pills, and payment methods manager.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { doc, setDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase.js';
import { queueEmail } from '../../../lib/mail.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { isYearReadOnly } from '../../../lib/validation.js';
import { detectDuplicatePaymentText } from '../../../lib/validation.js';
import {
    buildInvoiceSubject, getInvoiceSummaryContext,
    buildInvoiceTemplateEmailPayload, renderInvoiceTemplate,
    docToPlainTextWithTokens, plainTextToDoc
} from '../../../lib/invoice.js';
import { generateRawToken, hashToken } from '../../../lib/validation.js';
import { buildShareScopes, buildShareTokenDoc, buildShareUrl, buildPublicShareData, computeExpiryDate } from '../../../lib/share.js';
import TemplateEditor from '../../components/TemplateEditor.jsx';
import SubjectEditor from '../../components/SubjectEditor.jsx';
import { INLINE_TOKENS } from '../../components/TokenNode.js';
import { BLOCK_TOKENS } from '../../components/BlockTokenNode.js';
import PaymentMethodsManager from '../../components/PaymentMethodsManager.jsx';
import ShareLinkDialog from '../../components/ShareLinkDialog.jsx';

/** All tokens for the unified chip bar. */
const ALL_TOKEN_FIELDS = [
    ...INLINE_TOKENS.map(t => ({ id: t.id, label: t.label })),
    ...BLOCK_TOKENS.map(t => ({ id: t.id, label: t.label, isBlock: true, description: t.description })),
];

export default function InvoicingTab() {
    const { familyMembers, bills, payments, activeYear, loading, service } = useBillingData();
    const { user } = useAuth();
    const { showToast } = useToast();
    const readOnly = isYearReadOnly(activeYear);
    const settings = service.getState().settings || {};

    if (loading) return <p className="invoicing-loading">Loading…</p>;

    return (
        <div className="invoicing-tab">
            <EmailTemplateSection
                settings={settings}
                familyMembers={familyMembers}
                bills={bills}
                payments={payments}
                activeYear={activeYear}
                readOnly={readOnly}
                userId={user ? user.uid : ''}
                userEmail={user ? user.email : ''}
                billingYearId={activeYear ? activeYear.id : ''}
                service={service}
                showToast={showToast}
            />
        </div>
    );
}

// ── Helpers ─────────────────────────────────────────────────────────

function deriveBodyDoc(settings) {
    return settings.emailMessageDocument
        ? settings.emailMessageDocument
        : plainTextToDoc(settings.emailMessage || '');
}

function deriveBodyText(settings) {
    return settings.emailMessageDocument
        ? docToPlainTextWithTokens(settings.emailMessageDocument)
        : (settings.emailMessage || '');
}

function formatTimeSince(date) {
    if (!date) return '';
    const seconds = Math.floor((Date.now() - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + ' minute' + (minutes === 1 ? '' : 's') + ' ago';
    const hours = Math.floor(minutes / 60);
    return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
}

// ── Email Template Editor ───────────────────────────────────────────

function EmailTemplateSection({ settings, familyMembers, bills, payments, activeYear, readOnly, userId, userEmail, billingYearId, service, showToast }) {
    const [activeTab, setActiveTab] = useState('edit');
    const [bodyDoc, setBodyDoc] = useState(() => deriveBodyDoc(settings));
    const [bodyText, setBodyText] = useState(() => deriveBodyText(settings));
    const [subjectText, setSubjectText] = useState(settings.emailSubject || '');
    const [dirty, setDirty] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const [previewMemberId, setPreviewMemberId] = useState(
        familyMembers.length > 0 ? familyMembers[0].id : null
    );
    const [paymentMethodsModal, setPaymentMethodsModal] = useState(false);
    const [previewShareUrl, setPreviewShareUrl] = useState(settings.invoiceShareUrl || '');
    const [generatingLink, setGeneratingLink] = useState(false);
    const [shareLinkDialog, setShareLinkDialog] = useState(false);
    const [testEmailOpen, setTestEmailOpen] = useState(false);
    const [testEmailTo, setTestEmailTo] = useState('');
    const [testEmailSending, setTestEmailSending] = useState(false);

    // Editor refs
    const bodyEditorRef = useRef(null);
    const subjectEditorRef = useRef(null);
    // Track which editor was last focused for unified chip bar
    const lastFocusedEditor = useRef('body');

    // Resync local state when the billing year changes (route stays mounted)
    const lastYearId = useRef(billingYearId);
    useEffect(() => {
        if (billingYearId !== lastYearId.current) {
            lastYearId.current = billingYearId;
            setBodyDoc(deriveBodyDoc(settings));
            setBodyText(deriveBodyText(settings));
            setSubjectText(settings.emailSubject || '');
            setPreviewShareUrl(settings.invoiceShareUrl || '');
            setPreviewMemberId(familyMembers.length > 0 ? familyMembers[0].id : null);
            setDirty(false);
            setLastSavedAt(null);
        }
    }, [billingYearId, settings, familyMembers]);

    // Tick the "last saved" display
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!lastSavedAt) return;
        const id = setInterval(() => setTick(t => t + 1), 30000);
        return () => clearInterval(id);
    }, [lastSavedAt]);

    function handleBodyUpdate(json) {
        setBodyDoc(json);
        setBodyText(docToPlainTextWithTokens(json));
        setDirty(true);
    }

    function handleSubjectUpdate(text) {
        setSubjectText(text);
        setDirty(true);
    }

    function handleSave() {
        service.updateSettings({
            emailMessage: bodyText,
            emailMessageDocument: bodyDoc,
            emailSubject: subjectText,
        });
        setDirty(false);
        setLastSavedAt(Date.now());
        showToast('Email template saved');
    }

    /** Unified chip bar: insert into whichever editor was last focused. */
    const insertToken = useCallback((field) => {
        if (field.isBlock) {
            // Block tokens only go into body editor
            const editor = bodyEditorRef.current;
            if (!editor) return;
            editor.chain().focus().insertContent({
                type: 'blockToken',
                attrs: { id: field.id, label: field.label, description: field.description || '' },
            }).run();
            return;
        }
        const editor = lastFocusedEditor.current === 'subject'
            ? subjectEditorRef.current
            : bodyEditorRef.current;
        if (!editor) return;
        editor.chain().focus().insertContent({
            type: 'templateToken',
            attrs: { id: field.id, label: field.label },
        }).run();
    }, []);

    async function handleGeneratePreviewLink() {
        const member = familyMembers.find(m => m.id === previewMemberId) || familyMembers[0];
        if (!userId || !billingYearId || !member) return;
        setGeneratingLink(true);
        try {
            const rawToken = generateRawToken();
            const tokenHash = await hashToken(rawToken);
            const scopes = buildShareScopes(true, true);
            const expiresAt = computeExpiryDate(365);
            const tokenDoc = buildShareTokenDoc(userId, member.id, member.name, billingYearId, rawToken, expiresAt, scopes);
            await setDoc(doc(db, 'shareTokens', tokenHash), { ...tokenDoc, createdAt: serverTimestamp() });
            const publicData = buildPublicShareData(familyMembers, bills, payments, member.id, scopes, userId, activeYear, settings);
            if (publicData) {
                await setDoc(doc(db, 'publicShares', tokenHash), { ...publicData, updatedAt: serverTimestamp() });
            }
            const url = buildShareUrl(window.location.origin, rawToken);
            setPreviewShareUrl(url);
            service.updateSettings({ invoiceShareUrl: url });
            try { await navigator.clipboard.writeText(url); } catch (_) { /* clipboard may be blocked */ }
            showToast('Share link generated!');
        } catch (err) {
            console.error('Failed to generate share link:', err);
            showToast('Failed to generate share link: ' + err.message);
        }
        setGeneratingLink(false);
    }

    // Build preview context for the selected member
    const previewMember = familyMembers.find(m => m.id === previewMemberId) || familyMembers[0];
    let previewCtx = null;
    let previewEmailPayload = null;
    let previewBodyHTML = '';
    if (previewMember) {
        const previewSettings = { ...settings, emailMessage: bodyText, emailMessageDocument: bodyDoc };
        const ctx = getInvoiceSummaryContext(familyMembers, bills, payments, previewMember.id, activeYear, previewSettings);
        if (ctx) {
            previewCtx = ctx;
            previewEmailPayload = buildInvoiceTemplateEmailPayload(ctx, previewShareUrl);
            previewBodyHTML = previewEmailPayload.html || renderInvoiceTemplate(ctx, previewShareUrl);
        }
    }

    const hasDuplicate = detectDuplicatePaymentText(bodyText);

    return (
        <div className="invoicing-section">
            <p className="invoicing-hint invoicing-hint--compact">
                Use / to insert billing fields. Formatting is applied as you type.
            </p>

            {/* ── Tab bar ── */}
            <div className="template-tab-row">
                <div className="template-tab-bar">
                    <button
                        className={'template-tab' + (activeTab === 'edit' ? ' template-tab--active' : '')}
                        onClick={() => setActiveTab('edit')}
                        type="button"
                    >Edit</button>
                    <button
                        className={'template-tab' + (activeTab === 'preview' ? ' template-tab--active' : '')}
                        onClick={() => setActiveTab('preview')}
                        type="button"
                    >Preview</button>
                </div>
                {dirty && <span className="template-dirty-indicator">Unsaved changes</span>}
            </div>

            {/* ── Edit Tab ── */}
            <div style={{ display: activeTab === 'edit' ? 'block' : 'none' }}>
                <div className="template-card">
                    {/* Subject row */}
                    <div className="template-subject-row">
                        <span className="template-subject-label">Subject</span>
                        <div
                            className="template-subject-content"
                            onFocus={() => { lastFocusedEditor.current = 'subject'; }}
                        >
                            <SubjectEditor
                                content={subjectText}
                                onUpdate={handleSubjectUpdate}
                                readOnly={readOnly}
                                ref={subjectEditorRef}
                            />
                        </div>
                    </div>

                    {/* Unified chip bar */}
                    {!readOnly && (
                        <div className="template-chip-bar">
                            <span className="template-chip-label">Insert:</span>
                            {ALL_TOKEN_FIELDS.map(f => (
                                <button
                                    key={f.id}
                                    className="template-chip"
                                    type="button"
                                    onClick={() => insertToken(f)}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Body editor with toolbar */}
                    <div onFocus={() => { lastFocusedEditor.current = 'body'; }}>
                        <TemplateEditor
                            content={bodyDoc}
                            onUpdate={handleBodyUpdate}
                            readOnly={readOnly}
                            onConfigurePaymentMethods={() => setPaymentMethodsModal(true)}
                            ref={bodyEditorRef}
                        />
                    </div>

                    {hasDuplicate && (
                        <div className="template-card-warning">
                            Warning: Your template contains both the %payment_methods% token and hardcoded payment text.
                            This may cause duplicate payment information in invoices.
                        </div>
                    )}

                    {/* Save bar */}
                    {!readOnly && (
                        <div className="template-save-bar">
                            <span className="template-save-status">
                                {lastSavedAt ? 'Last saved ' + formatTimeSince(lastSavedAt) : ''}
                            </span>
                            <button
                                className="template-save-btn"
                                onClick={handleSave}
                                disabled={!dirty}
                            >
                                Save template
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Preview Tab ── */}
            <div style={{ display: activeTab === 'preview' ? 'block' : 'none' }}>
                {previewCtx ? (
                    <div className="template-preview-card">
                        <div className="template-preview-meta">
                            <span className="template-preview-label">To</span>
                            <div className="template-preview-val">
                                {previewCtx.member.email || previewCtx.member.name}
                                <select
                                    className="template-preview-member-sel"
                                    value={previewMemberId || ''}
                                    onChange={e => setPreviewMemberId(Number(e.target.value))}
                                >
                                    {familyMembers.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                            <span className="template-preview-label">Subject</span>
                            <div className="template-preview-val">
                                {buildInvoiceSubject(previewCtx.currentYear, previewCtx.member, subjectText, previewCtx)}
                            </div>
                            <span className="template-preview-label">Link</span>
                            <div className="template-preview-val template-preview-link-row">
                                {previewShareUrl ? (
                                    <>
                                        <span className="template-preview-url">{previewShareUrl}</span>
                                        <button
                                            className="template-preview-copy-btn"
                                            type="button"
                                            onClick={() => {
                                                navigator.clipboard.writeText(previewShareUrl).then(
                                                    () => showToast('Link copied!'),
                                                    () => showToast('Failed to copy')
                                                );
                                            }}
                                        >Copy</button>
                                        <button
                                            className="template-preview-manage-btn"
                                            type="button"
                                            onClick={() => setShareLinkDialog(true)}
                                        >Manage</button>
                                    </>
                                ) : (
                                    <button
                                        className="template-preview-copy-btn"
                                        onClick={handleGeneratePreviewLink}
                                        disabled={generatingLink || !userId}
                                    >
                                        {generatingLink ? 'Generating\u2026' : 'Generate share link'}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="template-preview-body invoice-preview-message"
                            dangerouslySetInnerHTML={{ __html: previewBodyHTML }} />
                        <div className="template-preview-actions">
                            <button
                                className="template-preview-test-btn"
                                onClick={() => { setTestEmailTo(userEmail || ''); setTestEmailOpen(true); }}
                            >
                                Send test email
                            </button>
                        </div>
                    </div>
                ) : (
                    <p className="invoicing-hint">Add family members to see a preview.</p>
                )}
            </div>

            {/* ── Modals ── */}
            {paymentMethodsModal && (
                <div className="dialog-overlay" onClick={() => setPaymentMethodsModal(false)}>
                    <div className="dialog dialog--wide" onClick={e => e.stopPropagation()}>
                        <div className="dialog-title">Payment Methods</div>
                        <p className="invoicing-hint invoicing-hint--dialog">
                            Changes here update the payment methods block used in invoice emails.
                        </p>
                        <div className="dialog-body-padded">
                            <PaymentMethodsManager
                                settings={settings}
                                readOnly={readOnly}
                                onUpdate={methods => {
                                    service.updateSettings({ paymentMethods: methods });
                                    // Sync to publicShares so share pages reflect changes immediately
                                    if (user && user.uid) {
                                        const enabled = methods.filter(m => m.enabled);
                                        getDocs(query(collection(db, 'publicShares'), where('ownerId', '==', user.uid)))
                                            .then(snap => Promise.all(snap.docs.map(d => updateDoc(d.ref, { paymentMethods: enabled, updatedAt: serverTimestamp() }))))
                                            .catch(() => {});
                                    }
                                }}
                            />
                        </div>
                        <div className="dialog-buttons">
                            <button className="btn btn-sm btn-primary" onClick={() => setPaymentMethodsModal(false)}>Done</button>
                        </div>
                    </div>
                </div>
            )}

            {testEmailOpen && previewCtx && (
                <div className="dialog-overlay" onClick={() => setTestEmailOpen(false)}>
                    <div className="dialog" onClick={e => e.stopPropagation()}>
                        <div className="dialog-title">Send Test Email</div>
                        <form onSubmit={async e => {
                            e.preventDefault();
                            if (!testEmailTo.trim()) return;
                            setTestEmailSending(true);
                            try {
                                const payload = previewEmailPayload || buildInvoiceTemplateEmailPayload(previewCtx, previewShareUrl);
                                const subject = '[Test] ' + buildInvoiceSubject(previewCtx.currentYear, previewCtx.member, subjectText, previewCtx);
                                await queueEmail({
                                    to: testEmailTo.trim(),
                                    subject,
                                    body: payload.text,
                                    html: payload.html,
                                    uid: userId
                                });
                                setTestEmailOpen(false);
                                showToast('Test email sent to ' + testEmailTo.trim());
                            } catch (err) {
                                setTestEmailOpen(false);
                                showToast('Send failed: ' + (err.message || 'Unknown error'));
                            } finally {
                                setTestEmailSending(false);
                            }
                        }}>
                            <div className="payment-dialog-fields">
                                <div className="payment-field-group">
                                    <label htmlFor="test-email-to">Send to</label>
                                    <input
                                        id="test-email-to"
                                        className="composer-input"
                                        type="email"
                                        value={testEmailTo}
                                        onChange={e => setTestEmailTo(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <p className="invoicing-hint invoicing-hint--dialog">
                                Sends the current preview (including unsaved edits) with [Test] in the subject.
                            </p>
                            <div className="dialog-buttons">
                                <button type="button" className="btn btn-sm btn-header-secondary" onClick={() => setTestEmailOpen(false)}>Cancel</button>
                                <button type="submit" className="btn btn-sm btn-primary" disabled={testEmailSending || !testEmailTo.trim()}>
                                    {testEmailSending ? 'Sending\u2026' : 'Send'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {shareLinkDialog && previewMember && (
                <ShareLinkDialog
                    open
                    memberId={previewMember.id}
                    memberName={previewMember.name}
                    userId={userId}
                    billingYearId={billingYearId}
                    yearLabel={activeYear ? (activeYear.label || activeYear.id) : ''}
                    initialTab="manage"
                    familyMembers={familyMembers}
                    bills={bills}
                    payments={payments}
                    activeYear={activeYear}
                    settings={settings}
                    showToast={showToast}
                    onClose={() => setShareLinkDialog(false)}
                />
            )}
        </div>
    );
}
