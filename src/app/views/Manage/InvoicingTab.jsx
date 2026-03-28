/**
 * InvoicingTab — email template editor + payment methods manager.
 * Port of renderEmailSettings() (main.js:2605) and renderPaymentMethodsSettings() (main.js:2696).
 */
import { useState, useRef, useEffect } from 'react';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { isYearReadOnly, isValidE164 } from '../../../lib/validation.js';
import { detectDuplicatePaymentText } from '../../../lib/validation.js';
import { PAYMENT_METHOD_TYPES, getPaymentMethodIcon, getPaymentMethodDetail } from '../../../lib/formatting.js';
import { buildInvoiceBody, buildInvoiceSubject, getInvoiceSummaryContext, renderPreviewHTML } from '../../../lib/invoice.js';
import { escapeHtml } from '../../../lib/formatting.js';
import { generateRawToken, hashToken } from '../../../lib/validation.js';
import { buildShareScopes, buildShareTokenDoc, buildShareUrl, buildPublicShareData } from '../../../lib/share.js';
import ActionMenu, { ActionMenuItem } from '../../components/ActionMenu.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';

const EMAIL_TEMPLATE_FIELDS = [
    { token: '%billing_year%', label: 'Billing Year' },
    { token: '%annual_total%', label: 'Household Total' },
    { token: '%payment_methods%', label: 'Payment Methods' },
    { token: '%share_link%', label: 'Share Link' }
];

/**
 * Sync QR codes to the publicQrCodes collection (mirrors main.js:3895).
 * Called after payment method updates to keep share pages in sync.
 */
