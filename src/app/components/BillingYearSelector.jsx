import { useState } from 'react';
import { getBillingYearStatusLabel } from '@/lib/formatting.js';
import { suggestNextYearLabel, isYearLabelDuplicate } from '@/lib/billing-year.js';
import { useBillingData } from '../hooks/useBillingData.js';
import { useToast } from '../contexts/ToastContext.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

/**
 * BillingYearSelector — switch years, manage lifecycle transitions.
 * Port of renderBillingYearSelector() + confirm* functions from main.js.
 * All native confirm()/prompt()/alert() replaced with styled React dialogs.
 */
export default function BillingYearSelector() {
    const { billingYears, activeYear, service } = useBillingData();
    const { showToast } = useToast();
    const [busy, setBusy] = useState(false);

    // Confirm dialog state
    const [confirmState, setConfirmState] = useState(null);

    // New year prompt state
    const [newYearOpen, setNewYearOpen] = useState(false);
    const [newYearLabel, setNewYearLabel] = useState('');
    const [newYearError, setNewYearError] = useState('');

    if (!activeYear) return null;

    const status = activeYear.status || 'open';

    function handleYearChange(e) {
        service.switchYear(e.target.value);
    }

    function requestConfirm(message, action) {
        setConfirmState({ message, action });
    }

    async function executeConfirm() {
        if (!confirmState) return;
        const { action } = confirmState;
        setConfirmState(null);
        setBusy(true);
        try {
            await action();
        } catch (err) {
            showToast('Error: ' + err.message);
        } finally {
            setBusy(false);
        }
    }

    function handleStatusChange(newStatus, message) {
        requestConfirm(message, () => service.setYearStatus(newStatus));
    }

    function handleStartNewYear() {
        setNewYearLabel(suggestNextYearLabel(activeYear));
        setNewYearError('');
        setNewYearOpen(true);
    }

    async function executeNewYear() {
        const yearId = newYearLabel.trim();
        if (!yearId) {
            setNewYearError('Label is required.');
            return;
        }
        if (isYearLabelDuplicate(billingYears, yearId)) {
            setNewYearError('Billing year "' + yearId + '" already exists.');
            return;
        }
        setNewYearOpen(false);
        setBusy(true);
        try {
            await service.createYear(yearId);
        } catch (err) {
            showToast('Error: ' + err.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="year-selector">
            <div className="year-selector-head">
                <div className="year-selector-kicker">Billing Controls</div>
                <div className="year-selector-note">Switch years or move this one through settlement.</div>
            </div>

            <div className="year-select-wrap">
                <label htmlFor="year-select">Active Year</label>
                <select id="year-select" value={activeYear.id} onChange={handleYearChange} disabled={busy}>
                    {billingYears.map(y => (
                        <option key={y.id} value={y.id}>
                            {y.label} ({getBillingYearStatusLabel(y.status)})
                        </option>
                    ))}
                </select>
            </div>

            <div className="year-actions">
                {/* Backward transitions — visually demoted (text-only style) */}
                {status === 'settling' && (
                    <button className="btn btn-header-tertiary btn-sm" disabled={busy}
                        onClick={() => handleStatusChange('open',
                            'Move ' + activeYear.label + ' back to Open?\n\nThis allows further edits to members, bills, and payments.')}>
                        Back to Open
                    </button>
                )}

                {status === 'closed' && (
                    <button className="btn btn-header-tertiary btn-sm" disabled={busy}
                        onClick={() => handleStatusChange('settling',
                            'Reopen ' + activeYear.label + ' to Settling?\n\nThis allows recording more payments.')}>
                        Reopen to Settling
                    </button>
                )}

                {/* Year management */}
                {status !== 'archived' && (
                    <button className="btn btn-primary btn-sm" disabled={busy}
                        onClick={handleStartNewYear}>
                        Start New Year
                    </button>
                )}
            </div>

            {/* Generic confirm dialog for status transitions */}
            <ConfirmDialog
                open={confirmState !== null}
                title="Confirm Action"
                message={confirmState ? confirmState.message : ''}
                confirmLabel="Confirm"
                onConfirm={executeConfirm}
                onCancel={() => setConfirmState(null)}
            />

            {/* New year label prompt */}
            {newYearOpen && (
                <div className="dialog-overlay" onClick={() => setNewYearOpen(false)}>
                    <div className="dialog" onClick={e => e.stopPropagation()}>
                        <div className="dialog-title">Start New Billing Year</div>
                        <div className="payment-dialog-fields">
                            <div className="payment-field-group">
                                <label htmlFor="new-year-label">Billing year label</label>
                                <input
                                    id="new-year-label"
                                    className="composer-input"
                                    value={newYearLabel}
                                    onChange={e => { setNewYearLabel(e.target.value); setNewYearError(''); }}
                                    onKeyDown={e => { if (e.key === 'Enter') executeNewYear(); }}
                                    autoFocus
                                />
                            </div>
                        </div>
                        {newYearError && <p className="composer-error">{newYearError}</p>}
                        <div className="dialog-buttons">
                            <button className="btn btn-sm btn-header-secondary" onClick={() => setNewYearOpen(false)}>Cancel</button>
                            <button className="btn btn-sm btn-primary" onClick={executeNewYear}>Create Year</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
