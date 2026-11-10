import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBillingYearStatusLabel } from '@/lib/formatting.js';
import { suggestNextYearLabel } from '@/lib/billing-year.js';
import { findSuccessorYear } from '@/lib/year-end-review.js';
import { useBillingData } from '../hooks/useBillingData.js';
import { useToast } from '../contexts/ToastContext.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

/** Statuses the Year-End Review may roll over from (specs/year-end-review.md § The page, guard). */
const REVIEWABLE = ['open', 'settling', 'closed'];

/**
 * BillingYearSelector — switch years, manage lifecycle transitions.
 * Port of renderBillingYearSelector() + confirm* functions from main.js.
 * All native confirm()/prompt()/alert() replaced with styled React dialogs.
 *
 * A new year is created only through the Year-End Review (#609, ADR 0009):
 * "Review & start <next year>" opens /year-end-review, which suggests and
 * checks the label on its last step. The old label dialog is retired. Once a
 * next year exists the button is disabled with the ADR 0007 pointer.
 */
export default function BillingYearSelector() {
    const { billingYears, activeYear, billingEvents, service } = useBillingData();
    const { showToast } = useToast();
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);

    // Confirm dialog state
    const [confirmState, setConfirmState] = useState(null);

    if (!activeYear) return null;

    const status = activeYear.status || 'open';
    const successor = findSuccessorYear(billingYears || [], activeYear, billingEvents || []);
    const nextLabel = successor ? successor.label : suggestNextYearLabel(activeYear);

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
            showToast('Error: ' + err.message, { kind: 'failure' });
        } finally {
            setBusy(false);
        }
    }

    function handleStatusChange(newStatus, message) {
        requestConfirm(message, () => service.setYearStatus(newStatus));
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

                {/* Year management: the Year-End Review is the only way a year is created. */}
                {REVIEWABLE.includes(status) && (
                    <button className="btn btn-ink btn-sm" disabled={busy || !!successor}
                        aria-describedby="year-review-hint"
                        onClick={() => navigate('/year-end-review')}>
                        Review &amp; start {nextLabel}
                    </button>
                )}
            </div>
            {REVIEWABLE.includes(status) && (
                <p className="year-selector-note" id="year-review-hint">
                    {successor
                        ? <><b>{successor.label} already exists.</b> Record new charges, credits and refunds in {successor.label}, the open year; a closed year is corrected forward.</>
                        : <>The review catches up mid-year price changes, adds subscriptions that started this year, folds in member charges and sets {nextLabel}’s prices before {nextLabel} is created. Nothing is saved until its last step.</>}
                </p>
            )}

            {/* Generic confirm dialog for status transitions */}
            <ConfirmDialog
                open={confirmState !== null}
                title="Confirm Action"
                message={confirmState ? confirmState.message : ''}
                confirmLabel="Confirm"
                onConfirm={executeConfirm}
                onCancel={() => setConfirmState(null)}
            />
        </div>
    );
}
