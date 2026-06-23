// Share link helpers — no DOM, no Firestore, no module-scoped state.
import { getBillAnnualAmount, getBillMonthlyAmount, getPaymentTotalForMember, getServiceCreditTotalForMember, getHouseholdOpeningBalance } from './calculations.js';
import { sanitizeImageSrc } from './formatting.js';

/**
 * Build the default scopes array for a share link.
 *
 * `usageCharges:read` is always granted (#317): a member always sees their OWN
 * pending Usage Charges on their share page (the data is their own not-yet-due
 * charges, per ADR 0005), so the feature must be reachable on every normal link.
 *
 * `payments:read` is likewise always granted (#356): a member's payment history
 * is their own data, the same posture as `usageCharges:read`. It gates a
 * member-safe projection (date/amount/method only) of the household's settled
 * payments. Links minted before this scope existed simply won't carry it, so the
 * share page degrades gracefully (omits the history) — see buildPaymentHistoryForShare.
 * @param {boolean} allowDisputeCreate
 * @param {boolean} allowDisputeRead
 * @param {boolean} [allowRefundsRead] — grants refunds:read so the member can see
 *   their own Refund Notices and confirm receipt / report non-receipt (#319).
 * @returns {string[]}
 */
export function buildShareScopes(allowDisputeCreate, allowDisputeRead, allowRefundsRead) {
    const scopes = ['summary:read', 'paymentMethods:read', 'usageCharges:read', 'payments:read'];
    if (allowDisputeCreate) scopes.push('disputes:create');
    if (allowDisputeRead) scopes.push('disputes:read');
    if (allowRefundsRead) scopes.push('refunds:read');
    return scopes;
}

/**
 * Build the share token document for Firestore.
 * Does NOT include FieldValue.serverTimestamp() or Timestamp.fromDate() —
 * caller wraps expiresAt and adds createdAt.
 * @param {string} userId
 * @param {number} memberId
 * @param {string} memberName
 * @param {string} billingYearId
 * @param {string|null} rawToken - included in doc when truthy (omit for invoice-generated links)
 * @param {Date|null} expiresAt
 * @param {string[]} scopes
 * @returns {Object}
 */
export function buildShareTokenDoc(userId, memberId, memberName, billingYearId, rawToken, expiresAt, scopes) {
    const doc = {
        ownerId: userId,
        memberId: memberId,
        billingYearId: billingYearId,
        scopes: scopes,
        revoked: false,
        expiresAt: expiresAt || null,
        memberName: memberName,
        lastAccessedAt: null,
        accessCount: 0
    };
    if (rawToken) doc.rawToken = rawToken;
    return doc;
}

/**
 * Build the share URL from an origin and raw token.
 * @param {string} origin - e.g. window.location.origin
 * @param {string} rawToken
 * @returns {string}
 */
export function buildShareUrl(origin, rawToken) {
    return origin + '/share?token=' + rawToken;
}

/**
 * Compute an expiry Date from a number of days, or null for no expiry.
 * @param {number} expiryDays - 0 or falsy means no expiry
 * @returns {Date|null}
 */
export function computeExpiryDate(expiryDays) {
    if (!expiryDays || expiryDays <= 0) return null;
    const d = new Date();
    d.setDate(d.getDate() + expiryDays);
    return d;
}

/**
 * Check if a share token is stale (revoked or expired).
 * @param {{ revoked: boolean, expiresAt: *|null }} tokenData
 * @param {Date} now
 * @returns {boolean}
 */
export function isShareTokenStale(tokenData, now) {
    if (tokenData.revoked) return true;
    if (!tokenData.expiresAt) return false;
    const expiryDate = tokenData.expiresAt.toDate
        ? tokenData.expiresAt.toDate()
        : new Date(tokenData.expiresAt);
    return expiryDate < now;
}

/**
 * Compute a member's bill summary for a public share (mirrors main.js:3759).
 */
