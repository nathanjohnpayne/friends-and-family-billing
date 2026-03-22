// Share link helpers — no DOM, no Firestore, no module-scoped state.
import { getBillAnnualAmount, getBillMonthlyAmount, getPaymentTotalForMember } from './calculations.js';
import { sanitizeImageSrc } from './formatting.js';

/**
 * Build the default scopes array for a share link.
 * @param {boolean} allowDisputeCreate
 * @param {boolean} allowDisputeRead
 * @returns {string[]}
 */
export function buildShareScopes(allowDisputeCreate, allowDisputeRead) {
    const scopes = ['summary:read', 'paymentMethods:read'];
    if (allowDisputeCreate) scopes.push('disputes:create');
    if (allowDisputeRead) scopes.push('disputes:read');
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
    return origin + '/app/share?token=' + rawToken;
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
 * @returns {Object|null}
 */
export function buildPublicShareData(familyMembers, bills, payments, memberId, scopes, userId, activeYear, settings) {
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

    return data;
}
