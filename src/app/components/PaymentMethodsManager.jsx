/**
 * PaymentMethodsManager — CRUD for payment methods (venmo, zelle, etc.).
 * Extracted from InvoicingTab to be reused on the Settings page.
 */
import { useState, useRef } from 'react';
import { PAYMENT_METHOD_TYPES, getPaymentMethodIcon, getPaymentMethodDetail } from '../../lib/formatting.js';
import { isValidE164 } from '../../lib/validation.js';
import ActionMenu, { ActionMenuItem } from './ActionMenu.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

export default function PaymentMethodsManager({ settings, readOnly, onUpdate }) {
    const methods = settings.paymentMethods || [];
    const [editTarget, setEditTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [newType, setNewType] = useState('venmo');

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
                Toggling a method Off hides it from invoices and share pages without removing it.
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

            {!readOnly && (() => {
                const configuredTypes = new Set(methods.map(m => m.type));
                const availableTypes = Object.entries(PAYMENT_METHOD_TYPES).filter(([key]) => !configuredTypes.has(key));
                const allConfigured = availableTypes.length === 0;
                return allConfigured ? (
                    <p className="payment-method-all-configured">All payment methods configured.</p>
                ) : (
                    <div className="payment-method-add">
                        <select
                            className="composer-input"
                            value={availableTypes.some(([key]) => key === newType) ? newType : availableTypes[0][0]}
                            onChange={e => setNewType(e.target.value)}
                        >
                            {availableTypes.map(([key, val]) => (
                                <option key={key} value={key}>{val.label}</option>
                            ))}
                        </select>
                        <button className="btn btn-sm btn-primary" onClick={() => {
                            const selectedType = availableTypes.some(([key]) => key === newType) ? newType : availableTypes[0][0];
                            const typeDef = PAYMENT_METHOD_TYPES[selectedType];
                            const method = {
                                id: 'pm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                                type: selectedType,
                                label: typeDef ? typeDef.label : selectedType,
                                enabled: true,
                                email: '', phone: '', handle: '', url: '', instructions: ''
                            };
                            onUpdate([...methods, method]);
                        }}>
                            Add Payment Method
                        </button>
                    </div>
                );
            })()}

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

        const label = (fields.label || '').trim();
        const defaultLabel = (PAYMENT_METHOD_TYPES[method.type] || PAYMENT_METHOD_TYPES.other).label;
        const validated = { ...fields, label: label || defaultLabel };

        const phone = (validated.phone || '').trim();
        if (phone && !isValidE164(phone)) {
            setError('Phone must be in E.164 format (e.g., +14155551212)');
            return;
        }
        validated.phone = phone;

        const url = (validated.url || '').trim();
        if (url && !/^https?:\/\//i.test(url)) {
            setError('URL must start with http:// or https://');
            return;
        }
        validated.url = url;

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
