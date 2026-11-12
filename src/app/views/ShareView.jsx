/**
 * ShareView — public billing summary page (no auth required).
 * Port of share.html inline JS (~700 lines) to React.
 * Reads share token from URL, resolves via publicShares or Cloud Function,
 * renders member summary, bill tables, payment progress, payment methods.
 */
import { useState, useEffect, useId } from 'react';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { hashToken } from '../../lib/validation.js';
import { isShareTokenStale } from '../../lib/share.js';
import { getPaymentMethodIcon, getPaymentMethodLabel, getInitials } from '../../lib/formatting.js';
import { exactNumber, multiplyExact, divideExact, sumExact, rational, quantizeDollarsToCents } from '../../lib/money.js';
import CompanyLogo from '../components/CompanyLogo.jsx';
import Dialog from '../components/Dialog.jsx';

const STATUS_LABELS = { open: 'Open', in_review: 'In Review', resolved: 'Resolved', rejected: 'Rejected' };

function formatCurrency(amount) {
    return '$' + Number(amount || 0).toFixed(2);
}

/**
 * Render the per-bill split as inline arithmetic (#351), e.g.
 * `$300.00/mo ÷ 8 members = $37.50/mo · ×12 = $450.00/yr`.
 *
 * Every figure is read straight from the canonical, annual-first fields the
 * builder already wrote (`calculateAnnualSummary`: annualShare = annualTotal /
 * members, then monthlyShare = annualShare / 12) — nothing is recomputed here,
 * so the line can never imply a monthly-first rounding the canonical path didn't
 * take. The `÷ members` and `×12` are read as bridges between figures that are
 * each already rounded to cents; on an uneven split the rounded monthly × 12 can
 * sit a cent off the canonical annual, which is expected and why the annual is
 * shown as its own canonical value rather than as the product.
 */
function formatSplitMath(b) {
    const memberWord = b.splitCount === 1 ? 'member' : 'members';
    return formatCurrency(b.monthlyAmount) + '/mo ÷ ' + b.splitCount + ' ' + memberWord
        + ' = ' + formatCurrency(b.monthlyShare) + '/mo · ×12 = ' + formatCurrency(b.annualShare) + '/yr';
}

/**
 * Derive the member's payment state from the share `paymentSummary` (#354/#355).
 * Shared by PaymentSummarySection and PaymentMethodsSection so the settled/owed
 * layout decisions stay in lockstep. Mirrors the original inline logic:
 * owed when a positive balance remains; settled when nothing remains and
 * something has been paid (an overpaid/zero balance with payments still reads
 * as settled).
 */
function derivePaymentState(ps) {
    const balanceRemaining = (ps && ps.balanceRemaining) || 0;
    const totalPaid = (ps && ps.totalPaid) || 0;
    const isOwed = balanceRemaining > 0;
    const isSettled = !isOwed && totalPaid > 0;
    return { isOwed, isSettled, balanceRemaining };
}

/** Inline check / alert icons for the lead callout (no icon-font dependency). */
function LeadCheckIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
        </svg>
    );
}
function LeadAlertIcon() {
    return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" /><path d="M12 17h.01" />
            <path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
        </svg>
    );
}

/**
 * State-driven lead callout (#354/#355) — the first thing the member sees, above
 * the bills. Settled: a green confirmation with the amount paid in full. Owed: a
 * red amount-due banner with how much remains and how much is paid. Neither state
 * (nothing paid, nothing owed) renders nothing.
 */
function ShareLeadCallout({ ps, year, carriedItems, billsSubtotal, serviceCreditTotal, notApplied, carriedToggle }) {
    // States the same terms as the reconciliation rows, in the same order, so the
    // sentence adds up to the Household Total: bills, Service Credits, carried,
    // the forfeited Service Credit excess that was not applied this year, and
    // the carried credit this year's bills did not use (it stays the household's money).
    const carryCopy = carriedItems && (
        <>{formatCurrency(billsSubtotal)} of bills
            {serviceCreditTotal > 0 && <> less {formatCurrency(serviceCreditTotal)} of service credits</>}
            {carriedItems.total < 0 ? ' less ' : ' plus '}
            <CarriedToggle {...carriedToggle}>{formatCurrency(Math.abs(carriedItems.total))} carried from {carriedItems.fromYear || 'previous year'}</CarriedToggle>
            {notApplied > 0 && <> plus {formatCurrency(notApplied)} not applied this year</>}
            {carriedItems.unusedCredit > 0 && <> plus {formatCurrency(carriedItems.unusedCredit)} of unused credit</>}
            {' · '}{ps.totalPaid > 0 ? formatCurrency(ps.totalPaid) + ' paid' : 'nothing paid yet'}</>
    );
    const { isOwed, isSettled } = derivePaymentState(ps);
    if (isSettled) {
        return (
            <div className="share-lead share-lead--settled">
                <span className="share-lead-icon"><LeadCheckIcon /></span>
                <div className="share-lead-text">
                    <div className="share-lead-title type-display">You&apos;re all settled for {year}</div>
                    <div className="share-lead-sub">{carryCopy || <>{formatCurrency(ps.totalPaid)} paid in full — nothing due</>}</div>
                </div>
            </div>
        );
    }
    if (isOwed) {
        return (
            <div className="share-lead share-lead--owed">
                <span className="share-lead-icon"><LeadAlertIcon /></span>
                <div className="share-lead-text">
                    <div className="share-lead-title type-display">{formatCurrency(ps.balanceRemaining)} due for {year}</div>
                    <div className="share-lead-sub">{carryCopy || <>{formatCurrency(ps.totalPaid)} of {formatCurrency(ps.combinedAnnualTotal)} paid</>}</div>
                </div>
            </div>
        );
    }
    return null;
}

/**
 * The per-bill split as styled inline arithmetic (#351): the source figure and
 * operators muted, the member's resulting /mo and /yr shares emphasized. Used in
 * the settled bill cards; the owed table renders the same figures via formatSplitMath.
 */
function BillMath({ b }) {
    const memberWord = b.splitCount === 1 ? 'member' : 'members';
    return (
        <span className="share-bill-math-expr">
            <span className="share-math-src">{formatCurrency(b.monthlyAmount)}/mo</span>
            <span className="share-math-op">÷ {b.splitCount} {memberWord}</span>
            <span className="share-math-eq">= {formatCurrency(b.monthlyShare)}/mo</span>
            <span className="share-math-op">× 12</span>
            <span className="share-math-eq">= {formatCurrency(b.annualShare)}/yr</span>
        </span>
    );
}