async function syncPublicQrCodes(userId, methods) {
    if (!userId) return;
    const methodsWithQr = (methods || []).filter(m => m.qrCode);
    // Write/update QR codes for methods that have them
    for (const m of methodsWithQr) {
        const docId = userId + '_' + m.id;
        try {
            await setDoc(doc(db, 'publicQrCodes', docId), {
                ownerId: userId,
                methodId: m.id,
                qrCode: m.qrCode,
                updatedAt: serverTimestamp()
            });
        } catch (err) {
            console.error('Error writing public QR code:', err);
        }
    }
    // Delete QR codes for methods that no longer have them
    const allMethods = methods || [];
    const withoutQr = allMethods.filter(m => !m.qrCode && m.hasQrCode === false);
    for (const m of withoutQr) {
        const docId = userId + '_' + m.id;
        try { await deleteDoc(doc(db, 'publicQrCodes', docId)); } catch (_) {}
    }
}

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
            />
            <PaymentMethodsSection
                settings={settings}
                readOnly={readOnly}
                onUpdate={paymentMethods => {
                    service.updateSettings({ paymentMethods });
                    syncPublicQrCodes(user ? user.uid : null, paymentMethods);
                    showToast('Payment methods updated');
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

function EmailTemplateSection({ settings, familyMembers, bills, payments, activeYear, readOnly, userId, billingYearId, showToast, onSave }) {
    const [template, setTemplate] = useState(settings.emailMessage || '');
    const [dirty, setDirty] = useState(false);
    const editorRef = useRef(null);
    const isEditing = useRef(false);
    const [previewShareUrl, setPreviewShareUrl] = useState('');
    const [generatingLink, setGeneratingLink] = useState(false);

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
            const scopes = buildShareScopes(false, false);
            const tokenDoc = buildShareTokenDoc(userId, member.id, member.name, billingYearId, rawToken, null, scopes);
            await setDoc(doc(db, 'shareTokens', tokenHash), { ...tokenDoc, createdAt: serverTimestamp() });
            const publicData = buildPublicShareData(familyMembers, bills, payments, member.id, scopes, userId, activeYear, settings);
            if (publicData) {
                await setDoc(doc(db, 'publicShares', tokenHash), { ...publicData, updatedAt: serverTimestamp() });
            }
            const url = buildShareUrl(window.location.origin, rawToken);
            setPreviewShareUrl(url);
            await navigator.clipboard.writeText(url);
            if (showToast) showToast('Share link generated and copied!');
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
                                <span>
                                    {previewShareUrl ? (
                                        <span className="invoice-share-url">{previewShareUrl}</span>
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

// ── Payment Methods Manager ─────────────────────────────────────────

function PaymentMethodsSection({ settings, readOnly, onUpdate }) {
    const methods = settings.paymentMethods || [];
    const [editTarget, setEditTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [newType, setNewType] = useState('venmo');

    function addMethod() {
        const typeDef = PAYMENT_METHOD_TYPES[newType];
        const method = {
            id: 'pm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: newType,
            label: typeDef ? typeDef.label : newType,
            enabled: true,
            email: '', phone: '', handle: '', url: '', instructions: ''
        };
        onUpdate([...methods, method]);
    }

    function toggleEnabled(methodId) {
        onUpdate(methods.map(m =>
            m.id === methodId ? { ...m, enabled: !m.enabled } : m
        ));
    }

    function removeMethod() {
        if (!deleteTarget) return;
        onUpdate(methods.filter(m => m.id !== deleteTarget.id));
        setDeleteTarget(null);
    }

    function saveEdit(updated) {
        onUpdate(methods.map(m => m.id === updated.id ? updated : m));
        setEditTarget(null);
    }

    return (
        <div className="invoicing-section">
            <h3>Payment Methods</h3>
            <p className="invoicing-hint">
                Configure payment methods shown in invoices and on the share page.
            </p>

            {methods.length === 0 ? (
                <p className="invoicing-empty">No payment methods configured yet.</p>
            ) : (
                <div className="payment-methods-list">
                    {methods.map(method => (
                        <div key={method.id} className={'payment-method-item' + (method.enabled ? '' : ' payment-method-disabled')}>
                            <div className="payment-method-icon" dangerouslySetInnerHTML={{ __html: getPaymentMethodIcon(method.type) }} />
                            <div className="payment-method-info">
                                <strong>{method.label}</strong>
                                {(method.qrCode || method.hasQrCode) && (
                                    <span className="pm-qr-badge" title="QR code uploaded">
                                        <img src="/qr-code.svg" alt="QR" className="pm-qr-icon" />
                                    </span>
                                )}
                                <span className="payment-method-detail">{getPaymentMethodDetail(method)}</span>
                            </div>
                            {!readOnly && (
                                <div className="payment-method-controls">
                                    <label className="payment-method-toggle">
                                        <input
                                            type="checkbox"
                                            checked={method.enabled}
                                            onChange={() => toggleEnabled(method.id)}
                                        />
                                        <span className="toggle-label">{method.enabled ? 'On' : 'Off'}</span>
                                    </label>
                                    <ActionMenu label={'Actions for ' + method.label}>
                                        <ActionMenuItem onClick={() => setEditTarget({ ...method })}>
                                            Edit
                                        </ActionMenuItem>
                                        <ActionMenuItem onClick={() => setDeleteTarget(method)} danger>
                                            Remove
                                        </ActionMenuItem>
                                    </ActionMenu>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {!readOnly && (
                <div className="payment-method-add">
                    <select
                        className="composer-input"
                        value={newType}
                        onChange={e => setNewType(e.target.value)}
                    >
                        {Object.entries(PAYMENT_METHOD_TYPES).map(([key, val]) => (
                            <option key={key} value={key}>{val.label}</option>
                        ))}
                    </select>
                    <button className="btn btn-sm btn-primary" onClick={addMethod}>
                        Add Payment Method
                    </button>
                </div>
            )}

            <ConfirmDialog
                open={deleteTarget !== null}
                title="Remove Payment Method"
                message={deleteTarget ? 'Remove ' + deleteTarget.label + '?' : ''}
                confirmLabel="Remove"
                destructive
                onConfirm={removeMethod}
                onCancel={() => setDeleteTarget(null)}
            />

            {editTarget && (
                <PaymentMethodEditDialog
                    method={editTarget}
                    onSave={saveEdit}
                    onCancel={() => setEditTarget(null)}
                />
            )}
        </div>
    );
}

// ── Payment Method Edit Dialog ──────────────────────────────────────

function PaymentMethodEditDialog({ method, onSave, onCancel }) {
    const [fields, setFields] = useState({ ...method });
    const [error, setError] = useState('');
    const qrInputRef = useRef(null);
    const typeDef = PAYMENT_METHOD_TYPES[method.type] || { fields: ['url', 'instructions'] };

    function update(key, value) {
        setFields(prev => ({ ...prev, [key]: value }));
        setError('');
    }

    function handleSave(e) {
        e.preventDefault();
        setError('');

        // Default blank label to type default (mirrors main.js:2908)
        const label = (fields.label || '').trim();
        const defaultLabel = (PAYMENT_METHOD_TYPES[method.type] || PAYMENT_METHOD_TYPES.other).label;
        const validated = { ...fields, label: label || defaultLabel };

        // Validate phone (E.164, mirrors main.js:2912)
        const phone = (validated.phone || '').trim();
        if (phone && !isValidE164(phone)) {
            setError('Phone must be in E.164 format (e.g., +14155551212)');
            return;
        }
        validated.phone = phone;

        // Validate URL (http(s), mirrors main.js:2921)
        const url = (validated.url || '').trim();
        if (url && !/^https?:\/\//i.test(url)) {
            setError('URL must start with http:// or https://');
            return;
        }
        validated.url = url;

        // Trim all string fields
        if (validated.email) validated.email = validated.email.trim();
        if (validated.handle) validated.handle = validated.handle.trim();
        if (validated.instructions) validated.instructions = validated.instructions.trim();

        onSave(validated);
    }

    const fieldDefs = {
        handle: { label: 'Handle / Username', placeholder: '@username' },
        email: { label: 'Email', placeholder: 'email@example.com', type: 'email' },
        phone: { label: 'Phone', placeholder: '+14155551212', type: 'tel' },
        url: { label: 'URL / Link', placeholder: 'https://', type: 'url' },
        instructions: { label: 'Instructions (optional)', placeholder: 'Additional payment instructions...' }
    };

    return (
        <div className="dialog-overlay" onClick={onCancel}>
            <div className="dialog" onClick={e => e.stopPropagation()}>
                <div className="dialog-title">Edit {method.label}</div>
                <form onSubmit={handleSave}>
                    <div className="payment-dialog-fields">
                        <div className="payment-field-group">
                            <label>Display Label</label>
                            <input
                                className="composer-input"
                                value={fields.label}
                                onChange={e => update('label', e.target.value)}
                            />
                        </div>
                        {typeDef.fields.map(f => {
                            const def = fieldDefs[f] || { label: f, placeholder: '' };
                            return (
                                <div key={f} className="payment-field-group">
                                    <label>{def.label}</label>
                                    {f === 'instructions' ? (
                                        <textarea
                                            className="composer-input"
                                            rows={2}
                                            placeholder={def.placeholder}
                                            value={fields[f] || ''}
                                            onChange={e => update(f, e.target.value)}
                                        />
                                    ) : (
                                        <input
                                            className="composer-input"
                                            type={def.type || 'text'}
                                            placeholder={def.placeholder}
                                            value={fields[f] || ''}
                                            onChange={e => update(f, e.target.value)}
                                        />
                                    )}
                                </div>
                            );
                        })}
                        <div className="payment-field-group">
                            <label>QR Code (optional)</label>
                            {fields.qrCode ? (
                                <div className="pm-qr-preview">
                                    <img src={fields.qrCode} alt="QR Code" className="pm-qr-image" />
                                    <div className="pm-qr-actions">
                                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => qrInputRef.current && qrInputRef.current.click()}>
                                            Replace
                                        </button>
                                        <button type="button" className="btn btn-sm btn-tertiary" style={{ color: 'var(--color-danger)' }} onClick={() => {
                                            setFields(prev => ({ ...prev, qrCode: '', hasQrCode: false }));
                                        }}>
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button type="button" className="btn btn-sm btn-secondary" onClick={() => qrInputRef.current && qrInputRef.current.click()}>
                                    Upload QR Code
                                </button>
                            )}
                            <input
                                ref={qrInputRef}
                                type="file"
                                accept="image/png,image/jpeg"
                                style={{ display: 'none' }}
                                onChange={e => {
                                    const file = e.target.files && e.target.files[0];
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                        setFields(prev => ({ ...prev, qrCode: reader.result, hasQrCode: true }));
                                    };
                                    reader.readAsDataURL(file);
                                    e.target.value = '';
                                }}
                            />
                        </div>
                    </div>
                    {error && <p className="composer-error">{error}</p>}
                    <div className="dialog-buttons">
                        <button type="button" className="btn btn-sm btn-header-secondary" onClick={onCancel}>Cancel</button>
                        <button type="submit" className="btn btn-sm btn-primary">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
