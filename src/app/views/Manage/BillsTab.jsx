/**
 * BillsTab — full CRUD for bills with member split toggles.
 * Port of renderBills() from main.js:1608.
 */
import { useState, useRef } from 'react';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { isYearReadOnly } from '../../../lib/validation.js';
import { getBillAnnualAmount, getBillMonthlyAmount } from '../../../lib/calculations.js';
import { getBillFrequencyLabel } from '../../../lib/formatting.js';
import EmptyState from '../../components/EmptyState.jsx';
import ActionMenu, { ActionMenuItem } from '../../components/ActionMenu.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import BillAuditHistoryDialog from '../../components/BillAuditHistoryDialog.jsx';
import CompanyLogo from '../../components/CompanyLogo.jsx';

export default function BillsTab() {
    const { bills, familyMembers, activeYear, loading, service, billingEvents } = useBillingData();
    const { showToast } = useToast();
    const readOnly = isYearReadOnly(activeYear);

    // Composer state
    const [composerOpen, setComposerOpen] = useState(false);
    const [billName, setBillName] = useState('');
    const [amount, setAmount] = useState('');
    const [frequency, setFrequency] = useState('monthly');
    const [website, setWebsite] = useState('');
    const [composerError, setComposerError] = useState('');

    // Inline edit state
    const [editingId, setEditingId] = useState(null);
    const [editField, setEditField] = useState(null);
    const [editValue, setEditValue] = useState('');

    // Split expand
    const [expandedSplits, setExpandedSplits] = useState(new Set());

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState(null);

    // Frequency conversion dialog
    const [freqTarget, setFreqTarget] = useState(null);

    // Website edit dialog
    const [websiteTarget, setWebsiteTarget] = useState(null);
    const [websiteValue, setWebsiteValue] = useState('');
    const [websiteError, setWebsiteError] = useState('');

    // Audit history dialog
    const [historyTarget, setHistoryTarget] = useState(null);

    if (loading) return <p style={{ color: '#666' }}>Loading…</p>;

    function handleAdd(e) {
        e.preventDefault();
        setComposerError('');
        try {
            const bill = service.addBill({ name: billName, amount: parseFloat(amount), billingFrequency: frequency, website });
            setBillName(''); setAmount(''); setFrequency('monthly'); setWebsite('');
            setComposerOpen(false);
            const freqLabel = frequency === 'annual' ? ' / year' : ' / month';
            showToast('Bill added: ' + bill.name + ' ($' + bill.amount.toFixed(2) + freqLabel + ')');
        } catch (err) {
            setComposerError(err.message);
        }
    }

    function startEdit(billId, field, currentValue) {
        setEditingId(billId);
        setEditField(field);
        setEditValue(String(currentValue || ''));
    }

    function saveEdit() {
        if (editingId === null) return;
        try {
            const value = editField === 'amount' ? parseFloat(editValue) : editValue;
            service.updateBill(editingId, { [editField]: value });
            showToast('Bill updated');
        } catch (err) {
            showToast(err.message);
        }
        setEditingId(null);
        setEditField(null);
    }

    function cancelEdit() {
        setEditingId(null);
        setEditField(null);
    }

    function handleEditKeyDown(e) {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') cancelEdit();
    }

    function toggleSplit(billId) {
        setExpandedSplits(prev => {
            const next = new Set(prev);
            if (next.has(billId)) next.delete(billId);
            else next.add(billId);
            return next;
        });
    }

    function handleToggleMember(billId, memberId) {
        service.toggleBillMember(billId, memberId);
    }

    function confirmDelete(bill) {
        setDeleteTarget(bill);
    }

    function executeDelete() {
        if (!deleteTarget) return;
        service.removeBill(deleteTarget.id);
        showToast('Bill removed: ' + deleteTarget.name);
        setDeleteTarget(null);
    }

    function openFrequencyConvert(bill) {
        setFreqTarget(bill);
    }

    function executeFrequencyConvert() {
        if (!freqTarget) return;
        const currentFreq = freqTarget.billingFrequency || 'monthly';
        const targetFreq = currentFreq === 'annual' ? 'monthly' : 'annual';
        const newAmount = currentFreq === 'annual'
            ? Math.round((freqTarget.amount / 12) * 100) / 100
            : Math.round((freqTarget.amount * 12) * 100) / 100;
        try {
            service.updateBill(freqTarget.id, { billingFrequency: targetFreq, amount: newAmount });
            showToast('Bill updated: ' + freqTarget.name + ' now $' + newAmount.toFixed(2) + (targetFreq === 'annual' ? ' / year' : ' / month'));
        } catch (err) {
            showToast(err.message);
        }
        setFreqTarget(null);
    }

    function openWebsiteEdit(bill) {
        setWebsiteTarget(bill);
        setWebsiteValue(bill.website || '');
        setWebsiteError('');
    }

    function saveWebsite() {
        if (!websiteTarget) return;
        const trimmed = websiteValue.trim();
        if (trimmed && !/^https?:\/\//i.test(trimmed)) {
            setWebsiteError('URL must start with http:// or https://');
            return;
        }
        try {
            service.updateBill(websiteTarget.id, { website: trimmed });
            showToast('Website updated for ' + websiteTarget.name);
        } catch (err) {
            setWebsiteError(err.message);
        }
        setWebsiteTarget(null);
        setWebsiteValue('');
        setWebsiteError('');
    }

    return (
        <div className="bills-tab">
            <div className="tab-header">
                <h3>Bills ({bills.length})</h3>
                {!readOnly && (
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setComposerOpen(!composerOpen)}
                    >
                        {composerOpen ? '− Cancel' : '+ Add Bill'}
                    </button>
                )}
            </div>

            {composerOpen && !readOnly && (
                <form className="composer-card" onSubmit={handleAdd}>
                    <div className="composer-fields">
                        <input
                            className="composer-input"
                            placeholder="Bill name *"
                            value={billName}
                            onChange={e => setBillName(e.target.value)}
                            autoFocus
                        />
                        <input
                            className="composer-input"
                            placeholder="Amount *"
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                        />
                        <div className="frequency-toggle">
                            <button
                                type="button"
                                className={'frequency-option' + (frequency === 'monthly' ? ' active' : '')}
                                onClick={() => setFrequency('monthly')}
                            >Monthly</button>
                            <button
                                type="button"
                                className={'frequency-option' + (frequency === 'annual' ? ' active' : '')}
                                onClick={() => setFrequency('annual')}
                            >Annual</button>
                        </div>
                        <input
                            className="composer-input"
                            placeholder="Website (optional)"
                            value={website}
                            onChange={e => setWebsite(e.target.value)}
                        />
                    </div>
                    {composerError && <p className="composer-error">{composerError}</p>}
                    <button type="submit" className="btn btn-sm btn-primary">Add Bill</button>
                </form>
            )}

            {bills.length === 0 ? (
                <EmptyState
                    title="No bills yet"
                    message="Add bills and assign family members to split costs."
                />
            ) : (
                <div className="bill-list">
                    {bills.map(bill => (
                        <BillCard
                            key={bill.id}
                            bill={bill}
                            familyMembers={familyMembers}
                            readOnly={readOnly}
                            editingId={editingId}
                            editField={editField}
                            editValue={editValue}
                            setEditValue={setEditValue}
                            onStartEdit={startEdit}
                            onSaveEdit={saveEdit}
                            onCancelEdit={cancelEdit}
                            onEditKeyDown={handleEditKeyDown}
                            splitExpanded={expandedSplits.has(bill.id)}
                            onToggleSplit={() => toggleSplit(bill.id)}
                            onToggleMember={handleToggleMember}
                            onDelete={confirmDelete}
                            onConvertFrequency={openFrequencyConvert}
                            onEditWebsite={openWebsiteEdit}
                            onViewHistory={setHistoryTarget}
                            onUploadLogo={(billId, base64) => {
                                service.updateBill(billId, { logo: base64 });
                                showToast('Logo updated');
                            }}
                            onRemoveLogo={billId => {
                                service.updateBill(billId, { logo: '' });
                                showToast('Logo removed');
                            }}
                        />
                    ))}
                </div>
            )}

            <ConfirmDialog
                open={deleteTarget !== null}
                title="Remove Bill"
                message={deleteTarget ? 'Remove ' + deleteTarget.name + '?' : ''}
                confirmLabel="Remove"
                destructive
                onConfirm={executeDelete}
                onCancel={() => setDeleteTarget(null)}
            />

            {freqTarget && (() => {
                const currentFreq = freqTarget.billingFrequency || 'monthly';
                const targetFreq = currentFreq === 'annual' ? 'monthly' : 'annual';
                const newAmount = currentFreq === 'annual'
                    ? Math.round((freqTarget.amount / 12) * 100) / 100
                    : Math.round((freqTarget.amount * 12) * 100) / 100;
                return (
                    <ConfirmDialog
                        open={true}
                        title="Convert Billing Frequency"
                        message={
                            'Convert ' + freqTarget.name + ' from ' + currentFreq + ' to ' + targetFreq + ' billing. '
                            + 'The stored amount will change from $' + freqTarget.amount.toFixed(2) + ' to $' + newAmount.toFixed(2) + '. '
                            + 'All totals will be recalculated.'
                        }
                        confirmLabel={'Convert to ' + targetFreq}
                        onConfirm={executeFrequencyConvert}
                        onCancel={() => setFreqTarget(null)}
                    />
                );
            })()}

            {websiteTarget && (
                <div className="dialog-overlay" onClick={() => { setWebsiteTarget(null); setWebsiteError(''); }}>
                    <div className="dialog" onClick={e => e.stopPropagation()}>
                        <div className="dialog-title">Edit Website for {websiteTarget.name}</div>
                        <div className="payment-dialog-fields">
                            <div className="payment-field-group">
                                <label htmlFor={'website-edit-' + websiteTarget.id}>Website URL</label>
                                <input
                                    id={'website-edit-' + websiteTarget.id}
                                    className="composer-input"
                                    type="url"
                                    placeholder="https://example.com"
                                    value={websiteValue}
                                    onChange={e => setWebsiteValue(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        {websiteError && <p className="composer-error">{websiteError}</p>}
                        <div className="dialog-buttons">
                            <button className="btn btn-sm btn-header-secondary" onClick={() => { setWebsiteTarget(null); setWebsiteError(''); }}>Cancel</button>
                            <button className="btn btn-sm btn-primary" onClick={saveWebsite}>Save Website</button>
                        </div>
                    </div>
                </div>
            )}

            {historyTarget && (
                <BillAuditHistoryDialog
                    open
                    billId={historyTarget.id}
                    billName={historyTarget.name}
                    billingEvents={billingEvents || []}
                    onClose={() => setHistoryTarget(null)}
                />
            )}
        </div>
    );
}

function BillCard({
    bill, familyMembers, readOnly,
    editingId, editField, editValue, setEditValue,
    onStartEdit, onSaveEdit, onCancelEdit, onEditKeyDown,
    splitExpanded, onToggleSplit, onToggleMember,
    onDelete, onConvertFrequency, onEditWebsite, onViewHistory,
    onUploadLogo, onRemoveLogo
}) {
    const logoInputRef = useRef(null);
    const annualAmount = getBillAnnualAmount(bill);
    const isAnnual = bill.billingFrequency === 'annual';
    const freqLabel = getBillFrequencyLabel(bill);
    const memberCount = bill.members.length;

    const perPersonDisplay = memberCount > 0
        ? (isAnnual
            ? '$' + (annualAmount / memberCount).toFixed(2) + ' per person annually'
            : '$' + (annualAmount / memberCount / 12).toFixed(2) + ' per person monthly')
        : 'No members assigned yet';

    const cadenceSummary = isAnnual
        ? 'Billed annually · Monthly equivalent ≈ $' + getBillMonthlyAmount(bill).toFixed(2)
        : 'Billed monthly · Annualized ≈ $' + annualAmount.toFixed(2);

    const splitSummary = memberCount > 0
        ? memberCount + ' member' + (memberCount !== 1 ? 's' : '') + ' · ' + perPersonDisplay
        : perPersonDisplay;


    function renderEditableField(field, value, className) {
        if (editingId === bill.id && editField === field) {
            return (
                <input
                    className="inline-edit-input"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={onSaveEdit}
                    onKeyDown={onEditKeyDown}
                    type={field === 'amount' ? 'number' : 'text'}
                    step={field === 'amount' ? '0.01' : undefined}
                    autoFocus
                />
            );
        }
        if (readOnly) return <span className={className}>{value}</span>;
        return (
            <span
                className={className + ' editable'}
                onClick={() => onStartEdit(bill.id, field, field === 'amount' ? bill.amount : value)}
                title={'Click to edit ' + field}
            >
                {value}
            </span>
        );
    }

    function handleLogoUpload(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            // Compress and rasterize (handles SVG→PNG conversion too)
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const maxSize = 200;
                let w = img.width, h = img.height;
                if (w > h) { if (w > maxSize) { h *= maxSize / w; w = maxSize; } }
                else { if (h > maxSize) { w *= maxSize / h; h = maxSize; } }
                canvas.width = w;
                canvas.height = h;
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                if (onUploadLogo) onUploadLogo(bill.id, canvas.toDataURL('image/png'));
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }

    return (
        <div className="bill-card">
            <div className="bill-header-main">
                <div className="bill-header">
                    <div className="bill-header-left">
                        <CompanyLogo logo={bill.logo} website={bill.website} name={bill.name} size={48} />
                        {renderEditableField('name', bill.name, 'bill-title')}
                    </div>
                    <div className="bill-header-right">
                        {renderEditableField('amount', '$' + bill.amount.toFixed(2) + freqLabel, 'bill-amount')}
                        <div className="bill-derived-amount">{cadenceSummary}</div>
                    </div>
                </div>
            </div>

            <div className="bill-split-section">
                {!splitExpanded ? (
                    <div className="bill-split-collapsed">
                        <span className="split-summary-text">{splitSummary}</span>
                        {!readOnly && (
                            <button className="btn-link" onClick={onToggleSplit}>Edit split</button>
                        )}
                    </div>
                ) : (
                    <div className="bill-split-expanded">
                        <div className="split-header-row">
                            <span className="split-header">Split with:</span>
                            <button className="btn-link" onClick={onToggleSplit}>Collapse</button>
                        </div>
                        <div className="member-checkboxes">
                            {familyMembers.map(member => (
                                <div key={member.id} className="checkbox-item">
                                    <input
                                        type="checkbox"
                                        id={'bill-' + bill.id + '-' + member.id}
                                        checked={bill.members.includes(member.id)}
                                        disabled={readOnly}
                                        onChange={() => onToggleMember(bill.id, member.id)}
                                    />
                                    <label htmlFor={'bill-' + bill.id + '-' + member.id}>{member.name}</label>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="bill-actions-row">
                <ActionMenu label={'Actions for ' + bill.name}>
                    <ActionMenuItem onClick={() => onViewHistory(bill)}>
                        View History
                    </ActionMenuItem>
                    {!readOnly && (
                        <ActionMenuItem onClick={() => onConvertFrequency(bill)}>
                            {isAnnual ? 'Convert to Monthly' : 'Convert to Annual'}
                        </ActionMenuItem>
                    )}
                    {!readOnly && (
                        <ActionMenuItem onClick={() => onEditWebsite(bill)}>
                            {bill.website ? 'Edit Website' : 'Add Website'}
                        </ActionMenuItem>
                    )}
                    {bill.website && /^https?:\/\//i.test(bill.website) && (
                        <ActionMenuItem onClick={() => window.open(bill.website, '_blank', 'noopener,noreferrer')}>
                            Open Website
                        </ActionMenuItem>
                    )}
                    {!readOnly && (
                        <ActionMenuItem onClick={() => logoInputRef.current && logoInputRef.current.click()}>
                            {bill.logo ? 'Replace Logo' : 'Upload Logo'}
                        </ActionMenuItem>
                    )}
                    {!readOnly && bill.logo && (
                        <ActionMenuItem onClick={() => onRemoveLogo && onRemoveLogo(bill.id)}>
                            Remove Logo
                        </ActionMenuItem>
                    )}
                    {!readOnly && (
                        <ActionMenuItem onClick={() => onDelete(bill)} danger>
                            Remove Bill
                        </ActionMenuItem>
                    )}
                </ActionMenu>
                <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    style={{ display: 'none' }}
                    onChange={handleLogoUpload}
                />
            </div>
        </div>
    );
}