/**
 * Settled bill cards (mockup redesign) — each bill as a card with a "Paid" pill and
 * the inline split math, replacing the dense table when the household is settled.
 * The owed/unpaid view keeps the full itemized table (BillsTable).
 */
function BillsCards({ bills, canDispute, onRequestReview }) {
    if (!bills || bills.length === 0) return <p className="share-hint">No bills assigned.</p>;
    return (
        <div className="share-bill-cards">
            {bills.map((b, i) => (
                <div key={b.billId || i} className="share-bill-card">
                    <div className="share-bill-card-head">
                        <CompanyLogo logo={b.logo} website={b.website} name={b.name || 'Bill'} size={28} />
                        <strong className="share-bill-card-name">{b.name || 'Unnamed Bill'}</strong>
                        <span className="share-bill-paid-pill">Paid</span>
                    </div>
                    <div className="share-bill-card-math"><BillMath b={b} /></div>
                    {canDispute && (
                        <button type="button" className="share-review-btn" onClick={() => onRequestReview(b)}>Question this charge</button>
                    )}
                </div>
            ))}
        </div>
    );
}

export default function ShareView() {
    const [carriedExpanded, setCarriedExpanded] = useState(true);
    const carriedPanelId = useId();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [data, setData] = useState(null);
    const [timedOut, setTimedOut] = useState(false);
    const [canRequestLink, setCanRequestLink] = useState(false);
    const [errorTokenHash, setErrorTokenHash] = useState(null);
    const [linkRequested, setLinkRequested] = useState(false);
    const [shareCtx, setShareCtx] = useState({ token: null, tokenHash: null, ownerId: null, billingYearId: null, memberId: null, memberName: '', canDispute: false, canDisputeRead: false });

    useEffect(() => {
        loadShareData();
        const timer = setTimeout(() => setTimedOut(true), 12000);
        return () => clearTimeout(timer);
    }, []);

    async function loadShareData() {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        if (!token) {
            setError('No share token provided. Please check your link.');
            setLoading(false);
            return;
        }

        try {
            const tokenHash = await hashToken(token);
            let shareData = null;

            // Try publicShares first (eager cache), validating expiry from
            // the cached doc itself. publicShares carries expiresAt and revoked
            // fields mirrored from shareTokens, so we can check without reading
            // the owner-only shareTokens collection (which would fail for
            // unauthenticated visitors).
            const publicDoc = await getDoc(doc(db, 'publicShares', tokenHash));
            let cacheValid = false;
            if (publicDoc.exists()) {
                const cachedData = publicDoc.data();
                // Legacy publicShares docs created before the validity-field
                // migration won't have 'revoked' at all. Treat missing validity
                // fields as untrusted — fall through to the CF which checks
                // shareTokens via Admin SDK and self-heals the doc with the
                // mirrored fields for next time.
                const hasValidityFields = 'revoked' in cachedData;
                if (!hasValidityFields) {
                    cacheValid = false;
                } else if (isShareTokenStale(cachedData, new Date())) {
                    cacheValid = false;
                } else {
                    cacheValid = true;
                }
            }

            // Refund Notices (#319) carry mutable confirmation state and are NOT
            // stored in the publicShares cache (buildPublicShareData omits them, and
            // an issued refund's confirm link is minted before its notice doc even
            // exists). A refunds:read link must therefore always resolve live via the
            // Cloud Function, or a freshly emailed confirm link would hit the cache
            // and render no "Your Refunds" section. Only dedicated refund-confirm
            // links carry refunds:read, so this does not affect normal share links.
            if (cacheValid && publicDoc.exists() && (publicDoc.data().scopes || []).includes('refunds:read')) {
                cacheValid = false;
            }

            // Pre-itemization caches cannot reveal whether a carry is absent or
            // hidden by the owed floor. Resolve through the deployed projection
            // before rendering; a fresh timestamp alone cannot establish parity.
            // Uncarried summaries intentionally resolve once per visit until a
            // future shared schema version can distinguish those old cache shapes.
            if (cacheValid && (publicDoc.data().scopes || []).includes('summary:read') && !publicDoc.data().carriedItems) {
                cacheValid = false;
            }

            // A carried cache written before #688 has no unusedCredit, and its
            // remainingCredit ignores an unpaid billed Usage Charge, so it can state
            // more refundable credit than the household has. Resolve it through the
            // deployed projection instead of rendering it; the resolver rewrites it.
            if (cacheValid && publicDoc.data().carriedItems && publicDoc.data().carriedItems.unusedCredit === undefined) {
                cacheValid = false;
            }

            if (cacheValid) {
                shareData = publicDoc.data();
                // Bump access count
                updateDoc(doc(db, 'publicShares', tokenHash), {
                    accessCount: increment(1),
                    lastAccessedAt: new Date().toISOString()
                }).catch(() => {});

                // If cache is stale (>1 hour), refresh in background via Cloud Function
                // so next visit gets fresh data (e.g., preferred payment method changes).
                // Pass refreshOnly: true to avoid double-counting the access — the visit
                // was already counted by the publicShares increment above.
                const CACHE_MAX_AGE_MS = 60 * 60 * 1000;
                const updatedAt = shareData.updatedAt && shareData.updatedAt.toDate ? shareData.updatedAt.toDate() : null;
                if (!updatedAt || (Date.now() - updatedAt.getTime() > CACHE_MAX_AGE_MS)) {
                    fetch('/resolveShareToken', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token, refreshOnly: true })
                    }).catch(() => {});
                }
            } else {
                // Fall back to Cloud Function
                const resp = await fetch('/resolveShareToken', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                if (!resp.ok) {
                    const errData = await resp.json().catch(() => ({}));
                    setError(errData.error || 'This link is invalid or has been removed.');
                    if (errData.canRequestLink) {
                        setCanRequestLink(true);
                        setErrorTokenHash(errData.tokenHash || null);
                    }
                    setLoading(false);
                    return;
                }
                shareData = await resp.json();
            }

            const scopes = shareData.scopes || [];
            setShareCtx({
                token,
                tokenHash,
                ownerId: shareData.ownerId || null,
                billingYearId: shareData.billingYearId || null,
                memberId: shareData.memberId || (shareData.summary && shareData.summary.memberId) || null,
                memberName: shareData.memberName || '',
                canDispute: scopes.includes('disputes:create'),
                canDisputeRead: scopes.includes('disputes:read')
            });
            setData(shareData);
        } catch (err) {
            console.error('Share page error:', err);
            setError('Could not connect to the server. Please try again later.');
        }
        setLoading(false);
    }

    if (loading) {
        return (
            <div className="share-page share-loading">
                <div className="share-state-card">
                    <div className="share-spinner" />
                    <h2>Loading your annual billing summary...</h2>
                    <p>This secure page is preparing your latest billing details.</p>
                    {timedOut && (
                        <div className="share-timeout-hint">
                            <p>This is taking longer than expected.</p>
                            <button className="btn btn-sm btn-ink" onClick={() => window.location.reload()}>Retry</button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    async function handleRequestLink() {
        if (!errorTokenHash) return;
        try {
            const resp = await fetch('/requestShareLink', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenHash: errorTokenHash })
            });
            if (resp.ok) {
                setLinkRequested(true);
            } else {
                const errData = await resp.json().catch(() => ({}));
                if (resp.status === 429) {
                    setLinkRequested(true); // Already requested recently — show confirmation anyway
                } else {
                    console.error('Request link failed:', errData.error);
                }
            }
        } catch (err) {
            console.error('Request link error:', err);
        }
    }

    if (error) {
        return (
            <div className="share-page share-error">
                <div className="share-state-card">
                    <h2>Unable to Load Summary</h2>
                    <p>{error}</p>
                    {canRequestLink && !linkRequested && (
                        <button className="btn btn-sm btn-ink" onClick={handleRequestLink}>
                            Request New Link
                        </button>
                    )}
                    {linkRequested && (
                        <p className="share-hint">Your request has been sent. The account owner will send you a new link.</p>
                    )}
                </div>
            </div>
        );
    }

    if (!data) return null;

    const { isSettled } = derivePaymentState(data.paymentSummary);
    const hasItemizedCarry = data.carriedItems?.items.some(item => item.kind !== 'legacy');
    const carriedToggle = { expanded: carriedExpanded, panelId: hasItemizedCarry ? carriedPanelId : null, onToggle: () => setCarriedExpanded(value => !value) };
    const billsSubtotal = householdBillsSubtotal([data.summary, ...(data.linkedMembers || [])].filter(Boolean));
    const serviceCreditTotal = data.serviceCredits?.items?.length ? (data.serviceCredits.total || 0) : 0;

    return (
        <div className="share-page">
            <ShareHeader data={data} />
            {data.paymentSummary && <ShareLeadCallout ps={data.paymentSummary} year={data.year} carriedItems={data.carriedItems} billsSubtotal={billsSubtotal}
                serviceCreditTotal={serviceCreditTotal} notApplied={householdNotApplied(billsSubtotal, data.paymentSummary, serviceCreditTotal, data.carriedItems)} carriedToggle={carriedToggle} />}
            {data.summary && <HouseholdBillsSection data={data} canDispute={shareCtx.canDispute} shareCtx={shareCtx} isSettled={isSettled} billsSubtotal={billsSubtotal} carriedToggle={carriedToggle} />}
            {data.paymentSummary && <PaymentSummarySection ps={data.paymentSummary} />}
            {/* Pending Charges sit right after the bill/summary they relate to (mockup
                placement), not at the bottom of the page. */}
            {data.pendingCharges && data.pendingCharges.charges && data.pendingCharges.charges.length > 0 && (
                <PendingChargesSection pendingCharges={data.pendingCharges} />
            )}
            {data.paymentMethods && data.paymentMethods.length > 0 && <PaymentMethodsSection methods={data.paymentMethods} ownerId={shareCtx.ownerId} canDispute={shareCtx.canDispute} paymentSummary={data.paymentSummary} />}
            {data.paymentHistory && data.paymentHistory.payments && data.paymentHistory.payments.length > 0 && (
                <PaymentHistorySection history={data.paymentHistory} />
            )}
            {data.refundNotices && data.refundNotices.length > 0 && <RefundNoticesSection notices={data.refundNotices} shareCtx={shareCtx} />}
            {data.disputes && data.disputes.length > 0 && <DisputesSection disputes={data.disputes} shareCtx={shareCtx} />}
        </div>
    );
}

