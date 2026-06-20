// Share link helpers — no DOM, no Firestore, no module-scoped state.
import { getBillAnnualAmount, getBillMonthlyAmount, getPaymentTotalForMember } from './calculations.js';
import { sanitizeImageSrc } from './formatting.js';

/**
 * Build the default scopes array for a share link.
 *
 * `usageCharges:read` is always granted (#317): a member always sees their OWN
 * pending Usage Charges on their share page (the data is their own not-yet-due
 * charges, per ADR 0005), so the feature must be reachable on every normal link.
 * @param {boolean} allowDisputeCreate
 * @param {boolean} allowDisputeRead
 * @param {boolean} [allowRefundsRead] — grants refunds:read so the member can see
 *   their own Refund Notices and confirm receipt / report non-receipt (#319).
 * @returns {string[]}
 */
export function buildShareScopes(allowDisputeCreate, allowDisputeRead, allowRefundsRead) {
    const scopes = ['summary:read', 'paymentMethods:read', 'usageCharges:read'];
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
 * @param {Array} [owedAdjustments]  deferred Usage Charges (#317); included as
 *   `pendingCharges` when the scopes carry `usageCharges:read`, so the member-facing
 *   pending-charges view is reachable on a normally-generated link (not only via the
 *   Cloud Function self-heal).
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

    return data;
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