function computeMemberSummaryForShare(familyMembers, bills, memberId) {
    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return null;
    const memberBills = [];
    let total = 0;
    bills.forEach(bill => {
        if (bill.members && bill.members.includes(memberId) && bill.members.length > 0) {
            const annualTotal = getBillAnnualAmount(bill);
            const annualShare = annualTotal / bill.members.length;
            const monthlyShare = annualShare / 12;
            total += annualShare;
            memberBills.push({
                billId: bill.id,
                name: bill.name,
                logo: sanitizeImageSrc(bill.logo),
                website: bill.website || '',
                monthlyAmount: getBillMonthlyAmount(bill),
                billingFrequency: bill.billingFrequency || 'monthly',
                canonicalAmount: bill.amount,
                splitCount: bill.members.length,
                monthlyShare: Math.round(monthlyShare * 100) / 100,
                annualShare: Math.round(annualShare * 100) / 100,
            });
        }
    });
    return {
        name: member.name,
        avatar: sanitizeImageSrc(member.avatar),
        memberId,
        monthlyTotal: Math.round((total / 12) * 100) / 100,
        annualTotal: Math.round(total * 100) / 100,
        bills: memberBills,
    };
}

/**
 * Build the publicShares document for a share link (mirrors main.js:3793).
 * Pure function — caller writes to Firestore.
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {number} memberId
 * @param {string[]} scopes
 * @param {string} userId
 * @param {{ id: string, label?: string }} activeYear
 * @param {{ paymentMethods?: Array }} settings
 * @param {Array} [owedAdjustments]  Service Credits (−owed, #321) reduce the household's
 *   combinedAnnualTotal/balanceRemaining and the netted carried opening balance
 *   (carry_opening seeds, #322) adjusts it (carried credit −, carried charge +), the
 *   combined result floored at 0 so the share summary agrees with the settlement board;
 *   and deferred Usage Charges (#317) are included as `pendingCharges` when the scopes
 *   carry `usageCharges:read`, so the member-facing pending-charges view is reachable on
 *   a normally-generated link (not only via the Cloud Function self-heal).
 * @returns {Object|null}
 */
export function buildPublicShareData(familyMembers, bills, payments, memberId, scopes, userId, activeYear, settings, owedAdjustments) {
    const primarySummary = computeMemberSummaryForShare(familyMembers, bills, memberId);
    if (!primarySummary) return null;

    const member = familyMembers.find(m => m.id === memberId);
    const linkedIds = (member && member.linkedMembers) || [];
    const linkedSummaries = linkedIds
        .map(id => computeMemberSummaryForShare(familyMembers, bills, id))
        .filter(Boolean);

    const paymentTotal = getPaymentTotalForMember(payments, memberId);
    let combinedAnnual = primarySummary.annualTotal;
    let combinedPayment = paymentTotal;
    linkedSummaries.forEach(ls => {
        combinedAnnual += ls.annualTotal;
        combinedPayment += getPaymentTotalForMember(payments, ls.memberId);
    });

    // Compose the member-facing owed exactly as getHouseholdFinancials / the invoice
    // do (#321 + #322): active Service Credits subtract and the netted carried opening
    // balance (carry_opening seeds for the primary + linked members — a carried credit
    // is negative, a carried charge positive) adjusts, the combined result floored at 0
    // so neither an over-large credit nor a carried credit reads as negative debt. The
    // carry_opening seeds are a distinct kind, so getServiceCreditTotalForMember ignores
    // them — no double-count. Mirrors the board so the share summary agrees with it.
    const serviceCreditTotal = getServiceCreditTotalForMember(owedAdjustments || [], memberId)
        + linkedIds.reduce((s, id) => s + getServiceCreditTotalForMember(owedAdjustments || [], id), 0);
    const openingBalance = getHouseholdOpeningBalance(member, owedAdjustments || []);
    combinedAnnual = Math.max(0, combinedAnnual - serviceCreditTotal + openingBalance);

    const enabledMethods = ((settings && settings.paymentMethods) || []).filter(m => m.enabled);

    const data = {
        memberName: primarySummary.name,
        memberId,
        billingYearId: activeYear ? activeYear.id : '',
        year: activeYear ? (activeYear.label || activeYear.id) : '',
        scopes,
        ownerId: userId,
    };

    if (scopes.includes('summary:read')) {
        data.summary = primarySummary;
        data.linkedMembers = linkedSummaries;
        data.paymentSummary = {
            combinedAnnualTotal: Math.round(combinedAnnual * 100) / 100,
            combinedMonthlyTotal: Math.round((combinedAnnual / 12) * 100) / 100,
            totalPaid: Math.round(combinedPayment * 100) / 100,
            balanceRemaining: Math.round((combinedAnnual - combinedPayment) * 100) / 100,
        };
        // Surface the household's active Service Credits (#337) as member-safe line
        // items so the reduced combinedAnnualTotal is explained on the share summary
        // (the reduction is already folded into the total above). Omitted when there
        // are none. The total equals the serviceCreditTotal subtracted above.
        const serviceCredits = buildServiceCreditsForShare(bills, owedAdjustments || [], memberId, linkedIds);
        if (serviceCredits.total > 0) {
            data.serviceCredits = serviceCredits;
        }
    }

    if (scopes.includes('paymentMethods:read')) {
        data.paymentMethods = enabledMethods.map(m => {
            const copy = Object.assign({}, m);
            if (copy.qrCode) { copy.hasQrCode = true; delete copy.qrCode; }
            return copy;
        });
    }

    if (scopes.includes('usageCharges:read')) {
        data.pendingCharges = buildPendingChargesForShare(familyMembers, owedAdjustments || [], memberId);
    }

    // Member-safe payment history (#356) for the household (primary + linked), gated
    // behind payments:read. Mirrored by the resolveShareToken CF for cache/fallback parity.
    if (scopes.includes('payments:read')) {
        data.paymentHistory = buildPaymentHistoryForShare(payments, [memberId, ...linkedIds]);
    }

    return data;
}

