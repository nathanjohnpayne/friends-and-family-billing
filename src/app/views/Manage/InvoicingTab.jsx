/**
 * InvoicingTab — TipTap WYSIWYG email template editor with tabbed
 * Edit/Preview layout, token pills, and payment methods manager.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase.js';
import { queueEmail } from '../../../lib/mail.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { isYearReadOnly } from '../../../lib/validation.js';
import { detectDuplicatePaymentText } from '../../../lib/validation.js';
import {
    buildInvoiceSubject, getInvoiceSummaryContext,
    buildInvoiceTemplateEmailPayload,
    docToPlainTextWithTokens, plainTextToDoc
} from '../../../lib/invoice.js';
import { generateRawToken, hashToken } from '../../../lib/validation.js';
import { buildShareScopes, buildShareTokenDoc, buildShareUrl, buildPublicShareData, computeExpiryDate } from '../../../lib/share.js';
import TemplateEditor from '../../components/TemplateEditor.jsx';
import SubjectEditor from '../../components/SubjectEditor.jsx';
import { INLINE_TOKENS } from '../../components/TokenNode.js';
import { BLOCK_TOKENS } from '../../components/BlockTokenNode.js';
import PaymentMethodsManager from '../../components/PaymentMethodsManager.jsx';
import { syncPaymentMethodsToShares } from '../../../lib/paymentMethodsSync.js';
import ShareLinkDialog from '../../components/ShareLinkDialog.jsx';
import Dialog from '../../components/Dialog.jsx';
import FinancialUnavailable from '../../components/FinancialUnavailable.jsx';
import { getHouseholdFinancialAvailability } from '../../../lib/financial-availability.js';
import { useFinancialAccess } from '../../hooks/useFinancialAccess.js';

/** All tokens for the unified chip bar. */
const ALL_TOKEN_FIELDS = [
    ...INLINE_TOKENS.map(t => ({ id: t.id, label: t.label })),
    ...BLOCK_TOKENS.map(t => ({ id: t.id, label: t.label, isBlock: true, description: t.description })),
];

/** Keep template editing available while private household guards govern invoice output. */
export default function InvoicingTab() {
    const { familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], activeYear, loading, service } = useBillingData();
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
                creditAdjustments={creditAdjustments}
                owedAdjustments={owedAdjustments}
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

// ── Email Template Editor ───────────────────────────────────────────

