import { useBillingData } from '../../hooks/useBillingData.js';
import { calculateSettlementMetrics } from '@/lib/calculations.js';
import { escapeHtml } from '@/lib/formatting.js';
import { BILLING_YEAR_STATUSES } from '@/lib/constants.js';

/**
 * DashboardView — hero status panel + KPIs.
 * Port of renderDashboardStatus() from main.js.
 * The settlement board (household cards) ships in Phase 2.
 */
export default function DashboardView() {
    const { activeYear, familyMembers, bills, payments, loading } = useBillingData();

    if (loading) {
        return <p style={{ color: '#666', textAlign: 'center', marginTop: '2rem' }}>Loading…</p>;
    }

    if (!activeYear) {
        return <p style={{ color: '#666', textAlign: 'center', marginTop: '2rem' }}>No billing year selected.</p>;
    }

    if (familyMembers.length === 0) {
        return (
            <div className="dashboard-hero">
                <p style={{ color: '#666', textAlign: 'center' }}>
                    Add members and bills to start building this billing year.
                </p>
            </div>
        );
    }

    const metrics = calculateSettlementMetrics(familyMembers, bills, payments);
    const yearLabel = activeYear.label || activeYear.id;
    const currentStatus = activeYear.status || 'open';
    const currentOrder = (BILLING_YEAR_STATUSES[currentStatus] || BILLING_YEAR_STATUSES.open).order;
    const remaining = metrics.totalMembers - metrics.paidCount;
    const isReadyToClose = currentStatus === 'settling' && remaining === 0 && metrics.totalMembers > 0;

    // Status label & headline
    const statusLabel = isReadyToClose
        ? 'Ready to Close'
        : (BILLING_YEAR_STATUSES[currentStatus] || BILLING_YEAR_STATUSES.open).label;

    const statusBadgeClass = 'dashboard-status-badge dashboard-status-badge--'
        + (isReadyToClose ? 'ready' : currentStatus);

    const statusHeadline = isReadyToClose
        ? 'Settlement complete'
        : currentStatus === 'open' ? 'Planning in progress'
        : currentStatus === 'settling' ? 'Settlement in progress'
        : currentStatus === 'closed' ? 'Year closed'
        : 'Archive view';

    // Settlement message
    let settlementMessage = '';
    if (currentStatus === 'archived') {
        settlementMessage = 'Archived year. Records are preserved for reference and cannot be modified.';
    } else if (currentStatus === 'closed') {
        settlementMessage = metrics.totalOutstanding > 0
            ? 'This billing year is closed and read-only with $' + metrics.totalOutstanding.toFixed(2) + ' still outstanding.'
            : 'All balances settled. ' + yearLabel + ' is complete and now read-only.';
    } else if (currentStatus === 'settling') {
        if (metrics.percentage === 0) {
            settlementMessage = 'Invoices are out. No payments have been recorded yet.';
        } else if (remaining > 0) {
            settlementMessage = metrics.paidCount + ' of ' + metrics.totalMembers + ' members are settled. ' + remaining + ' still need follow-up.';
        } else {
            settlementMessage = 'Everyone is settled for ' + yearLabel + '. Close the year when you are ready.';
        }
    } else if (metrics.totalAnnual > 0) {
        settlementMessage = 'Review totals, confirm assignments, and move this year into settling when you are ready to invoice.';
    } else {
        settlementMessage = 'Add members and bills to start building this billing year.';
    }

    return (
        <>
            <div className="dashboard-hero">
                <div className="dashboard-meta">
                    <span className="dashboard-year-pill">Billing Year {yearLabel}</span>
                    <span className={statusBadgeClass}>{statusLabel}</span>
                </div>

                <LifecycleBar currentStatus={currentStatus} currentOrder={currentOrder} isReadyToClose={isReadyToClose} />

                <div className="kpi-grid">
                    <KpiCard label="Outstanding" value={'$' + metrics.totalOutstanding.toFixed(2)}
                        valueClass={metrics.totalOutstanding > 0 ? 'outstanding' : 'all-clear'} />
                    <KpiCard label="Settled" value={metrics.paidCount + ' / ' + metrics.totalMembers} />
                    <KpiCard label="Open Reviews" value="—" title="Dispute data loads in Phase 2" />
                    <KpiCard label="Status" value={statusLabel} />
                </div>

                <div className="progress-block">
                    <div className="progress-header">
                        <span className="progress-title">{statusHeadline}</span>
                        <span className="progress-figure">{metrics.percentage}% settled</span>
                    </div>
                    <div className="progress-track">
                        <div className="progress-fill" style={{ width: metrics.percentage + '%' }} />
                    </div>
                    {settlementMessage && <p className="settlement-message">{settlementMessage}</p>}
                </div>

                {remaining > 0 && currentStatus === 'settling' && (
                    <div className="admin-hint">
                        {remaining} member{remaining === 1 ? '' : 's'} still outstanding. Send reminders via share links.
                    </div>
                )}
            </div>

            <div className="tab-placeholder">
                <h3>Settlement Board</h3>
                <p>Household cards with payment tracking arrive in Phase 2.</p>
            </div>
        </>
    );
}

/** Lifecycle progress bar — shows Open → Settling → Closed → Archived. */
function LifecycleBar({ currentStatus, currentOrder, isReadyToClose }) {
    const steps = ['open', 'settling', 'closed', 'archived'];

    return (
        <div className="lifecycle-bar">
            {steps.map((s, i) => {
                const meta = BILLING_YEAR_STATUSES[s];
                const isActive = s === currentStatus && !isReadyToClose;
                const isComplete = meta.order < currentOrder || (isReadyToClose && s === 'settling');
                const isNext = isReadyToClose && s === 'closed';

                let cls = 'lifecycle-step';
                if (isActive) cls += ' lifecycle-active lifecycle-' + meta.color;
                else if (isComplete) cls += ' lifecycle-complete';
                if (isNext) cls += ' lifecycle-next';

                return (
                    <span key={s}>
                        {i > 0 && <span className="lifecycle-arrow">{'\u2192'}</span>}
                        <span className={cls}>{meta.label}</span>
                    </span>
                );
            })}
        </div>
    );
}

/** Single KPI metric card. */
function KpiCard({ label, value, valueClass = '', title = '' }) {
    return (
        <div className="kpi-card" title={title || undefined}>
            <span className="kpi-label">{label}</span>
            <span className={'kpi-value' + (valueClass ? ' ' + valueClass : '')}>{value}</span>
        </div>
    );
}