function deriveLastName(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : fullName;
}

function ShareHeader({ data }) {
    const lastName = deriveLastName(data.memberName);
    return (
        <header className="share-header">
            <h1 className="type-display">{lastName} Household&apos;s Annual Billing Summary</h1>
            <p className="share-subtitle">Your shared billing summary for {data.year}.</p>
        </header>
    );
}

function MemberRow({ member, canDispute, onRequestReview, defaultExpanded, isSettled }) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const billCount = member.bills ? member.bills.length : 0;
    const monthlyTotal = member.bills ? member.bills.reduce((s, b) => s + (b.monthlyShare || 0), 0) : 0;
    // Settled households get the calmer card layout; owed/unpaid keep the full
    // itemized table so the member sees the entire breakdown of what's owed.
    const BillsView = isSettled ? BillsCards : BillsTable;

    if (defaultExpanded) {
        return (
            <div className="share-member-row">
                <h3 className="share-member-name type-display">{member.name}</h3>
                <BillsView bills={member.bills} canDispute={canDispute} onRequestReview={onRequestReview} />
            </div>
        );
    }

    return (
        <div className="share-member-row">
            <button className="share-member-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
                <span className={'share-member-arrow' + (expanded ? ' expanded' : '')}>&#9654;</span>
                <span>{member.name}—{billCount} {billCount === 1 ? 'bill' : 'bills'} ({formatCurrency(monthlyTotal)}/mo)</span>
            </button>
            {expanded && (
                <BillsView bills={member.bills} canDispute={canDispute} onRequestReview={onRequestReview} />
            )}
        </div>
    );
}

