/**
 * InvoicingTab — email template editor + payment methods manager.
 * Port of renderEmailSettings() (main.js:2605) and renderPaymentMethodsSettings() (main.js:2696).
 */
import { useState, useRef, useEffect } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { isYearReadOnly } from '../../../lib/validation.js';
import { detectDuplicatePaymentText } from '../../../lib/validation.js';
import { buildInvoiceBody, buildInvoiceSubject, getInvoiceSummaryContext, renderPreviewHTML } from '../../../lib/invoice.js';
import { escapeHtml } from '../../../lib/formatting.js';
import { generateRawToken, hashToken } from '../../../lib/validation.js';
import { buildShareScopes, buildShareTokenDoc, buildShareUrl, buildPublicShareData, computeExpiryDate } from '../../../lib/share.js';
import ShareLinkDialog from '../../components/ShareLinkDialog.jsx';
import ActionMenu, { ActionMenuItem } from '../../components/ActionMenu.jsx';

const EMAIL_TEMPLATE_FIELDS = [
    { token: '%billing_year%', label: 'Billing Year' },
    { token: '%annual_total%', label: 'Household Total' },
    { token: '%payment_methods%', label: 'Payment Methods' },
    { token: '%share_link%', label: 'Share Link' }
];

export default function InvoicingTab() {
    const { familyMembers, bills, payments, activeYear, loading, service } = useBillingData();
    const { user } = useAuth();
    const { showToast } = useToast();
    const readOnly = isYearReadOnly(activeYear);
    const settings = service.getState().settings || {};

    if (loading) return <p style={{ color: '#666' }}>Loading…</p>;

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
                billingYearId={activeYear ? activeYear.id : ''}
                showToast={showToast}
                onSave={emailMessage => {
                    service.updateSettings({ emailMessage });
                    showToast('Email template saved');
                }}
                onSaveShareUrl={invoiceShareUrl => {
                    service.updateSettings({ invoiceShareUrl });
                }}
            />
        </div>
    );
}

// ── Email Template Editor ───────────────────────────────────────────

const EMAIL_TEMPLATE_TOKEN_LABELS = {
    '%billing_year%': 'Billing Year',
    '%annual_total%': 'Household Total',
    '%total%': 'Household Total',
    '%payment_methods%': 'Payment Methods',
    '%share_link%': 'Share Link'
};

const TOKEN_PATTERN = /(%billing_year%|%annual_total%|%total%|%payment_methods%|%share_link%)/g;

/**
 * Convert raw template string to editor HTML with inline token chips.
 * Each token becomes a non-editable styled span; lines wrap in divs.
 */
function buildEditorHTML(template) {
    if (!template) return '<div class="template-editor-line"><br></div>';
    const lines = template.split('\n');
    return lines.map(line => {
        if (line === '') return '<div class="template-editor-line"><br></div>';
        const parts = line.split(TOKEN_PATTERN);
        const inner = parts.map(part => {
            if (TOKEN_PATTERN.test(part)) {
                TOKEN_PATTERN.lastIndex = 0; // reset regex state
                const label = EMAIL_TEMPLATE_TOKEN_LABELS[part] || part;
                return '<span class="template-editor-token" contenteditable="false" data-token="' + escapeHtml(part) + '">' + escapeHtml(label) + '</span>';
            }
            return escapeHtml(part);
        }).join('');
        return '<div class="template-editor-line">' + inner + '</div>';
    }).join('');
}

/**
 * Reverse-parse contenteditable div to raw template string.
 * Token chip spans become their data-token values; HTML structure becomes text.
 */
function extractTemplateValue(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    // Replace token spans with their data-token attribute
    clone.querySelectorAll('.template-editor-token').forEach(chip => {
        const token = chip.getAttribute('data-token') || '';
        chip.replaceWith(token);
    });
    // Convert block structure to text lines
    const lines = [];
    clone.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            lines.push(node.textContent);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const text = node.textContent;
            // Empty divs with only <br> represent blank lines
            if (node.tagName === 'DIV' && node.innerHTML === '<br>') {
                lines.push('');
            } else {
                lines.push(text);
            }
        }
    });
    // If no block children, fall back to textContent
    if (lines.length === 0) return clone.textContent || '';
    return lines.join('\n');
}

