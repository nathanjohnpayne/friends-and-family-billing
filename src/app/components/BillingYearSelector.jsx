import { useState } from 'react';
import { getBillingYearStatusLabel } from '@/lib/formatting.js';
import { suggestNextYearLabel, isYearLabelDuplicate } from '@/lib/billing-year.js';
import { useBillingData } from '../hooks/useBillingData.js';

/**
 * BillingYearSelector — switch years, manage lifecycle transitions.
 * Port of renderBillingYearSelector() + confirm* functions from main.js.
 */
export default function BillingYearSelector() {
    const { billingYears, activeYear, service } = useBillingData();
    const [busy, setBusy] = useState(false);

    if (!activeYear) return null;

    const status = activeYear.status || 'open';

    function handleYearChange(e) {
        service.switchYear(e.target.value);
    }

    async function handleStatusChange(newStatus, message) {
        if (!window.confirm(message)) return;
        setBusy(true);
        try {
            await service.setYearStatus(newStatus);
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            setBusy(false);
        }
    }

    async function handleStartNewYear() {
        const defaultLabel = suggestNextYearLabel(activeYear);
        const label = window.prompt('Enter label for the new billing year:', defaultLabel);
        if (!label || !label.trim()) return;

        const yearId = label.trim();
        if (isYearLabelDuplicate(billingYears, yearId)) {
            alert('Billing year "' + yearId + '" already exists.');
            return;
        }

        setBusy(true);
        try {
            await service.createYear(yearId);
        } catch (err) {
            alert('Error: ' + err.message);
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
                {status === 'open' && (
                    <button className="btn btn-header-secondary btn-sm" disabled={busy}
                        onClick={() => handleStatusChange('settling',
                            'Start settlement for ' + activeYear.label + '?\n\nThis signals that invoices are going out and the year is moving toward collection.')}>
                        Start Settlement
                    </button>
                )}

                {status === 'settling' && (
                    <>
                        <button className="btn btn-header-secondary btn-sm" disabled={busy}
                            onClick={() => handleStatusChange('closed',
                                'Close billing year ' + activeYear.label + '?\n\nThis makes the year read-only. Any outstanding balances will be preserved.')}>
                            Close Year
                        </button>
                        <button className="btn btn-header-tertiary" disabled={busy}
                            onClick={() => handleStatusChange('open',
                                'Move ' + activeYear.label + ' back to Open?\n\nThis allows further edits to members, bills, and payments.')}>
                            Back to Open
                        </button>
                    </>
                )}

                {status === 'closed' && (
                    <>
                        <button className="btn btn-header-secondary btn-sm" disabled={busy}
                            onClick={() => handleStatusChange('archived',
                                'Archive billing year ' + activeYear.label + '?\n\nThis will make all records read-only.\nYou can still view historical data later.')}>
                            Archive Year
                        </button>
                        <button className="btn btn-header-tertiary" disabled={busy}
                            onClick={() => handleStatusChange('settling',
                                'Reopen ' + activeYear.label + ' to Settling?\n\nThis allows recording more payments.')}>
                            Reopen to Settling
                        </button>
                    </>
                )}

                {status !== 'archived' && (
                    <button className="btn btn-primary btn-sm" disabled={busy}
                        onClick={handleStartNewYear}>
                        Start New Year
                    </button>
                )}
            </div>
        </div>
    );
}