// Reconstruct raw shares from the public bill slices with the exact-money
// primitives and quantize once, as projectHouseholdMoney quantizes G (ADR 0010),
// preserving rounded member display lines. Older cached slices fall back to
// their stored display totals.
function householdBillsSubtotal(members) {
    const finite = value => exactNumber(Number.isFinite(value) ? value : 0);
    const shares = members.flatMap(member => (
        member.bills?.every(bill => Number.isFinite(bill.canonicalAmount) && Number.isSafeInteger(bill.splitCount) && bill.splitCount > 0)
            ? member.bills.map(bill => divideExact(
                multiplyExact(exactNumber(bill.canonicalAmount), rational(bill.billingFrequency === 'annual' ? 1n : 12n)),
                rational(BigInt(bill.splitCount))))
            : [finite(member.annualTotal ?? member.bills?.reduce((total, bill) => total + (bill.annualShare || 0), 0))]
    ));
    return quantizeDollarsToCents(sumExact(shares)) / 100;
}

function signedCurrency(amount) {
    return (amount < 0 ? '−' : '+') + formatCurrency(Math.abs(amount));
}

function CarriedToggle({ expanded, panelId, onToggle, children, showState = false }) {
    if (!children) return null;
    if (!panelId) return <span>{children}</span>;
    return <button type="button" className="share-carried-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>{children}{showState && <> <span className="share-carried-toggle-state">{expanded ? 'Hide breakdown' : 'Show breakdown'}</span></>}</button>;
}

