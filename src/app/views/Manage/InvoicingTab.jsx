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
import { buildInvoiceBody, getInvoiceSummaryContext } from '../../../lib/invoice.js';
import ActionMenu, { ActionMenuItem } from '../../components/ActionMenu.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';

const EMAIL_TEMPLATE_FIELDS = [
    { token: '%billing_year%', label: 'Billing Year' },
    { token: '%annual_total%', label: 'Household Total' },
    { token: '%payment_methods%', label: 'Payment Methods' }
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

function EmailTemplateSection({ settings, familyMembers, bills, payments, activeYear, readOnly, onSave }) {
    const [template, setTemplate] = useState(settings.emailMessage || '');
    const [dirty, setDirty] = useState(false);
    const textareaRef = useRef(null);

    // Sync if settings change externally
    useEffect(() => {
        if (!dirty) setTemplate(settings.emailMessage || '');
    }, [settings.emailMessage]);

    function handleChange(e) {
        setTemplate(e.target.value);
        setDirty(true);
    }

    function insertToken(token) {
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newVal = template.substring(0, start) + token + template.substring(end);
        setTemplate(newVal);
        setDirty(true);
        // Restore cursor after token
        setTimeout(() => {
            ta.focus();
            ta.selectionStart = ta.selectionEnd = start + token.length;
        }, 0);
    }

    function handleSave() {
        onSave(template);
        setDirty(false);
    }

    // Build live preview
    let previewText = '';
    if (familyMembers.length > 0) {
        const sampleMemberId = familyMembers[0].id;
        const ctx = getInvoiceSummaryContext(familyMembers, bills, payments, sampleMemberId, activeYear, { ...settings, emailMessage: template });
        if (ctx) {
            previewText = buildInvoiceBody(ctx, 'text-only', '', 'email');
        }
    }

    const hasDuplicate = detectDuplicatePaymentText(template);

    return (
        <div className="invoicing-section">
            <h3>Email Template</h3>
            <p className="invoicing-hint">
                Customize the message included in email invoices. Use tokens to insert dynamic values.
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

            <textarea
                ref={textareaRef}
                className="composer-input template-editor-textarea"
                rows={5}
                value={template}
                onChange={handleChange}
                disabled={readOnly}
                placeholder="Enter your invoice message template..."
            />

            {hasDuplicate && (
                <p className="composer-error">
                    Warning: Your template contains both the %payment_methods% token and hardcoded payment text.
                    This may cause duplicate payment information in invoices.
                </p>
            )}

            {previewText && (
                <div className="template-preview">
                    <div className="template-preview-label">Preview</div>
                    <pre className="template-preview-body">{previewText}</pre>
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
