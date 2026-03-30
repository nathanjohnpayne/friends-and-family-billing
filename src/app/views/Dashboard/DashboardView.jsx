import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useDisputes } from '../../hooks/useDisputes.js';
import { calculateSettlementMetrics } from '@/lib/calculations.js';
import { isYearReadOnly } from '@/lib/validation.js';
import { BILLING_YEAR_STATUSES } from '@/lib/constants.js';
import SettlementBoard from '../../components/SettlementBoard.jsx';
import PaymentHistoryDialog from '../../components/PaymentHistoryDialog.jsx';
import EmailInvoiceDialog from '../../components/EmailInvoiceDialog.jsx';
import TextInvoiceDialog from '../../components/TextInvoiceDialog.jsx';
import ShareLinkDialog from '../../components/ShareLinkDialog.jsx';

/**
 * DashboardView — hero status panel + KPIs.
 * Port of renderDashboardStatus() from main.js.
 */
export default function DashboardView() {
    const { activeYear, familyMembers, bills, payments, loading, service } = useBillingData();
    const { user } = useAuth();
    const { showToast } = useToast();

    const navigate = useNavigate();
    const { disputes } = useDisputes();
    const openDisputeCount = disputes.filter(d => d.status === 'open' || d.status === 'in_review').length;

    // Dialog state — which dialog is open and for which member
    const [dialog, setDialog] = useState({ type: null, memberId: null });

    if (loading) return <div className="route-loading route-loading--panel"><div className="route-loading-card"><p className="route-loading-eyebrow">Settlement Workspace</p><p className="route-loading-message">Loading…</p></div></div>;

    if (!activeYear) {
        return (
            <section className="dashboard-hero dashboard-hero--empty">
                <p className="section-kicker section-kicker--inverse">Settlement Workspace</p>
                <h1>Dashboard</h1>
                <p className="dashboard-subtitle">No billing year selected.</p>
            </section>
        );
    }

    if (familyMembers.length === 0) {
        return (
            <section className="dashboard-hero dashboard-hero--empty">
                <p className="section-kicker section-kicker--inverse">Settlement Workspace</p>
                <h1>Dashboard</h1>
                <p className="dashboard-subtitle">
                    Add members and bills to start building this billing year.
                </p>
            </section>
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
            <section className="dashboard-hero">
                <div className="dashboard-hero-top">
                    <div className="dashboard-hero-copy">
                        <p className="section-kicker section-kicker--inverse">Settlement Workspace</p>
                        <h1>Dashboard</h1>
                        <p className="dashboard-subtitle">
                            Track balances, move the year through settlement, and close it cleanly without the usual back-and-forth.
                        </p>
                    </div>
                    <div className="dashboard-meta">
                        <span className="dashboard-year-pill">Billing Year {yearLabel}</span>
                        <span className={statusBadgeClass}>{statusLabel}</span>
                    </div>
                </div>

                <LifecycleBar currentStatus={currentStatus} currentOrder={currentOrder} isReadyToClose={isReadyToClose} />

                <div className="kpi-grid">
                    <KpiCard label="Outstanding" value={'$' + metrics.totalOutstanding.toFixed(2)}
                        valueClass={metrics.totalOutstanding > 0 ? 'outstanding' : 'all-clear'} />
                    <KpiCard label="Settled" value={metrics.paidCount + ' / ' + metrics.totalMembers} />
                    <KpiCard
                        label="Open Reviews"
                        value={String(openDisputeCount)}
                        onClick={openDisputeCount > 0 ? () => navigate('/manage/reviews') : undefined}
                    />
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
            </section>

            <section className="dashboard-workspace">
                <div className="dashboard-workspace-head">
                    <div>
                        <p className="section-kicker">Annual Invoicing</p>
                        <h2>Settlement Board</h2>
                        <p className="section-desc dashboard-workspace-desc">
                            Settle by household, send invoices, and expand rows for linked-member details and calculation transparency.
                        </p>
                    </div>
                </div>

                <SettlementBoard
                    familyMembers={familyMembers}
                    bills={bills}
                    payments={payments}
                    readOnly={isYearReadOnly(activeYear)}
                    onRecordPayment={data => service.recordPayment(data)}
                    onEmailInvoice={(memberId, isSettled) => {
                        if (isSettled) {
                            showToast('No balance due\u2014nothing to invoice.');
                            return;
                        }
                        setDialog({ type: 'emailInvoice', memberId });
                    }}
                    onTextInvoice={memberId => setDialog({ type: 'textInvoice', memberId })}
                    onGenerateShareLink={memberId => setDialog({ type: 'shareLink', memberId })}
                    onManageShareLinks={memberId => setDialog({ type: 'shareLink', memberId, tab: 'manage' })}
                    onViewHistory={memberId => setDialog({ type: 'history', memberId })}
                />
            </section>

            {dialog.type === 'history' && (() => {
                const member = familyMembers.find(m => m.id === dialog.memberId);
                return (
                    <PaymentHistoryDialog
                        open
                        memberId={dialog.memberId}
                        memberName={member ? member.name : ''}
                        familyMembers={familyMembers}
                        bills={bills}
                        payments={payments}
                        readOnly={isYearReadOnly(activeYear)}
                        onReverse={paymentId => {
                            service.reversePayment(paymentId);
                            showToast('Payment reversed');
                        }}
                        onClose={() => setDialog({ type: null, memberId: null })}
                    />
                );
            })()}

            {dialog.type === 'emailInvoice' && (
                <EmailInvoiceDialog
                    open
                    memberId={dialog.memberId}
                    familyMembers={familyMembers}
                    bills={bills}
                    payments={payments}
                    activeYear={activeYear}
                    settings={service.getState().settings || {}}
                    onClose={() => setDialog({ type: null, memberId: null })}
                />
            )}

            {dialog.type === 'textInvoice' && (
                <TextInvoiceDialog
                    open
                    memberId={dialog.memberId}
                    familyMembers={familyMembers}
                    bills={bills}
                    payments={payments}
                    activeYear={activeYear}
                    settings={service.getState().settings || {}}
                    userId={user ? user.uid : ''}
                    billingYearId={activeYear.id}
                    showToast={showToast}
                    onClose={() => setDialog({ type: null, memberId: null })}
                />
            )}

            {dialog.type === 'shareLink' && (() => {
                const member = familyMembers.find(m => m.id === dialog.memberId);
                return (
                    <ShareLinkDialog
                        open
                        memberId={dialog.memberId}
                        memberName={member ? member.name : ''}
                        userId={user ? user.uid : ''}
                        billingYearId={activeYear.id}
                        yearLabel={yearLabel}
                        initialTab={dialog.tab || 'generate'}
                        familyMembers={familyMembers}
                        bills={bills}
                        payments={payments}
                        activeYear={activeYear}
                        settings={service.getState().settings || {}}
                        showToast={showToast}
                        onClose={() => setDialog({ type: null, memberId: null })}
                    />
                );
            })()}
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
function KpiCard({ label, value, valueClass = '', title = '', onClick }) {
    function handleKeyDown(event) {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
        }
    }

    return (
        <div
            className={'kpi-card' + (onClick ? ' kpi-card--clickable' : '')}
            title={title || undefined}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={handleKeyDown}
        >
            <span className="kpi-label">{label}</span>
            <span className={'kpi-value' + (valueClass ? ' ' + valueClass : '')}>{value}</span>
        </div>
    );
}
