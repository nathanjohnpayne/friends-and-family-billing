import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useDisputes } from '../../hooks/useDisputes.js';
import { useRefundNotices } from '../../hooks/useRefundNotices.js';
import { issueRefundNotice } from '@/lib/RefundNoticeService.js';
import { reopenedCreditAdjustmentIds } from '@/lib/refundNotice.js';
import { calculateSettlementMetrics, getHouseholdDeferredCharges, isLinkedToAnyone } from '@/lib/calculations.js';
import { formatAnnualSummaryCurrency } from '@/lib/formatting.js';
import { isYearReadOnly } from '@/lib/validation.js';
import { BILLING_YEAR_STATUSES } from '@/lib/constants.js';
import SettlementBoard from '../../components/SettlementBoard.jsx';
import PaymentHistoryDialog from '../../components/PaymentHistoryDialog.jsx';
import EmailInvoiceDialog from '../../components/EmailInvoiceDialog.jsx';
import TextInvoiceDialog from '../../components/TextInvoiceDialog.jsx';
import ShareLinkDialog from '../../components/ShareLinkDialog.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import UsageChargeDialog from '../../components/UsageChargeDialog.jsx';
import ChargeNoticeDialog from '../../components/ChargeNoticeDialog.jsx';
import { issueChargeNotice } from '@/lib/ChargeNoticeService.js';

/**
 * DashboardView — hero status panel + KPIs.
 * Port of renderDashboardStatus() from main.js.
 */