function EmailTemplateSection({ settings, familyMembers, bills, payments, activeYear, readOnly, userId, billingYearId, showToast, onSave, onSaveShareUrl }) {
    const [template, setTemplate] = useState(settings.emailMessage || '');
    const [dirty, setDirty] = useState(false);
    const editorRef = useRef(null);
    const isEditing = useRef(false);
    const [previewShareUrl, setPreviewShareUrl] = useState(settings.invoiceShareUrl || '');
    const [generatingLink, setGeneratingLink] = useState(false);
    const [shareLinkDialog, setShareLinkDialog] = useState(false);

    // Sync editor HTML when template changes externally (not during editing)
    useEffect(() => {
        if (!dirty && editorRef.current && !isEditing.current) {
            setTemplate(settings.emailMessage || '');
            editorRef.current.innerHTML = buildEditorHTML(settings.emailMessage || '');
        }
    }, [settings.emailMessage]);

    // Initialize editor HTML on mount
    useEffect(() => {
        if (editorRef.current) {
            editorRef.current.innerHTML = buildEditorHTML(template);
        }
    }, []);

    function handleEditorInput() {
        isEditing.current = true;
        const value = extractTemplateValue(editorRef.current);
        setTemplate(value);
        setDirty(true);

        // Detect if raw token text was pasted — normalize if so
        const text = editorRef.current.textContent || '';
        if (TOKEN_PATTERN.test(text)) {
            TOKEN_PATTERN.lastIndex = 0;
            // Check if any token is in a text node (not a chip)
            let hasRawToken = false;
            const walker = document.createTreeWalker(editorRef.current, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                if (TOKEN_PATTERN.test(walker.currentNode.textContent)) {
                    hasRawToken = true;
                    TOKEN_PATTERN.lastIndex = 0;
                    break;
                }
            }
            if (hasRawToken) {
                editorRef.current.innerHTML = buildEditorHTML(value);
                placeCaretAtEnd(editorRef.current);
            }
        }
        isEditing.current = false;
    }

    function handleEditorPaste(e) {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        if (text) {
            document.execCommand('insertText', false, text);
        }
    }

    function insertToken(token) {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();

        const chip = document.createElement('span');
        chip.className = 'template-editor-token';
        chip.contentEditable = 'false';
        chip.dataset.token = token;
        chip.textContent = EMAIL_TEMPLATE_TOKEN_LABELS[token] || token;

        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(chip);
            // Add a spacer text node after the chip and move cursor there
            const spacer = document.createTextNode('\u00A0');
            chip.parentNode.insertBefore(spacer, chip.nextSibling);
            range.setStartAfter(spacer);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            // No valid selection in editor — append to end
            const lastLine = editor.querySelector('.template-editor-line:last-child') || editor;
            lastLine.appendChild(chip);
            lastLine.appendChild(document.createTextNode('\u00A0'));
            placeCaretAtEnd(editor);
        }

        const value = extractTemplateValue(editor);
        setTemplate(value);
        setDirty(true);
    }

    function handleSave() {
        onSave(template);
        setDirty(false);
    }

    async function handleGeneratePreviewLink() {
        if (!userId || !billingYearId || familyMembers.length === 0) return;
        setGeneratingLink(true);
        try {
            const member = familyMembers[0];
            const rawToken = generateRawToken();
            const tokenHash = await hashToken(rawToken);
            // Default: 1 year expiry, both review permissions enabled
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
            // Persist in settings so it survives navigation
            if (onSaveShareUrl) onSaveShareUrl(url);
            try { await navigator.clipboard.writeText(url); } catch (_) { /* clipboard may be blocked */ }
            if (showToast) showToast('Share link generated!');
        } catch (err) {
            console.error('Failed to generate share link:', err);
            if (showToast) showToast('Failed to generate share link: ' + err.message);
        }
        setGeneratingLink(false);
    }

    // Build live preview with context
    let previewCtx = null;
    let previewBodyHTML = '';
    if (familyMembers.length > 0) {
        const sampleMemberId = familyMembers[0].id;
        const ctx = getInvoiceSummaryContext(familyMembers, bills, payments, sampleMemberId, activeYear, { ...settings, emailMessage: template });
        if (ctx) {
            previewCtx = ctx;
            const rawText = buildInvoiceBody(ctx, 'text-only', previewShareUrl, 'email', { markdown: true });
            previewBodyHTML = renderPreviewHTML(rawText);
        }
    }

    const hasDuplicate = detectDuplicatePaymentText(template);

    return (
        <div className="invoicing-section">
            <h3>Email Template</h3>
            <p className="invoicing-hint">
                Customize the message included in email invoices. Use the field chips to insert live billing data. Markdown formatting (bold, italic, links, lists) is supported.
            </p>

            {!readOnly && (
                <div className="template-token-bar">
                    <span className="template-token-label">Insert fields:</span>
                    {EMAIL_TEMPLATE_FIELDS.map(f => (
                        <button
                            key={f.token}
                            className="template-token-chip"
                            type="button"
                            onClick={() => insertToken(f.token)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            )}

            <div
                ref={editorRef}
                className="template-editor"
                contentEditable={!readOnly}
                suppressContentEditableWarning
                role="textbox"
                tabIndex={0}
                aria-multiline="true"
                onInput={handleEditorInput}
                onPaste={handleEditorPaste}
            />

            {hasDuplicate && (
                <p className="composer-error">
                    Warning: Your template contains both the %payment_methods% token and hardcoded payment text.
                    This may cause duplicate payment information in invoices.
                </p>
            )}

            {previewCtx && (
                <div className="invoice-template-preview">
                    <div className="invoice-template-preview-head">
                        <span className="invoice-template-preview-label">Live Preview</span>
                        <span className="invoice-template-preview-sample">
                            Previewing the default email invoice for {previewCtx.member.name} in {previewCtx.currentYear}
                        </span>
                    </div>
                    <div className="invoice-template-preview-body">
                        <div className="invoice-preview-shell">
                            <div className="invoice-preview-meta">
                                <span className="invoice-preview-meta-label">To</span>
                                <span>{previewCtx.member.email || previewCtx.member.name}</span>
                            </div>
                            <div className="invoice-preview-meta">
                                <span className="invoice-preview-meta-label">Subject</span>
                                <span>{buildInvoiceSubject(previewCtx.currentYear, previewCtx.member)}</span>
                            </div>
                            <div className="invoice-preview-meta">
                                <span className="invoice-preview-meta-label">Link</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {previewShareUrl ? (
                                        <>
                                            <span className="invoice-share-url">{previewShareUrl}</span>
                                            <ActionMenu label="Share link options">
                                                <ActionMenuItem onClick={() => {
                                                    navigator.clipboard.writeText(previewShareUrl).then(
                                                        () => showToast && showToast('Link copied!'),
                                                        () => showToast && showToast('Failed to copy')
                                                    );
                                                }}>
                                                    Copy Link
                                                </ActionMenuItem>
                                                <ActionMenuItem onClick={() => setShareLinkDialog(true)}>
                                                    Manage Share Links
                                                </ActionMenuItem>
                                                <ActionMenuItem onClick={handleGeneratePreviewLink}>
                                                    Generate New Link
                                                </ActionMenuItem>
                                            </ActionMenu>
                                        </>
                                    ) : (
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={handleGeneratePreviewLink}
                                            disabled={generatingLink || !userId}
                                        >
                                            {generatingLink ? 'Generating…' : 'Generate Share Link'}
                                        </button>
                                    )}
                                </span>
                            </div>
                            <div className="invoice-preview-message"
                                dangerouslySetInnerHTML={{ __html: previewBodyHTML }} />
                        </div>
                    </div>
                </div>
            )}

            {!readOnly && (
                <button
                    className="btn btn-sm btn-primary"
                    onClick={handleSave}
                    disabled={!dirty}
                >
                    Save Template
                </button>
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

/** Place caret at end of a contenteditable element */
function placeCaretAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

