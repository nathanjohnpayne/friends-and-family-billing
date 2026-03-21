import { getBillingYearStatusLabel } from '@/lib/formatting.js';
import { useBillingData } from '../hooks/useBillingData.js';

/**
 * BillingYearSelector — switch years, show lifecycle actions.
 * Port of renderBillingYearSelector() from main.js.
 */
export default function BillingYearSelector() {
    const { billingYears, activeYear, service } = useBillingData();

    if (!activeYear) return null;

    const status = activeYear.status || 'open';

    function handleYearChange(e) {
        service.switchYear(e.target.value);
    }

    return (
        <div className="year-selector">
            <div className="year-selector-head">
                <div className="year-selector-kicker">Billing Controls</div>
                <div className="year-selector-note">Switch years or move this one through settlement.</div>
            </div>

            <div className="year-select-wrap">
                <label htmlFor="year-select">Active Year</label>
                <select id="year-select" value={activeYear.id} onChange={handleYearChange}>
                    {billingYears.map(y => (
                        <option key={y.id} value={y.id}>
                            {y.label} ({getBillingYearStatusLabel(y.status)})
                        </option>
                    ))}
                </select>
            </div>

            <div className="year-actions">
                {status === 'open' && (
                    <StatusAction label="Start Settlement" variant="secondary" />
                )}
                {status === 'settling' && (
                    <>
                        <StatusAction label="Close Year" variant="secondary" />
                        <StatusAction label="Back to Open" variant="tertiary" />
                    </>
                )}
                {status === 'closed' && (
                    <>
                        <StatusAction label="Archive Year" variant="secondary" />
                        <StatusAction label="Reopen to Settling" variant="tertiary" />
                    </>
                )}
                {status !== 'archived' && (
                    <StatusAction label="Start New Year" variant="primary" />
                )}
            </div>
        </div>
    );
}

/**
 * StatusAction — placeholder button for year lifecycle actions.
 * Phase 3 wires these to real dialogs and service methods.
 */
function StatusAction({ label, variant }) {
    const className = 'btn btn-' + variant + (variant !== 'tertiary' ? ' btn-sm' : '');
    return (
        <button className={className} disabled title="Wired in Phase 3">
            {label}
        </button>
    );
}