export default function DashboardView() {
    const { activeYear, familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], loading, service } = useBillingData();
    const { user } = useAuth();
    const { showToast } = useToast();

    const navigate = useNavigate();
    const { disputes } = useDisputes();
    const { refundNotices } = useRefundNotices();
    const openDisputeCount = disputes.filter(d => d.status === 'open' || d.status === 'in_review').length;

    // Dialog state — which dialog is open and for which member
    const [dialog, setDialog] = useState({ type: null, memberId: null });
    // Lifecycle action confirm dialog
    const [confirmAction, setConfirmAction] = useState(null);

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

    // ADR 0003: an active, unresolved not_received re-opens that household's
    // credit while the year is open (after close the year is corrected forward,
    // ADR 0007, so a read-only year passes an empty set and never reanimates).
    const yearReadOnly = isYearReadOnly(activeYear);
    const reopenedAdjustments = yearReadOnly ? null : reopenedCreditAdjustmentIds(refundNotices);

    // owedAdjustments threaded into the settlement metrics (reopen set 5th,
    // owedAdjustments 6th; calculateSettlementMetrics derives each household's opening
    // balance from the carry_opening seeds internally): BILLED usage charges (#320)
    // raise Outstanding and block close (ADR 0006), active Service Credits (#321) lower
    // owed, and a carried opening balance (#322) folds into owed and raises
    // totalCreditsOwed when it is a carried credit. The #319 reopened-credit set raises
    // totalCreditsOwed too. Deferred charges (#317) do not affect the gate.
    const metrics = calculateSettlementMetrics(familyMembers, bills, payments, creditAdjustments, reopenedAdjustments, owedAdjustments);

    // Deferred-charges indicator (#322): aggregate still-deferred Usage Charges
    // across households (ADR 0001 grain). These auto-carry into next year at
    // close/rollover (ADR 0006), so the dashboard surfaces them as a heads-up.
    const deferred = familyMembers
        .filter(m => !isLinkedToAnyone(familyMembers, m.id))
        .reduce((acc, m) => {
            const { count, total } = getHouseholdDeferredCharges(m, owedAdjustments);
            return { count: acc.count + count, total: acc.total + total };
        }, { count: 0, total: 0 });

    const yearLabel = activeYear.label || activeYear.id;
    const currentStatus = activeYear.status || 'open';
    const currentOrder = (BILLING_YEAR_STATUSES[currentStatus] || BILLING_YEAR_STATUSES.open).order;
    const remaining = metrics.totalMembers - metrics.paidCount;
    const isReadyToClose = currentStatus === 'settling' && remaining === 0 && metrics.totalMembers > 0;

    const statusHeadline = isReadyToClose
        ? 'Settlement complete'
        : currentStatus === 'open'
            ? (metrics.percentage === 100 ? 'Ready to start settlement' : 'Planning in progress')
        : currentStatus === 'settling' ? 'Settlement in progress'
        : currentStatus === 'closed' ? 'Year closed'
        : 'Archive view';

    // Forward lifecycle action (no backward transitions on dashboard)
    let lifecycleAction = null;
    if (currentStatus === 'open') {
        lifecycleAction = {
            label: 'Start Settlement',
            newStatus: 'settling',
            enabled: true,
            title: 'Start Settlement',
            message: 'Start settlement for ' + yearLabel + '?\n\nThis signals that invoices are going out and the year is moving toward collection.'
        };
    } else if (currentStatus === 'settling') {
        lifecycleAction = {
            label: 'Close Year',
            newStatus: 'closed',
            enabled: isReadyToClose,
            hint: isReadyToClose
                ? 'All members settled\u2014ready to close'
                : remaining + ' member' + (remaining === 1 ? '' : 's') + ' still outstanding',
            title: 'Close Year',
            message: 'Close billing year ' + yearLabel + '?\n\nThis makes the year read-only. Any outstanding balances will be preserved.'
        };
    } else if (currentStatus === 'closed') {
        lifecycleAction = {
            label: 'Archive Year',
            newStatus: 'archived',
            enabled: true,
            title: 'Archive Year',
            message: 'Archive billing year ' + yearLabel + '?\n\nThis will make all records read-only. You can still view historical data later.'
        };
    }

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
                </div>

                <LifecycleBar currentStatus={currentStatus} currentOrder={currentOrder} isReadyToClose={isReadyToClose} />

                {lifecycleAction && (
                    <div className="dashboard-action">
                        <button
                            className="btn btn-primary btn-sm"
                            disabled={!lifecycleAction.enabled}
                            onClick={lifecycleAction.enabled ? () => setConfirmAction(lifecycleAction) : undefined}
                        >
                            {lifecycleAction.label}
                        </button>
                        {lifecycleAction.hint && (
                            <span className="dashboard-action-hint">{lifecycleAction.hint}</span>
                        )}
                    </div>
                )}

                <div className="kpi-grid">
                    <KpiCard label="Outstanding" value={metrics.totalOutstanding > 0 ? '$' + metrics.totalOutstanding.toFixed(2) : 'Paid'}
                        valueClass={metrics.totalOutstanding > 0 ? 'outstanding' : 'settled-zero'} />
                    <KpiCard label="Owed to Members" value={metrics.totalCreditsOwed > 0 ? '$' + metrics.totalCreditsOwed.toFixed(2) : 'None'}
                        valueClass={metrics.totalCreditsOwed > 0 ? 'credit' : 'settled-zero'}
                        subtitle="Unresolved credits" />
                    <KpiCard label="Settled" value={metrics.paidCount + ' / ' + metrics.totalMembers} />
                    <KpiCard
                        label="Open Reviews"
                        value={String(openDisputeCount)}
                        subtitle="Review requests"
                        onClick={openDisputeCount > 0 ? () => navigate('/manage/reviews') : undefined}
                    />
                </div>

                {deferred.count > 0 && (
                    <div className="admin-hint" data-testid="deferred-charges-indicator">
                        Deferred charges: {formatAnnualSummaryCurrency(deferred.total)}{' '}
                        ({deferred.count} {deferred.count === 1 ? 'charge' : 'charges'}) not yet billed—these carry forward to next year.
                    </div>
                )}

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

            <SettlementBoard
                familyMembers={familyMembers}
                bills={bills}
                payments={payments}
                creditAdjustments={creditAdjustments}
                reopenedAdjustmentIds={reopenedAdjustments}
                owedAdjustments={owedAdjustments}
                readOnly={yearReadOnly}
                onRecordPayment={data => service.recordPayment(data)}
                onAddCharge={memberId => setDialog({ type: 'addCharge', memberId })}
                onBillCharges={memberId => setDialog({ type: 'billCharges', memberId })}
                onIssueRefund={data => {
                    // Let errors propagate so the board's dialog shows the inline
                    // error and stays open (mirrors onRecordPayment). The success
                    // toast runs only when issueRefund did not throw.
                    // issueRefund records the authoritative creditAdjustment (#318);
                    // the Refund Notice + member email are a non-blocking follow-up (#319)
                    // keyed to that creditAdjustment id.
                    const entry = service.issueRefund(data);
                    showToast('Refund recorded');
                    const member = familyMembers.find(m => m.id === data.memberId);
                    issueRefundNotice({
                        userId: user ? user.uid : '',
                        memberId: data.memberId,
                        memberName: member ? member.name : '',
                        memberEmail: member ? member.email : '',
                        billingYearId: activeYear.id,
                        yearLabel,
                        amount: entry.amount,
                        method: entry.method,
                        reason: entry.reason,
                        creditAdjustmentId: entry.id,
                        familyMembers,
                        bills,
                        payments,
                        activeYear,
                        settings: service.getState().settings || {},
                    }).catch(err => console.error('Refund notice send failed:', err));
                }}
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
                        creditAdjustments={creditAdjustments}
                        owedAdjustments={owedAdjustments}
                        reopenedAdjustmentIds={reopenedAdjustments}
                        readOnly={isYearReadOnly(activeYear)}
                        onReverse={paymentId => {
                            service.reversePayment(paymentId);
                            showToast('Payment reversed');
                        }}
                        onEditPayment={(paymentId, fields) => {
                            service.updatePayment(paymentId, fields);
                            showToast('Payment updated');
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
                    owedAdjustments={owedAdjustments}
                    activeYear={activeYear}
                    settings={service.getState().settings || {}}
                    userId={user ? user.uid : ''}
                    billingYearId={activeYear.id}
                    showToast={showToast}
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
                    owedAdjustments={owedAdjustments}
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
                        owedAdjustments={owedAdjustments}
                        activeYear={activeYear}
                        settings={service.getState().settings || {}}
                        showToast={showToast}
                        onClose={() => setDialog({ type: null, memberId: null })}
                        onLinkGenerated={url => service.updateSettings({ invoiceShareUrl: url })}
                    />
                );
            })()}

            {dialog.type === 'addCharge' && (() => {
                const member = familyMembers.find(m => m.id === dialog.memberId);
                return (
                    <UsageChargeDialog
                        open
                        memberName={member ? member.name : ''}
                        onSubmit={data => {
                            // Let errors propagate so the dialog shows the inline error and
                            // stays open; the success toast runs only when the record succeeded.
                            service.recordUsageCharge({ memberId: dialog.memberId, ...data });
                            showToast('Usage charge recorded—pending, not yet billed.');
                        }}
                        onClose={() => setDialog({ type: null, memberId: null })}
                    />
                );
            })()}

            {dialog.type === 'billCharges' && (() => {
                const member = familyMembers.find(m => m.id === dialog.memberId);
                // Household-grain candidates (ADR 0001): the primary's + linked members'
                // own deferred charges, surfaced for the off-cycle billing preview.
                const householdIds = member ? [member.id, ...(member.linkedMembers || [])] : [];
                const candidates = owedAdjustments.filter(a =>
                    a && a.kind === 'usage_charge' && a.status === 'deferred' && householdIds.includes(a.memberId)
                );
                return (
                    <ChargeNoticeDialog
                        open
                        memberName={member ? member.name : ''}
                        charges={candidates}
                        onConfirm={chargeIds => {
                            // Bill the selected charges (deferred → billed; raises owed), then
                            // issue the outbound Charge Notice (email + share link).
                            const result = service.billDeferredCharges({ memberId: dialog.memberId, chargeIds });
                            // Read the POST-mutation state: billDeferredCharges just flipped the
                            // selected charges deferred→billed, so the stale `owedAdjustments` prop
                            // would still mark them deferred and the minted share link would show
                            // the just-billed charges as pending/not-yet-due.
                            const freshState = service.getState();
                            // Defer the success toast until the notice actually issues, and surface
                            // a failure to the admin rather than only console.error-ing it
                            // (PR #328 review r3447513511).
                            Promise.resolve(
                                issueChargeNotice({
                                    userId: user ? user.uid : '',
                                    billingYearId: activeYear.id,
                                    yearLabel,
                                    memberId: dialog.memberId,
                                    memberName: member ? member.name : '',
                                    memberEmail: member ? member.email : '',
                                    chargeNoticeId: result.chargeNoticeId,
                                    charges: result.charges,
                                    familyMembers,
                                    bills,
                                    payments,
                                    owedAdjustments: freshState.owedAdjustments || [],
                                    activeYear,
                                    settings: freshState.settings || {},
                                })
                            )
                                .then(() => showToast('Charges billed—Charge Notice sent.'))
                                .catch(err => {
                                    console.error('issueChargeNotice failed:', err);
                                    showToast('Charges billed, but the Charge Notice could not be sent: ' + err.message);
                                });
                        }}
                        onClose={() => setDialog({ type: null, memberId: null })}
                    />
                );
            })()}

            <ConfirmDialog
                open={confirmAction !== null}
                title={confirmAction ? confirmAction.title : ''}
                message={confirmAction ? confirmAction.message : ''}
                confirmLabel={confirmAction ? confirmAction.label : 'Confirm'}
                onConfirm={async () => {
                    const { newStatus } = confirmAction;
                    setConfirmAction(null);
                    try {
                        await service.setYearStatus(newStatus);
                        showToast(BILLING_YEAR_STATUSES[newStatus].label + '\u2014status updated.');
                    } catch (err) {
                        showToast('Error: ' + err.message);
                    }
                }}
                onCancel={() => setConfirmAction(null)}
            />
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
                        <span className={cls}>{isComplete && '\u2713 '}{meta.label}</span>
                    </span>
                );
            })}
        </div>
    );
}

/** Single KPI metric card. */
function KpiCard({ label, value, valueClass = '', subtitle = '', title = '', onClick }) {
    return (
        <div
            className={'kpi-card' + (onClick ? ' kpi-card--clickable' : '')}
            title={title || undefined}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
        >
            <span className="kpi-label">{label}</span>
            <span className={'kpi-value' + (valueClass ? ' ' + valueClass : '')}>{value}</span>
            {subtitle && <span className="kpi-subtitle">{subtitle}</span>}
        </div>
    );
}