function CarriedItemsPanel({ carried, carriedToggle }) {
    const groups = new Map();
    const household = [];
    carried.items.forEach(item => {
        if (item.memberId == null || item.kind === 'credit' || item.kind === 'legacy') household.push(item);
        else {
            if (!groups.has(item.memberId)) groups.set(item.memberId, { name: item.memberName, items: [] });
            groups.get(item.memberId).items.push(item);
        }
    });
    const line = (item, index) => <div className="share-carried-line" key={index}><span>{item.description || item.billName}</span><span className="share-carried-amount">{signedCurrency(item.amount)}</span></div>;
    return (
        <section id={carriedToggle.panelId} hidden={!carriedToggle.expanded} className="share-carried-panel" aria-label={'Carried from ' + (carried.fromYear || 'previous year')}>
            <h2 className="share-carried-heading">Carried from {carried.fromYear || 'previous year'}</h2>
            <p className="share-hint">Changes during {carried.fromYear || 'the previous year'} that your invoice could not include. They are part of your total, listed by person; the household credit counts once.</p>
            <div className="share-carried-breakdown">
                {Array.from(groups, ([id, group]) => (
                    <div className="share-carried-group" key={id}>
                        <div className="share-carried-line share-carried-group-heading"><strong className="share-carried-member-heading"><span className="share-carried-initials" aria-hidden="true">{getInitials(group.name)}</span>{group.name}</strong><strong className="share-carried-amount">{signedCurrency(group.items.reduce((sum, item) => sum + item.amount, 0))}</strong></div>
                        {group.items.map(line)}
                    </div>
                ))}
                {household.map((item, index) => <div className={'share-carried-group' + (item.amount < 0 ? ' share-carried-credit' : '')} key={index}>
                    <div className="share-carried-line share-carried-group-heading"><strong className="share-carried-credit-heading">{item.kind === 'credit' && <svg className="share-carried-credit-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="9" /><path d="M7 12h10m-3-3 3 3-3 3" /></svg>}{item.description || item.billName}</strong><strong className="share-carried-amount">{signedCurrency(item.amount)}</strong></div>
                    {item.detail?.length > 0 && <div className="share-carried-detail">{item.detail.map((detail, i) => line({ ...detail, description: detail.description + (detail.memberName ? ' (' + detail.memberName + ')' : '') }, i))}</div>}
                </div>)}
                <div className="share-carried-line share-carried-total"><strong>Carried total</strong><strong className="share-carried-amount">{signedCurrency(carried.total)}</strong></div>
            </div>

        </section>
    );
}

/** The household's raw bills, credits, net carry and floor reconcile once. */
/** The "Not applied this year" floor remainder, shared by the rows and the lead callout. */
function householdNotApplied(billsSubtotal, ps, serviceCreditTotal, carriedItems) {
    const netAnnual = ps ? ps.combinedAnnualTotal : billsSubtotal;
    // The payload's notApplied is the whole floor remainder (what a page loaded before
    // #688 adds up); the unused carried-in credit has its own row here.
    if (carriedItems?.notApplied != null) return Math.max(0, Math.round((carriedItems.notApplied - (carriedItems.unusedCredit || 0)) * 100) / 100);
    return Math.max(0, Math.round((netAnnual - (billsSubtotal - (serviceCreditTotal || 0))) * 100) / 100);
}

function HouseholdTotalWithCredits({ billsSubtotal, ps, serviceCredits, carriedItems, carriedToggle }) {
    const netAnnual = ps ? ps.combinedAnnualTotal : billsSubtotal;
    const notApplied = householdNotApplied(billsSubtotal, ps, serviceCredits?.total, carriedItems);
    return (
        <div className="share-table-wrap share-credit-recon">
            <table className="share-table">
                <tbody>
                    <tr><td>Bills subtotal</td><td className="share-cell-number">{formatCurrency(billsSubtotal)}</td></tr>
                    {serviceCredits?.items.map((c, i) => (
                        <tr key={i} className="share-credit-row">
                            <td>Service credit{c.billName ? ' — ' + c.billName : ''}{c.reason ? ' (' + c.reason + ')' : ''}</td>
                            <td className="share-cell-number">{'-' + formatCurrency(c.amount)}</td>
                        </tr>
                    ))}
                    {carriedItems && <tr><td>Carried from {carriedItems.fromYear || 'previous year'}</td><td className="share-cell-number"><CarriedToggle {...carriedToggle} showState>{signedCurrency(carriedItems.total)}</CarriedToggle></td></tr>}
                    {notApplied > 0 && <tr><td>Not applied this year</td><td className="share-cell-number">{signedCurrency(notApplied)}</td></tr>}
                    {carriedItems?.unusedCredit > 0 && <tr><td>Unused {carriedItems.fromYear || 'previous year'} credit</td><td className="share-cell-number">{signedCurrency(carriedItems.unusedCredit)}</td></tr>}
                    <tr className="share-total-row"><td>Household Total</td><td className="share-cell-number"><strong>{formatCurrency(netAnnual)}</strong></td></tr>
                </tbody>
            </table>
        </div>
    );
}

function HouseholdBillsSection({ data, canDispute, shareCtx, isSettled, billsSubtotal, carriedToggle }) {
    const [disputeForm, setDisputeForm] = useState(null);
    const allMembers = [data.summary, ...(data.linkedMembers || [])];
    const isSingleMember = allMembers.length === 1;
    const ps = data.paymentSummary;
    const serviceCredits = data.serviceCredits;
    const hasCredits = serviceCredits && serviceCredits.items && serviceCredits.items.length > 0;

    return (
        <div className="share-section">
            {hasCredits || data.carriedItems
                ? <HouseholdTotalWithCredits billsSubtotal={billsSubtotal} ps={ps} serviceCredits={serviceCredits} carriedItems={data.carriedItems} carriedToggle={carriedToggle} />
                : (!isSingleMember && ps && (
                    <div className="share-household-total">
                        Household Total: {formatCurrency(ps.combinedMonthlyTotal)}/mo · {formatCurrency(ps.combinedAnnualTotal)}/yr
                    </div>
                ))}

            {data.carriedItems && carriedToggle.panelId && <CarriedItemsPanel carried={data.carriedItems} carriedToggle={carriedToggle} />}
            {/* Only a #688 payload (it carries unusedCredit) may promise refundable credit. */}
            {data.carriedItems?.unusedCredit != null && data.carriedItems.remainingCredit > 0 && <p className="share-hint">Your {data.carriedItems.fromYear || 'previous year'} credit of {formatCurrency(Math.max(0, -data.carriedItems.total))} covers this year; {formatCurrency(data.carriedItems.remainingCredit)} remains as a credit that can be refunded or carried into next year.</p>}
            {allMembers.map(member => (
                <MemberRow
                    key={member.memberId || member.name}
                    member={member}
                    canDispute={canDispute}
                    onRequestReview={bill => setDisputeForm(bill)}
                    defaultExpanded={isSingleMember}
                    isSettled={isSettled}
                />
            ))}

            {disputeForm && (
                <DisputeFormOverlay
                    bill={disputeForm}
                    shareCtx={shareCtx}
                    onClose={() => setDisputeForm(null)}
                />
            )}
        </div>
    );
}

function BillsTable({ bills, canDispute, onRequestReview }) {
    if (!bills || bills.length === 0) return <p className="share-hint">No bills assigned.</p>;
    const total = bills.reduce((s, b) => s + (b.annualShare || 0), 0);

    return (
        <div className="share-table-wrap">
            <table className="share-table">
                <thead>
                    <tr>
                        <th>Bill</th>
                        <th className="share-cell-number share-cell-muted">Monthly</th>
                        <th className="share-cell-number share-cell-muted">Split</th>
                        <th className="share-cell-number share-cell-emphasis">Share</th>
                        <th className="share-cell-number share-cell-emphasis">Annual</th>
                        {canDispute && <th></th>}
                    </tr>
                </thead>
                <tbody>
                    {bills.map((b, i) => (
                        <tr key={b.billId || i}>
                            <td>
                                <div className="share-bill-cell">
                                    <CompanyLogo logo={b.logo} website={b.website} name={b.name || 'Bill'} size={28} />
                                    <div className="share-bill-meta">
                                        <strong>{b.name || 'Unnamed Bill'}</strong>
                                        <span className="share-bill-math">{formatSplitMath(b)}</span>
                                    </div>
                                </div>
                            </td>
                            <td className="share-cell-number share-cell-muted">{formatCurrency(b.monthlyAmount)}</td>
                            <td className="share-cell-number share-cell-muted">{b.splitCount} {b.splitCount === 1 ? 'member' : 'members'}</td>
                            <td className="share-cell-number share-cell-emphasis">{formatCurrency(b.monthlyShare)}</td>
                            <td className="share-cell-number share-cell-emphasis"><strong>{formatCurrency(b.annualShare)}</strong></td>
                            {canDispute && (
                                <td><button type="button" className="share-review-btn" onClick={() => onRequestReview(b)}>Question This</button></td>
                            )}
                        </tr>
                    ))}
                    <tr className="share-total-row">
                        <td colSpan={3}>TOTAL</td>
                        <td className="share-cell-number share-cell-emphasis">{formatCurrency(total / 12)}</td>
                        <td className="share-cell-number share-cell-emphasis"><strong>{formatCurrency(total)}</strong></td>
                        {canDispute && <td></td>}
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

function PaymentSummarySection({ ps }) {
    const pctPaid = ps.combinedAnnualTotal > 0 ? Math.min(100, Math.round((ps.totalPaid / ps.combinedAnnualTotal) * 100)) : 0;
    const { isOwed, isSettled } = derivePaymentState(ps);

    // The lead callout (rendered above the bills) carries the settled/owed
    // headline; these cards carry the supporting figures. Settled collapses to the
    // two that still matter (share, annual); owed/unpaid keeps annual, paid, and
    // the outstanding balance plus the progress bar.
    return (
        <section className="share-section share-summary-stats" aria-label="Payment summary">
            <div className="share-stat-grid">
                {isSettled ? (
                    <>
                        <div className="share-stat-card"><div className="share-stat-label">Your share</div><div className="share-stat-value type-display">{formatCurrency(ps.combinedMonthlyTotal)}<span className="share-stat-unit">/mo</span></div></div>
                        <div className="share-stat-card"><div className="share-stat-label">Annual total</div><div className="share-stat-value type-display">{formatCurrency(ps.combinedAnnualTotal)}</div></div>
                    </>
                ) : (
                    <>
                        <div className="share-stat-card"><div className="share-stat-label">Annual Total</div><div className="share-stat-value type-display">{formatCurrency(ps.combinedAnnualTotal)}</div></div>
                        <div className="share-stat-card"><div className="share-stat-label">Paid to Date</div><div className="share-stat-value type-display paid">{formatCurrency(ps.totalPaid)}</div></div>
                        <div className="share-stat-card"><div className="share-stat-label">{isOwed ? 'Balance Due' : 'Balance Remaining'}</div><div className={'share-stat-value type-display ' + (isOwed ? 'owed' : 'settled-zero')}>{formatCurrency(ps.balanceRemaining)}</div></div>
                    </>
                )}
            </div>

            {!isSettled && (
                <>
                    <div className="share-progress">
                        <div className="share-progress-bar" style={{ width: pctPaid + '%' }} />
                    </div>
                    <div className="share-progress-label">{pctPaid}% paid</div>
                </>
            )}
        </section>
    );
}

function PaymentMethodsSection({ methods, ownerId, canDispute, paymentSummary }) {
    // Methods always render in full (both states); the echo surfaces the amount due
    // on the preferred method when owed.
    const { isOwed, balanceRemaining } = derivePaymentState(paymentSummary);
    const [qrModal, setQrModal] = useState(null);
    const [loadingQr, setLoadingQr] = useState(null);

    function copyText(text, e) {
        const btn = e.currentTarget;
        navigator.clipboard.writeText(text).then(() => {
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        });
    }

    async function loadQrCode(methodId, label) {
        if (!ownerId || !methodId) return;
        if (loadingQr) return; // prevent duplicate clicks
        setLoadingQr(methodId);
        const docId = ownerId + '_' + methodId;
        try {
            const qrDoc = await getDoc(doc(db, 'publicQrCodes', docId));
            if (qrDoc.exists() && qrDoc.data().qrCode) {
                setQrModal({ src: qrDoc.data().qrCode, label });
            } else {
                setQrModal({ src: null, label, missing: true });
            }
        } catch (err) {
            console.error('Failed to load QR code:', err);
            setQrModal({ src: null, label, missing: true });
        }
        setLoadingQr(null);
    }

    const preferredMethod = methods.find(m => m.preferred);
    const otherMethods = methods.filter(m => !m.preferred).sort((a, b) => a.label.localeCompare(b.label));

    function renderCard(pm, className) {
        return (
            <div key={pm.id} className={className}>
                <div className="share-pm-header">
                    <span className="share-pm-icon" dangerouslySetInnerHTML={{ __html: getPaymentMethodIcon(pm.type) }} />
                    <strong>{pm.label}</strong>
                    {pm.preferred && <span className="share-pm-preferred-badge">&#9733; Preferred</span>}
                </div>
                {pm.preferred && isOwed && (
                    <p className="share-pm-amount-due">Send {formatCurrency(balanceRemaining)} via {pm.label}</p>
                )}
                <div className="share-pm-body">
                    {pm.type === 'zelle' && [pm.email, pm.phone].filter(Boolean).map(c => (
                        <div key={c} className="share-pm-detail">
                            <span>{c}</span>
                            <button className="share-copy-btn" onClick={e => copyText(c, e)}>Copy</button>
                        </div>
                    ))}
                    {pm.type === 'apple_cash' && [pm.phone, pm.email].filter(Boolean).map(c => (
                        <div key={c} className="share-pm-detail">
                            <span>{c}</span>
                            <button className="share-copy-btn" onClick={e => copyText(c, e)}>Copy</button>
                        </div>
                    ))}
                    {pm.type === 'check' && (
                        <>
                            {pm.name && (
                                <div className="share-pm-detail">
                                    <span>Payee: {pm.name}</span>
                                    <button className="share-copy-btn" onClick={e => copyText(pm.name, e)}>Copy</button>
                                </div>
                            )}
                            {pm.address && (
                                <div className="share-pm-detail">
                                    <span style={{ whiteSpace: 'pre-line' }}>{pm.address}</span>
                                    <button className="share-copy-btn" onClick={e => copyText(pm.address, e)}>Copy</button>
                                </div>
                            )}
                            {pm.phone && (
                                <div className="share-pm-detail">
                                    <span>{pm.phone}</span>
                                    <button className="share-copy-btn" onClick={e => copyText(pm.phone, e)}>Copy</button>
                                </div>
                            )}
                        </>
                    )}
                    {pm.type !== 'zelle' && pm.type !== 'apple_cash' && pm.type !== 'check' && pm.handle && (
                        <div className="share-pm-detail">
                            <span>{pm.handle}</span>
                            <button className="share-copy-btn" onClick={e => copyText(pm.handle, e)}>Copy</button>
                        </div>
                    )}
                    {pm.type !== 'zelle' && pm.type !== 'apple_cash' && pm.type !== 'check' && pm.url && (
                        <div className="share-pm-detail">
                            <a href={pm.url} target="_blank" rel="noopener noreferrer">{pm.url}</a>
                            <button className="share-copy-btn" onClick={e => copyText(pm.url, e)}>Copy link</button>
                        </div>
                    )}
                    {pm.instructions && <p className="share-pm-instructions">{pm.instructions}</p>}
                </div>
                {(pm.qrCode || pm.hasQrCode) && (
                    <button className="share-qr-btn" disabled={loadingQr === pm.id} onClick={() => {
                        if (pm.qrCode) {
                            setQrModal({ src: pm.qrCode, label: pm.label });
                        } else {
                            loadQrCode(pm.id, pm.label);
                        }
                    }}>{loadingQr === pm.id ? 'Loading...' : 'Show QR Code'}</button>
                )}
            </div>
        );
    }

    return (
        <div className="share-section">
            <h2 className="type-display">Payment Methods</h2>
            <p className="share-trust-note share-trust-note--secure">
                <svg className="share-trust-lock" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>
                    Payments go directly to the organizer—Friends &amp; Family Billing never processes or holds your money.
                    {canDispute && ' That’s also why "Question this charge" exists: flag anything that looks off and the account owner is notified.'}
                </span>
            </p>
            {preferredMethod && renderCard(preferredMethod, 'share-pm-card share-pm-card--preferred')}
            {otherMethods.length > 0 && (
                <div className="share-pm-grid">
                    {otherMethods.map(pm => renderCard(pm, 'share-pm-card'))}
                </div>
            )}

            {qrModal && (
                <Dialog
                    onClose={() => setQrModal(null)}
                    title={<>QR Code — {qrModal.label}</>}
                    footer={<button className="btn btn-sm btn-header-secondary" onClick={() => setQrModal(null)}>Close</button>}
                >
                    {qrModal.src ? (
                        <div className="dialog-body-padded">
                            <img src={qrModal.src} alt={'QR Code for ' + qrModal.label} style={{ maxWidth: '250px', margin: '0 auto', display: 'block' }} />
                        </div>
                    ) : (
                        <p className="dialog-body-padded" style={{ color: 'var(--color-text-secondary)' }}>
                            No QR code available for this payment method.
                        </p>
                    )}
                </Dialog>
            )}
        </div>
    );
}

/** Format a payment's `receivedAt` ISO timestamp for display (date only). */
function formatPaymentDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString();
}

/**
 * Member-facing payment history (#357). Renders the household's settled payments
 * from the `payments:read` payload (`data.paymentHistory`, built by
 * buildPaymentHistoryForShare). Collapsed behind a "Show payment history" entry
 * point so it doesn't dominate an already-settled view; only safe fields
 * (date, method, amount) are present in the payload. Degrades gracefully: the
 * top-level render omits this section entirely when the scope/payload is absent
 * (older links that predate payments:read) or empty.
 */
function PaymentHistorySection({ history }) {
    const [open, setOpen] = useState(false);
    const payments = (history && history.payments) || [];
    if (payments.length === 0) return null;

    return (
        <div className="share-section">
            <h2 className="type-display">Payment History</h2>
            {!open ? (
                <button type="button" className="share-pm-expand" onClick={() => setOpen(true)}>
                    Show payment history ({payments.length})
                </button>
            ) : (
                <div className="share-table-wrap">
                    <table className="share-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Method</th>
                                <th className="share-cell-number">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {payments.map((p, i) => (
                                <tr key={p.id || i}>
                                    <td>{formatPaymentDate(p.date)}</td>
                                    <td>{getPaymentMethodLabel(p.method)}</td>
                                    <td className="share-cell-number">{formatCurrency(p.amount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function RefundNoticesSection({ notices, shareCtx }) {
    return (
        <div className="share-section">
            <h2 className="type-display">Your Refunds</h2>
            <p className="share-trust-note">
                A refund was sent to your household. Please confirm when it arrives, or let us know if it has not.
            </p>
            <div className="share-refunds-list">
                {notices.map(n => (
                    <RefundNoticeCard key={n.id} notice={n} shareCtx={shareCtx} />
                ))}
            </div>
        </div>
    );
}

function RefundNoticeCard({ notice, shareCtx }) {
    // Seed from the stored confirmation so a reloaded page reflects a past response.
    const [confirmation, setConfirmation] = useState(notice.confirmation || null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);
    const created = notice.createdAt ? new Date(notice.createdAt).toLocaleDateString() : '';

    async function submit(outcome) {
        if (!shareCtx.token || submitting) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const resp = await fetch('/submitRefundConfirmation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: shareCtx.token, noticeId: notice.id, outcome })
            });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || 'Could not record your response.');
            }
            setConfirmation(outcome === 'confirm' ? 'confirmed_by_member' : 'not_received');
        } catch (err) {
            console.error('Refund confirmation error:', err);
            setSubmitError(err.message || 'Could not record your response. Please try again.');
        }
        setSubmitting(false);
    }

    // The card's left rule follows the notice's state, as on the manager's
    // Refund Notices tab: Settled green only once the member confirmed,
    // Outstanding red once reported not received, neutral while pending.
    const stateKey = confirmation === 'confirmed_by_member' ? 'confirmed'
        : confirmation === 'not_received' ? 'not-received'
            : 'sent';

    return (
        <div className={'share-refund-item share-refund-item--' + stateKey}>
            <div className="share-refund-header">
                <strong>{formatCurrency(notice.amount)}</strong>
                {notice.method && <span className="share-refund-method">via {notice.method}</span>}
            </div>
            {created && <div className="share-refund-meta">Sent {created}</div>}
            {notice.reason && <p className="share-refund-reason">Reason: {notice.reason}</p>}

            {!confirmation && (
                <div className="share-refund-actions">
                    <button type="button" className="btn btn-sm btn-ink" disabled={submitting} onClick={() => submit('confirm')}>
                        Confirm Receipt
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" disabled={submitting} onClick={() => submit('not_received')}>
                        I Have Not Received It
                    </button>
                </div>
            )}
            {submitError && <p className="share-refund-status not-received" role="alert">{submitError}</p>}
            {confirmation === 'confirmed_by_member' && (
                <p className="share-refund-status confirmed">You confirmed you received this refund.</p>
            )}
            {confirmation === 'not_received' && (
                <p className="share-refund-status not-received">You reported this refund as not received. The account owner will follow up.</p>
            )}
        </div>
    );
}

function formatChargeDate(dateStr) {
    if (!dateStr) return '';
    // incurredDate is a YYYY-MM-DD string; parse as local date to avoid TZ drift.
    const parts = String(dateStr).split('-');
    if (parts.length === 3) {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
    }
    const fallback = new Date(dateStr);
    return Number.isNaN(fallback.getTime()) ? dateStr : fallback.toLocaleDateString();
}

/**
 * Pending charges (deferred Usage Charges, #317). A running, clearly NOT-YET-DUE
 * list shown only when the share token carries the usageCharges:read scope and
 * the household has deferred charges. These do not affect the payment summary.
 */
function PendingChargesSection({ pendingCharges }) {
    const charges = pendingCharges.charges || [];
    const count = charges.length;
    return (
        <div className="share-section">
            <div className="share-pending-notice">
                <div className="share-pending-notice-head">
                    <svg className="share-pending-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                    </svg>
                    <span>{count} upcoming charge{count === 1 ? '' : 's'} — not yet due</span>
                </div>
                <ul className="share-pending-list">
                    {charges.map((c, i) => (
                        <li key={c.id || i}>
                            <strong>{formatCurrency(c.amount)}</strong> · {c.description || 'Usage charge'}{c.incurredDate ? ', ' + formatChargeDate(c.incurredDate) : ''}
                        </li>
                    ))}
                </ul>
                <p className="share-pending-foot">
                    {formatCurrency(pendingCharges.total)} total · not part of your current balance. {count === 1 ? 'It' : 'They'} will either be billed separately by the admin or applied to your bill next year.
                </p>
            </div>
        </div>
    );
}

function DisputesSection({ disputes, shareCtx }) {
    return (
        <div className="share-section">
            <h2 className="type-display">Your Review Requests</h2>
            <div className="share-disputes-list">
                {disputes.map(d => (
                    <ShareDisputeCard key={d.id} dispute={d} shareCtx={shareCtx} />
                ))}
            </div>
        </div>
    );
}

function ShareDisputeCard({ dispute, shareCtx }) {
    // Only seed from terminal decisions — 'requested' is the actionable state, not a decision.
    const initialDecision = dispute.userReview && dispute.userReview.state !== 'requested'
        ? dispute.userReview.state : null;
    const [decision, setDecision] = useState(initialDecision);
    const d = dispute;
    const label = STATUS_LABELS[d.status] || d.status;
    const created = d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '';

    async function submitDecision(type, decisionNote) {
        if (!shareCtx.token || !shareCtx.ownerId || !shareCtx.billingYearId) return;
        try {
            const resp = await fetch('/submitDisputeDecision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: shareCtx.token,
                    disputeId: d.id,
                    decision: type === 'approve' ? 'approve' : 'reject',
                    ...(type === 'reject' ? { note: decisionNote } : {})
                })
            });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || 'Decision failed');
            }
            setDecision(type === 'approve' ? 'approved_by_user' : 'rejected_by_user');
        } catch (err) {
            console.error('Decision error:', err);
        }
    }

    return (
        <div className={'share-dispute-item share-dispute--' + (d.status || 'open')}>
            <div className="share-dispute-header">
                <strong>{d.billName}</strong>
                <span className={'share-dispute-badge share-dispute-badge--' + d.status}>{label}</span>
            </div>
            {created && <div className="share-dispute-meta">{created}</div>}
            <p className="share-dispute-message">{d.message}</p>
            {d.proposedCorrection && <p className="share-dispute-correction">Suggested: {d.proposedCorrection}</p>}
            {d.resolutionNote && <p className="share-dispute-resolution">Resolution: {d.resolutionNote}</p>}

            {d.evidence && d.evidence.length > 0 && (
                <div className="share-evidence-list">
                    {d.evidence.map((ev, i) => (
                        <ShareEvidenceItem key={i} evidence={ev} index={i} disputeId={d.id} shareCtx={shareCtx} />
                    ))}
                </div>
            )}

            {d.userReview && d.userReview.state === 'requested' && !decision && (
                <div className="share-dispute-actions">
                    <button className="btn btn-sm btn-ink" onClick={() => submitDecision('approve')}>Approve</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => {
                        const note = prompt('Please explain why you are rejecting:');
                        if (note !== null && note.trim()) submitDecision('reject', note.trim());
                    }}>Reject</button>
                </div>
            )}
            {(decision === 'approved_by_user' || (d.userReview && d.userReview.state === 'approved_by_user')) && (
                <p className="share-dispute-decision approved">You approved this resolution.</p>
            )}
            {(decision === 'rejected_by_user' || (d.userReview && d.userReview.state === 'rejected_by_user')) && (
                <p className="share-dispute-decision rejected">You rejected this resolution.</p>
            )}
        </div>
    );
}

function ShareEvidenceItem({ evidence, index, disputeId, shareCtx }) {
    const [loading, setLoading] = useState(false);

    async function handleView() {
        // If downloadUrl is available, use it directly
        if (evidence.downloadUrl) {
            window.open(evidence.downloadUrl, '_blank', 'noopener,noreferrer');
            return;
        }
        // Otherwise fetch via Cloud Function (mirrors share.html:397)
        setLoading(true);
        try {
            const resp = await fetch('/getEvidenceUrl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: shareCtx.token, disputeId, evidenceIndex: index })
            });
            const data = await resp.json();
            if (resp.ok && data.url) {
                window.open(data.url, '_blank', 'noopener,noreferrer');
            }
        } catch (err) {
            console.error('Evidence URL error:', err);
        }
        setLoading(false);
    }

    const isImage = evidence.contentType && evidence.contentType.startsWith('image/');
    return (
        <div className="share-evidence-item">
            <span>{isImage ? '\ud83d\udcf7' : '\ud83d\udcc4'}</span>
            <button className="share-evidence-link" onClick={handleView} disabled={loading}>
                {loading ? 'Loading...' : (evidence.name || 'File ' + (index + 1))}
            </button>
        </div>
    );
}

function DisputeFormOverlay({ bill, shareCtx, onClose }) {
    const [message, setMessage] = useState('');
    const [correction, setCorrection] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [msgError, setMsgError] = useState(false);

    async function handleSubmit() {
        if (!message.trim()) {
            setMsgError(true);
            return;
        }
        if (!shareCtx.token || !shareCtx.ownerId || !shareCtx.billingYearId || !shareCtx.memberId) return;
        setSubmitting(true);
        try {
            const resp = await fetch('/submitDispute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: shareCtx.token,
                    billId: bill.billId,
                    billName: (bill.name || '').trim(),
                    message: message.trim(),
                    proposedCorrection: correction.trim() || null
                })
            });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || 'Submission failed');
            }
            setSuccess(true);
        } catch (err) {
            console.error('Dispute submission error:', err);
        }
        setSubmitting(false);
    }

    return (
        <Dialog
            onClose={onClose}
            wide
            title={success ? 'Question Submitted' : 'Question This Charge'}
            footer={success ? (
                <button className="btn btn-sm btn-ink" onClick={onClose}>Close</button>
            ) : (
                <>
                    <button className="btn btn-sm btn-header-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-sm btn-ink" onClick={handleSubmit} disabled={submitting}>
                        {submitting ? 'Submitting...' : 'Submit'}
                    </button>
                </>
            )}
        >
            {success ? (
                <p>The account owner will be notified of your request.</p>
            ) : (
                <>
                    <p className="share-hint">Flagging <strong>{bill.name}</strong> for review.</p>
                    <div className="payment-dialog-fields">
                        <div className="payment-field-group">
                            <label>What looks wrong?</label>
                            <textarea
                                className={'composer-input' + (msgError ? ' input-error' : '')}
                                rows={4}
                                placeholder="Describe the issue..."
                                value={message}
                                onChange={e => { setMessage(e.target.value); setMsgError(false); }}
                                maxLength={2000}
                            />
                        </div>
                        <div className="payment-field-group">
                            <label>Suggested correction (optional)</label>
                            <input
                                className="composer-input"
                                placeholder="e.g. Should be $45/mo instead of $60"
                                value={correction}
                                onChange={e => setCorrection(e.target.value)}
                                maxLength={500}
                            />
                        </div>
                    </div>
                </>
            )}
        </Dialog>
    );
}
