/**
 * InvoicingTab — TipTap WYSIWYG email template editor with tabbed
 * Edit/Preview layout, token pills, and payment methods manager.
 */
import { useState, useRef } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase.js';
import { queueEmail } from '../../../lib/mail.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { isYearReadOnly } from '../../../lib/validation.js';
import { detectDuplicatePaymentText } from '../../../lib/validation.js';
import {
    buildInvoiceBody, buildInvoiceSubject, getInvoiceSummaryContext,
    renderPreviewHTML, docToPlainTextWithTokens, plainTextToDoc
} from '../../../lib/invoice.js';
import { generateRawToken, hashToken } from '../../../lib/validation.js';
import { buildShareScopes, buildShareTokenDoc, buildShareUrl, buildPublicShareData, computeExpiryDate } from '../../../lib/share.js';
import TemplateEditor from '../../components/TemplateEditor.jsx';
import SubjectEditor from '../../components/SubjectEditor.jsx';
import { INLINE_TOKENS } from '../../components/TokenNode.js';
import { BLOCK_TOKENS } from '../../components/BlockTokenNode.js';
import PaymentMethodsManager from '../../components/PaymentMethodsManager.jsx';
import ShareLinkDialog from '../../components/ShareLinkDialog.jsx';

const EMAIL_TEMPLATE_FIELDS = [
    ...INLINE_TOKENS.map(t => ({ token: '%' + t.id + '%', label: t.label, id: t.id })),
    ...BLOCK_TOKENS.map(t => ({ token: '%' + t.id + '%', label: t.label, id: t.id, isBlock: true })),
];

const SUBJECT_TOKEN_FIELDS = INLINE_TOKENS.map(t => ({
    token: '%' + t.id + '%', label: t.label, id: t.id,
}));

