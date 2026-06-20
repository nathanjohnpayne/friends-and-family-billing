// Billing year lifecycle helpers — no DOM, no Firestore, no module-scoped state.

import { calculateAnnualSummary, isLinkedToAnyone, getHouseholdFinancials, CREDIT_EPSILON } from './calculations.js';

/**
 * Calculate total outstanding balance across all main (non-linked) households.
 * Used by closeCurrentYear to show the user how much is still unpaid. Mirrors
 * the per-household NET shortfall summed by calculateSettlementMetrics, so the
 * close path and the dashboard agree and recorded refunds/carry-forwards never
 * mask a real shortfall.
 * Billed Usage Charges (#320, optional trailing arg) raise a household's owed, so an
 * unpaid billed charge surfaces as outstanding (ADR 0006); deferred charges do not.
 * The arg defaults to empty, so existing 4-arg callers are unaffected.
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {Array} [creditAdjustments]
 * @param {Array} [owedAdjustments]  Usage Charges; only BILLED ones raise owed
 * @returns {number}
 */
export function calculateOutstandingBalance(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = []) {
    const summary = calculateAnnualSummary(familyMembers, bills);
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));
    let total = 0;
    mainMembers.forEach(member => {
        const { owed, netContribution } = getHouseholdFinancials(member, summary, payments, creditAdjustments, owedAdjustments);
        const shortfall = owed - netContribution;
        if (shortfall > CREDIT_EPSILON) total += shortfall;
    });
    return total;
}

/**
 * Build the confirmation message for closing a billing year.
 * @param {string} yearLabel
 * @param {number} outstandingBalance
 * @returns {string}
 */
export function buildCloseYearMessage(yearLabel, outstandingBalance) {
    let msg = 'Close billing year ' + yearLabel + '.';
    if (outstandingBalance > 0) {
        msg += ' $' + outstandingBalance.toFixed(2) + ' is still outstanding. Closing will prevent further payments.';
    }
    msg += ' You can archive it later for permanent read-only storage.';
    return msg;
}

/**
 * Suggest a default label for the next billing year.
 * @param {{ label: string }|null} currentBillingYear
 * @returns {string}
 */
export function suggestNextYearLabel(currentBillingYear) {
    const curLabel = currentBillingYear ? parseInt(currentBillingYear.label) : NaN;
    const nextYear = !isNaN(curLabel) ? Math.max(new Date().getFullYear(), curLabel + 1) : new Date().getFullYear();
    return String(nextYear);
}

/**
 * Check if a year label already exists in the list.
 * @param {Array<{ id: string }>} billingYears
 * @param {string} label
 * @returns {boolean}
 */
export function isYearLabelDuplicate(billingYears, label) {
    return billingYears.some(y => y.id === label.trim());
}

/**
 * Build the cloned data for a new billing year (members reset, bills preserved).
 * Does NOT include Firestore-specific fields (createdAt, updatedAt) — caller adds those.
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Object} settings
 * @param {string} yearId
 * @returns {Object}
 */
export function buildNewYearData(familyMembers, bills, settings, yearId) {
    const clonedMembers = familyMembers.map(m => ({
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone || '',
        avatar: m.avatar,
        paymentReceived: 0,
        linkedMembers: m.linkedMembers ? m.linkedMembers.slice() : []
    }));
    const clonedBills = bills.map(b => ({
        id: b.id,
        name: b.name,
        amount: b.amount,
        billingFrequency: b.billingFrequency || 'monthly',
        logo: b.logo,
        website: b.website,
        members: b.members ? b.members.slice() : []
    }));

    return {
        label: yearId,
        status: 'open',
        archivedAt: null,
        familyMembers: clonedMembers,
        bills: clonedBills,
        payments: [],
        billingEvents: [],
        settings: {
            emailMessage: settings.emailMessage,
            emailSubject: settings.emailSubject || '',
            paymentLinks: (settings.paymentLinks || []).map(l => ({...l})),
            paymentMethods: (settings.paymentMethods || []).map(m => ({...m}))
        }
    };
}