/** Keep template editing available while binding invoice actions to the selected household. */
function EmailTemplateSection({ settings, familyMembers, bills, payments, creditAdjustments, owedAdjustments, activeYear, readOnly, userId, userEmail, billingYearId, service, showToast }) {
    const [activeTab, setActiveTab] = useState('edit');
    const [bodyDoc, setBodyDoc] = useState(() => deriveBodyDoc(settings));
    const [bodyText, setBodyText] = useState(() => deriveBodyText(settings));
    const [subjectText, setSubjectText] = useState(settings.emailSubject || '');
    const [dirty, setDirty] = useState(false);
    const [previewMemberId, setPreviewMemberId] = useState(
        familyMembers.length > 0 ? familyMembers[0].id : null
    );
    const [paymentMethodsModal, setPaymentMethodsModal] = useState(false);
    const [previewShareUrl, setPreviewShareUrl] = useState(settings.invoiceShareUrl || '');
    const [generatingLink, setGeneratingLink] = useState(false);
    const [shareLinkDialog, setShareLinkDialog] = useState(false);
    const [testEmailOpen, setTestEmailOpen] = useState(false);
    const [testEmailPreviewKey, setTestEmailPreviewKey] = useState(null);
    const [testEmailTo, setTestEmailTo] = useState('');
    const [testEmailSending, setTestEmailSending] = useState(false);

    const previewMember = familyMembers.find(m => m.id === previewMemberId) || familyMembers[0];
    const previewSettings = { ...settings, emailMessage: bodyText, emailMessageDocument: bodyDoc };
    const projectedContext = previewMember
        ? getInvoiceSummaryContext(familyMembers, bills, payments, previewMember.id, activeYear, previewSettings, owedAdjustments, creditAdjustments)
        : { ok: false };
    /** Read service state at action time so stale previews cannot authorize financial output. */
    const getAvailability = () => ({ available: projectedContext.ok && getHouseholdFinancialAvailability(
        { familyMembers, bills, payments, creditAdjustments, owedAdjustments, ...service.getState() }, previewMember?.id).available });
    const previewKey = String(billingYearId) + ':' + previewMember?.id + ':' + JSON.stringify(projectedContext);
    const access = useFinancialAccess(getAvailability, previewKey);

    // A hidden dialog must not reappear for a different household with an old
    // recipient. Reopening starts explicitly with the administrator's address.
    useEffect(() => {
        setTestEmailOpen(false);
        setTestEmailPreviewKey(null);
        setTestEmailTo('');
        setTestEmailSending(false);
    }, [previewKey, access.available]);

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
        }
    }, [billingYearId, settings, familyMembers]);

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

    /** Recheck after hashing and each write before invoking another writer or copying the link. */
    async function handleGeneratePreviewLink() {
        const ticket = access.begin();
        if (ticket === null) return;
        const member = familyMembers.find(m => m.id === previewMemberId) || familyMembers[0];
        if (!userId || !billingYearId || !member) return;
        setGeneratingLink(true);
        try {
            const rawToken = generateRawToken();
            const tokenHash = await hashToken(rawToken);
            if (!access.canContinue(ticket)) return;
            const scopes = buildShareScopes(true, true);
            const expiresAt = computeExpiryDate(365);
            const tokenDoc = buildShareTokenDoc(userId, member.id, member.name, billingYearId, rawToken, expiresAt, scopes);
            await setDoc(doc(db, 'shareTokens', tokenHash), { ...tokenDoc, createdAt: serverTimestamp() });
            if (!access.canContinue(ticket)) return;
            const publicData = buildPublicShareData(familyMembers, bills, payments, member.id, scopes, userId, activeYear, settings, owedAdjustments, creditAdjustments);
            if (publicData) {
                await setDoc(doc(db, 'publicShares', tokenHash), { ...publicData, updatedAt: serverTimestamp() });
            }
            if (!access.canContinue(ticket)) return;
            const url = buildShareUrl(window.location.origin, rawToken);
            setPreviewShareUrl(url);
            service.updateSettings({ invoiceShareUrl: url });
            try { await navigator.clipboard.writeText(url); } catch (_) { /* clipboard may be blocked */ }
            showToast('Share link generated!');
        } catch (err) {
            console.error('Failed to generate share link:', err);
            showToast('Failed to generate share link: ' + err.message, { kind: 'failure' });
        } finally {
            setGeneratingLink(false);
        }
    }

    /** Bind an explicit send session to this preview and reset its recipient to the administrator. */
    function openTestEmail() {
        if (access.begin() === null) return;
        setTestEmailTo(userEmail || '');
        setTestEmailPreviewKey(previewKey);
        setTestEmailOpen(true);
    }

    // Build preview context for the selected member
    let previewCtx = null;
    let previewEmailPayload = null;
    let previewBodyHTML = '';
    if (previewMember && access.available) {
        const ctx = projectedContext;
        if (ctx.ok) {
            previewCtx = ctx;
            previewEmailPayload = buildInvoiceTemplateEmailPayload(ctx, previewShareUrl);
            if (previewEmailPayload.ok) previewBodyHTML = previewEmailPayload.html;
            else previewCtx = null;
        }
    }

    const hasDuplicate = detectDuplicatePaymentText(bodyText);

    /**
     * Queue only the selected preview's explicitly opened send session. Recheck
     * before the writer and after its await before changing the dialog; a prior
     * request already queued while valid is not cancelled or allowed to update a different preview identity.
     */
    async function handleSendTestEmail(e) {
        e.preventDefault();
        const ticket = access.begin();
        if (ticket === null) return;
        if (!testEmailTo.trim()) return;
        setTestEmailSending(true);
        try {
            const payload = previewEmailPayload || buildInvoiceTemplateEmailPayload(previewCtx, previewShareUrl);
            const renderedSubject = buildInvoiceSubject(previewCtx?.currentYear, previewCtx?.member, subjectText, previewCtx);
            if (!payload.ok || !renderedSubject.ok) return;
            const subject = '[Test] ' + renderedSubject.value;
            // Only the markdown body is queued; the mail function renders
            // HTML server-side (queue docs cannot carry raw HTML).
            if (!access.canContinue(ticket)) return;
            await queueEmail({
                to: testEmailTo.trim(),
                subject,
                body: payload.markdown,
                uid: userId
            });
            if (!access.canContinue(ticket)) return;
            setTestEmailOpen(false);
            showToast('Test email sent to ' + testEmailTo.trim());
        } catch (err) {
            if (!access.canContinue(ticket)) return;
            setTestEmailOpen(false);
            showToast('Send failed: ' + (err.message || 'Unknown error'), { kind: 'failure' });
        } finally {
            if (access.canContinue(ticket)) setTestEmailSending(false);
        }
    }

    return (
        <div className="invoicing-section">
            {/* ── Header bar ── */}
            <div className="template-header-bar">
                <h3 className="type-display invoicing-title">Invoicing</h3>
                <div className="template-segmented-control">
                    <button
                        className={'template-segment' + (activeTab === 'edit' ? ' template-segment--active' : '')}
                        onClick={() => setActiveTab('edit')}
                        type="button"
                    >Edit</button>
                    <button
                        className={'template-segment' + (activeTab === 'preview' ? ' template-segment--active' : '')}
                        onClick={() => setActiveTab('preview')}
                        type="button"
                    >Preview</button>
                </div>
                {dirty && <span className="template-dirty-indicator">Unsaved changes</span>}
                <div className="template-header-actions">
                    {activeTab === 'edit' && !readOnly && (
                        <button
                            className="template-save-btn"
                            onClick={handleSave}
                            disabled={!dirty}
                        >
                            Save template
                        </button>
                    )}
                    {activeTab === 'preview' && access.available && (
                        <button
                            className="template-header-action-btn"
                            onClick={openTestEmail}
                        >
                            Send test email
                        </button>
                    )}
                </div>
            </div>

            {/* ── Unified card ── */}
            <div className="template-card">
                {/* Preview: metadata bar (To + Link) */}
                {activeTab === 'preview' && previewMember && (
                    <div className="template-preview-meta">
                        <span className="template-preview-label">To</span>
                        <div className="template-preview-val">
                            {previewMember.email || previewMember.name}
                            <select
                                className="template-preview-member-sel"
                                aria-label="Preview member"
                                value={previewMemberId || ''}
                                onChange={e => setPreviewMemberId(Number(e.target.value))}
                            >
                                {familyMembers.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>
                        <span className="template-preview-label">Link</span>
                        <div className="template-preview-val template-preview-link-row">
                            {!access.available ? <><span>Unavailable</span><button type="button" className="template-preview-manage-btn" onClick={() => setShareLinkDialog(true)}>Manage</button></> : previewShareUrl ? (
                                <>
                                    <span className="template-preview-url">{previewShareUrl}</span>
                                    <button
                                        className="template-preview-copy-btn"
                                        type="button"
                                        onClick={() => {
                                            if (access.begin() === null) return;
                                            navigator.clipboard.writeText(previewShareUrl).then(
                                                () => showToast('Link copied!'),
                                                () => showToast('Failed to copy', { kind: 'failure' })
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
                )}

                {/* Subject row (shared between Edit and Preview) */}
                <div className="template-subject-row">
                    <span className="template-subject-label">Subject</span>
                    <div className="template-subject-content">
                        <div
                            style={{ display: activeTab === 'edit' ? 'block' : 'none' }}
                            onFocus={() => { lastFocusedEditor.current = 'subject'; }}
                        >
                            <SubjectEditor
                                content={subjectText}
                                onUpdate={handleSubjectUpdate}
                                readOnly={readOnly}
                                ref={subjectEditorRef}
                            />
                        </div>
                        {activeTab === 'preview' && (
                            <span className="template-subject-preview-text">
                                {!access.available ? 'Unavailable' : previewCtx
                                    ? buildInvoiceSubject(previewCtx.currentYear, previewCtx.member, subjectText, previewCtx).value
                                    : subjectText || '\u2014'}
                            </span>
                        )}
                    </div>
                </div>

                {/* Edit: body editor (always mounted, hidden in preview) */}
                <div
                    style={{ display: activeTab === 'edit' ? 'block' : 'none' }}
                    onFocus={() => { lastFocusedEditor.current = 'body'; }}
                >
                    <TemplateEditor
                        content={bodyDoc}
                        onUpdate={handleBodyUpdate}
                        readOnly={readOnly}
                        onConfigurePaymentMethods={() => setPaymentMethodsModal(true)}
                        ref={bodyEditorRef}
                        toolbarExtra={!readOnly ? (
                            <>
                                <span className="template-composer-sep" />
                                <div className="template-composer-chips">
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
                            </>
                        ) : undefined}
                    />
                </div>

                {/* Edit: duplicate token warning */}
                {activeTab === 'edit' && hasDuplicate && (
                    <div className="template-card-warning">
                        Warning: Your template contains both the %payment_methods% token and hardcoded payment text.
                        This may cause duplicate payment information in invoices.
                    </div>
                )}

                {/* Preview: rendered body */}
                {activeTab === 'preview' && (
                    !access.available ? <FinancialUnavailable /> : previewCtx ? (
                        <>
                            <div className="template-preview-body invoice-preview-message"
                                dangerouslySetInnerHTML={{ __html: previewBodyHTML }} />
                            {previewCtx.carriedItems && (
                                <p className="invoicing-hint" style={{ padding: '0 16px 16px' }}>
                                    The carried block is added automatically whenever the household carries a balance into the year, so the total in the message is always explained. No template token is needed.
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="invoicing-hint" style={{ padding: '16px' }}>Add family members to see a preview.</p>
                    )
                )}
            </div>

            {/* ── Modals ── */}
            {paymentMethodsModal && (
                <Dialog
                    onClose={() => setPaymentMethodsModal(false)}
                    wide
                    title="Payment Methods"
                    footer={<button className="btn btn-sm btn-ink" onClick={() => setPaymentMethodsModal(false)}>Done</button>}
                >
                    <p className="invoicing-hint invoicing-hint--dialog">
                        Changes here update the payment methods block used in invoice emails.
                    </p>
                    <div className="dialog-body-padded">
                        <PaymentMethodsManager
                            settings={settings}
                            readOnly={readOnly}
                            onUpdate={methods => {
                                service.updateSettings({ paymentMethods: methods });
                                // Same share sync as the Settings page: publicShares
                                // paymentMethods + publicQrCodes for the signed-in owner.
                                syncPaymentMethodsToShares(userId || null, methods);
                            }}
                        />
                    </div>
                </Dialog>
            )}

            {testEmailOpen && testEmailPreviewKey === previewKey && previewCtx && (
                <Dialog
                    onClose={() => setTestEmailOpen(false)}
                    title="Send Test Email"
                    onSubmit={handleSendTestEmail}
                    footer={(
                        <>
                            <button type="button" className="btn btn-sm btn-header-secondary" onClick={() => setTestEmailOpen(false)}>Cancel</button>
                            <button type="submit" className="btn btn-sm btn-ink" disabled={testEmailSending || !testEmailTo.trim()}>
                                {testEmailSending ? 'Sending\u2026' : 'Send'}
                            </button>
                        </>
                    )}
                >
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
                </Dialog>
            )}

            {shareLinkDialog && previewMember && (
                <ShareLinkDialog
                    getAvailability={getAvailability}
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
                    owedAdjustments={owedAdjustments}
                    activeYear={activeYear}
                    settings={settings}
                    showToast={showToast}
                    onClose={() => setShareLinkDialog(false)}
                    onLinkGenerated={url => {
                        setPreviewShareUrl(url);
                        service.updateSettings({ invoiceShareUrl: url });
                    }}
                />
            )}
        </div>
    );
}