export default function InvoicingTab() {
    const { familyMembers, bills, payments, activeYear, loading, service } = useBillingData();
    const { user } = useAuth();
    const { showToast } = useToast();
    const readOnly = isYearReadOnly(activeYear);
    const settings = service.getState().settings || {};

    if (loading) return <p className="invoicing-loading">Loading\u2026</p>;

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

// ── Email Template Editor ───────────────────────────────────────────

function EmailTemplateSection({ settings, familyMembers, bills, payments, activeYear, readOnly, userId, userEmail, billingYearId, service, showToast }) {
    // Initialize body document from TipTap JSON or legacy plaintext
    const initialDoc = settings.emailMessageDocument
        ? settings.emailMessageDocument
        : plainTextToDoc(settings.emailMessage || '');
    const initialText = settings.emailMessageDocument
        ? docToPlainTextWithTokens(settings.emailMessageDocument)
        : (settings.emailMessage || '');

    const [activeTab, setActiveTab] = useState('edit');
    const [bodyDoc, setBodyDoc] = useState(initialDoc);
    const [bodyText, setBodyText] = useState(initialText);
    const [subjectText, setSubjectText] = useState(settings.emailSubject || '');
    const [dirty, setDirty] = useState(false);
    const [savedFlash, setSavedFlash] = useState(false);
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

    // TipTap editor refs for chip-bar insertion
    const bodyEditorRef = useRef(null);
    const subjectEditorRef = useRef(null);

    function handleBodyUpdate(json, text) {
        setBodyDoc(json);
        setBodyText(text);
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
        setSavedFlash(true);
        showToast('Email template saved');
        setTimeout(() => setSavedFlash(false), 1500);
    }

    function insertBodyToken(field) {
        // Not implemented inline — the chip buttons are kept for discoverability
        // but TipTap's slash command is the primary insertion mechanism.
        // This uses the editor instance via the TemplateEditor component.
        // We fall back to the token pattern for simplicity.
        if (!bodyEditorRef.current) return;
        const editor = bodyEditorRef.current;
        if (field.isBlock) {
            const info = BLOCK_TOKENS.find(b => b.id === field.id);
            editor.chain().focus().insertContent({
                type: 'blockToken',
                attrs: { id: field.id, label: field.label, description: info?.description || '' },
            }).run();
        } else {
            editor.chain().focus().insertContent({
                type: 'templateToken',
                attrs: { id: field.id, label: field.label },
            }).run();
        }
    }

    function insertSubjectToken(field) {
        if (!subjectEditorRef.current) return;
        subjectEditorRef.current.chain().focus().insertContent({
            type: 'templateToken',
            attrs: { id: field.id, label: field.label },
        }).run();
    }

    async function handleGeneratePreviewLink() {
        if (!userId || !billingYearId || familyMembers.length === 0) return;
        setGeneratingLink(true);
        try {
            const member = familyMembers[0];
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
    let previewBodyHTML = '';
    if (previewMember) {
        const previewSettings = {
            ...settings,
            emailMessage: bodyText,
            emailMessageDocument: bodyDoc,
        };
        const ctx = getInvoiceSummaryContext(familyMembers, bills, payments, previewMember.id, activeYear, previewSettings);
        if (ctx) {
            previewCtx = ctx;
            const rawText = buildInvoiceBody(ctx, 'text-only', previewShareUrl, 'email', { markdown: true });
            previewBodyHTML = renderPreviewHTML(rawText);
        }
    }

    const hasDuplicate = detectDuplicatePaymentText(bodyText);

    return (
        <div className="invoicing-section">
            <div className="invoicing-header">
                <h3>Email Template</h3>
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
                    {dirty && <span className="template-dirty-indicator">Unsaved changes</span>}
                </div>
            </div>

            {/* ── Edit Tab ── */}
            <div style={{ display: activeTab === 'edit' ? 'block' : 'none' }}>
                <p className="invoicing-hint invoicing-hint--compact">
                    Use / to insert billing fields. Formatting is applied as you type.
                </p>

                <div className="payment-field-group subject-field-group">
                    <label>Subject Line</label>
                    <SubjectEditor
                        content={subjectText}
                        onUpdate={handleSubjectUpdate}
                        readOnly={readOnly}
                        ref={subjectEditorRef}
                    />
                    {!readOnly && (
                        <div className="template-token-bar">
                            <span className="template-token-label">Insert:</span>
                            {SUBJECT_TOKEN_FIELDS.map(f => (
                                <button
                                    key={f.token}
                                    className="template-token-chip"
                                    type="button"
                                    onClick={() => insertSubjectToken(f)}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    )}
                    <p className="invoicing-hint invoicing-hint--small">
                        Leave blank to use the default: {'"'}Annual Billing Summary [Year]{'\u2014'}[Name]{'"'}.
                    </p>
                </div>

                <div className="payment-field-group">
                    <label>Email Message</label>
                    {!readOnly && (
                        <div className="template-token-bar">
                            <span className="template-token-label">Insert:</span>
                            {EMAIL_TEMPLATE_FIELDS.map(f => (
                                <button
                                    key={f.token}
                                    className="template-token-chip"
                                    type="button"
                                    onClick={() => insertBodyToken(f)}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    )}

                    <TemplateEditor
                        content={bodyDoc}
                        onUpdate={handleBodyUpdate}
                        readOnly={readOnly}
                        onConfigurePaymentMethods={() => setPaymentMethodsModal(true)}
                        ref={bodyEditorRef}
                    />
                </div>

                {hasDuplicate && (
                    <p className="composer-error">
                        Warning: Your template contains both the %payment_methods% token and hardcoded payment text.
                        This may cause duplicate payment information in invoices.
                    </p>
                )}

                {!readOnly && (
                    <div className="template-save-bar">
                        <button
                            className="btn btn-sm btn-primary"
                            onClick={handleSave}
                            disabled={!dirty}
                        >
                            {savedFlash ? 'Saved \u2713' : 'Save Template'}
                        </button>
                    </div>
                )}
            </div>

            {/* ── Preview Tab ── */}
            <div style={{ display: activeTab === 'preview' ? 'block' : 'none' }}>
                {previewCtx ? (
                    <div className="invoice-template-preview">
                        <div className="invoice-template-preview-head">
                            <div className="preview-member-selector">
                                <label htmlFor="preview-member">Preview for:</label>
                                <select
                                    id="preview-member"
                                    className="composer-input"
                                    value={previewMemberId || ''}
                                    onChange={e => setPreviewMemberId(Number(e.target.value))}
                                >
                                    {familyMembers.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                            <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => { setTestEmailTo(userEmail || ''); setTestEmailOpen(true); }}
                            >
                                Send test email
                            </button>
                        </div>
                        <div className="invoice-template-preview-body">
                            <div className="invoice-preview-shell">
                                <div className="invoice-preview-meta-grid">
                                    <span className="invoice-preview-meta-label">To</span>
                                    <span>{previewCtx.member.email || previewCtx.member.name}</span>
                                    <span className="invoice-preview-meta-label">Subject</span>
                                    <span>{buildInvoiceSubject(previewCtx.currentYear, previewCtx.member, subjectText, previewCtx)}</span>
                                    <span className="invoice-preview-meta-label">Link</span>
                                    <span className="preview-link-actions">
                                        {previewShareUrl ? (
                                            <>
                                                <span className="invoice-share-url">{previewShareUrl}</span>
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    type="button"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(previewShareUrl).then(
                                                            () => showToast('Link copied!'),
                                                            () => showToast('Failed to copy')
                                                        );
                                                    }}
                                                >Copy</button>
                                                <button
                                                    className="btn-link"
                                                    type="button"
                                                    onClick={() => setShareLinkDialog(true)}
                                                >Manage links</button>
                                            </>
                                        ) : (
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={handleGeneratePreviewLink}
                                                disabled={generatingLink || !userId}
                                            >
                                                {generatingLink ? 'Generating\u2026' : 'Generate share link'}
                                            </button>
                                        )}
                                    </span>
                                </div>
                                <div className="invoice-preview-message"
                                    dangerouslySetInnerHTML={{ __html: previewBodyHTML }} />
                            </div>
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
                        <p className="invoicing-hint" style={{ padding: '0 24px 8px' }}>
                            Changes here update the payment methods block used in invoice emails.
                        </p>
                        <PaymentMethodsManager
                            settings={settings}
                            readOnly={readOnly}
                            onUpdate={methods => service.updateSettings({ paymentMethods: methods })}
                        />
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
                                const rawText = buildInvoiceBody(previewCtx, 'text-only', previewShareUrl, 'email', { markdown: true });
                                const subject = '[Test] ' + buildInvoiceSubject(previewCtx.currentYear, previewCtx.member, subjectText, previewCtx);
                                await queueEmail({ to: testEmailTo.trim(), subject, body: rawText, uid: userId });
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
                            <p className="invoicing-hint invoicing-hint--small invoicing-hint--dialog">
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

            {shareLinkDialog && familyMembers.length > 0 && (
                <ShareLinkDialog
                    open
                    memberId={familyMembers[0].id}
                    memberName={familyMembers[0].name}
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