/**
 * Build the member-facing Service Credits line items for a share summary (#321, #337).
 * Active `service_credit` adjustments for the household (the primary plus linked
 * members) reduce the household's combinedAnnualTotal but were previously invisible to
 * the member — the total was silently lower than the sum of the bills. Surface them as
 * line items so the reduction is explained.
 *
 * A bill-level credit is stored as one record per affected member (a split), so the
 * household's records are aggregated by (billId + reason) to reconstruct each credit as
 * it was issued. A per-member credit is a single record. Only member-safe fields are
 * exposed (reason, billName, amount). Voided credits, the `+owed` Usage Charge
 * direction, `carry_opening` seeds, and other members' credits are excluded. The
 * returned `total` equals the `service_credit` reduction applied to combinedAnnualTotal.
 *
 * @param {Array} bills
 * @param {Array} owedAdjustments
 * @param {*} memberId  the primary member the share token is scoped to
 * @param {Array} linkedIds  the primary member's linked household member ids
 * @returns {{ items: Array<{ reason: string, billName: string, amount: number }>, total: number }}
 */
export function buildServiceCreditsForShare(bills, owedAdjustments, memberId, linkedIds) {
    const householdIds = [memberId, ...(linkedIds || [])];
    const billName = id => {
        const b = (bills || []).find(x => x.id === id);
        return (b && b.name) || '';
    };
    // Aggregate the household's active service-credit records by bill + reason so a
    // bill-level split shows as one line. Insertion order is preserved for stable output.
    const groups = new Map();
    (owedAdjustments || []).forEach(a => {
        if (!a || a.kind !== 'service_credit' || a.status !== 'active') return;
        if (!householdIds.includes(a.memberId)) return;
        const amt = Number.parseFloat(a.amount);
        if (!Number.isFinite(amt) || amt <= 0) return;
        const reason = a.reason || '';
        const key = String(a.billId) + '|' + reason;
        const existing = groups.get(key);
        if (existing) {
            existing.amount += amt; // accumulate raw; round once below
        } else {
            groups.set(key, { reason, billName: billName(a.billId), amount: amt });
        }
    });
    // Round once, after aggregation, so per-add rounding can't drift the line items or the
    // total from the raw service-credit sum (cent-level parity with getServiceCreditTotalForMember).
    let rawTotal = 0;
    const items = Array.from(groups.values()).map(it => {
        rawTotal += it.amount;
        return { reason: it.reason, billName: it.billName, amount: Math.round(it.amount * 100) / 100 };
    });
    const total = Math.round(rawTotal * 100) / 100;
    return { items, total };
}

/**
 * Build the member-facing "Pending charges" payload for a share view (#317).
 * Returns the token member's own *deferred* Usage Charges, sorted by incurred
 * date, each annotated with a running total, plus the count and grand total.
 *
 * Only member-safe fields are exposed (description, amount, incurredDate,
 * runningTotal). Voided and already-billed charges, and charges belonging to
 * other households, are excluded. Deferred charges are NOT-YET-DUE — this payload
 * never touches owed or the settlement summary.
 *
 * @param {Array} familyMembers
 * @param {Array} owedAdjustments
 * @param {*} memberId  the primary member the share token is scoped to
 * @returns {{ charges: Array<{ id: *, description: string, amount: number, incurredDate: string, runningTotal: number }>, total: number, count: number }}
 */
export function buildPendingChargesForShare(familyMembers, owedAdjustments, memberId) {
    const empty = { charges: [], total: 0, count: 0 };
    const member = (familyMembers || []).find(m => m.id === memberId);
    if (!member) return empty;

    // Per-member (ADR 0005): a member sees their OWN deferred charges on their share
    // page — "a linked member sees their own pending charges". The household grain is
    // only for the admin settlement board, not this member-facing view.
    const deferred = (owedAdjustments || []).filter(a =>
        a && a.kind === 'usage_charge' && a.status === 'deferred' && a.memberId === memberId
    );

    // Sort by incurred date ascending so the running total reads chronologically.
    deferred.sort((a, b) => String(a.incurredDate || '').localeCompare(String(b.incurredDate || '')));

    let running = 0;
    const charges = deferred.map(a => {
        running = Math.round((running + (a.amount || 0)) * 100) / 100;
        return {
            id: a.id,
            description: a.description || '',
            amount: a.amount || 0,
            incurredDate: a.incurredDate || '',
            runningTotal: running
        };
    });

    return { charges, total: running, count: charges.length };
}

/**
 * Build the member-facing payment history for a share view (#356).
 *
 * Returns the household's settled payments — the token member plus their linked
 * members, the same grain as the `totalPaid` shown on the share summary — as
 * member-safe line items, newest first. This adds line items ALONGSIDE the
 * existing `totalPaid` / `balanceRemaining`; it does not recompute them.
 *
 * Only "live" ledger entries are projected: reversal entries (`type: 'reversal'`)
 * and reversed originals (`reversed === true`) are excluded, so the line items sum
 * to the same combined `totalPaid` that `getPaymentTotalForMember` produces (an
 * original and its reversal net to zero). Only member-safe fields are exposed —
 * `id` (opaque), `date` (the `receivedAt` ISO string), `amount`, and `method` —
 * never the free-text `note`.
 *
 * Privacy: this rides the UNAUTHENTICATED share payload, so it must stay in sync
 * with the `resolveShareToken` CF mirror (cache vs. fallback parity), following the
 * member-safe-projection pattern of buildServiceCreditsForShare / buildPendingChargesForShare.
 *
 * @param {Array} payments  the billing year's payments ledger (append-only, with reversals)
 * @param {Array} householdIds  [primaryMemberId, ...linkedMemberIds] the history is scoped to
 * @returns {{ payments: Array<{ id: *, date: string, amount: number, method: string }>, count: number }}
 */
export function buildPaymentHistoryForShare(payments, householdIds) {
    const ids = householdIds || [];
    const live = (payments || []).filter(p =>
        p && ids.includes(p.memberId) && p.type !== 'reversal' && !p.reversed
    );
    // Newest first — receivedAt is an ISO timestamp string, so lexical sort is chronological.
    live.sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
    const items = live.map(p => ({
        id: p.id,
        date: p.receivedAt || '',
        amount: Math.round((p.amount || 0) * 100) / 100,
        method: p.method || 'other',
    }));
    return { payments: items, count: items.length };
}
