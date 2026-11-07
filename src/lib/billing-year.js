// Billing year lifecycle helpers — no DOM, no Firestore, no module-scoped state.

import { calculateSettlementMetrics, buildCarryForward } from './calculations.js';
import { toExactCents } from './household-money.js';
import { requireFinancialAvailability } from './financial-availability.js';
import { normalizeHouseholdName } from './household.js';

// Carry arithmetic uses integer cents, including symmetric signed rounding.
const cents = toExactCents;

/**
 * Return the exact year outstanding alias after checking every household and the
 * aggregate. Null reopening preserves the existing service close context.
 */
export function calculateOutstandingBalance(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = []) {
    const metrics = calculateSettlementMetrics(familyMembers, bills, payments, creditAdjustments, null, owedAdjustments);
    requireFinancialAvailability(metrics);
    return metrics.totalOutstanding;
}

/**
 * Finalize carry once, including actual ids, candidate ledgers and stored seeds.
 * Options bind destination/source labels, actual creditDispositionIds, itemized
 * review detail, carry-only U and the caller's marking reopening context.
 */
export function buildCarryForwardSummary(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], options = {}) {
    return buildCarryForward(familyMembers, bills, payments, creditAdjustments, owedAdjustments, options);
}

/**
 * Clone already allocated items from a finalized household plan. Context is
 * retained for call-site compatibility; it cannot change ids, money or detail.
 */
export function buildCarryOpeningItems(household, _ctx) {
    if (!household.ok || !household.seed) throw new Error('A finalized carry plan is required.');
    return structuredClone(household.seed.items);
}

/**
 * Consume the detached prior-year arrays from the validated whole-year plan.
 * No ids or monetary amounts are generated here. A caller may supply the clock
 * for createdAt; late idFactory/destination changes are rejected before writes.
 */
export function applyCarryForwardToPriorYear(_creditAdjustments, _owedAdjustments, carry, ctx = {}) {
    requireFinancialAvailability(carry);
    if (ctx.idFactory || (ctx.nextYearLabel && ctx.nextYearLabel !== carry.nextYearLabel)) {
        throw new Error('Carry ids and destination must be finalized before validation.');
    }
    const now = ctx.now || new Date().toISOString();
    const newIds = new Set(carry.carriedCreditRecords.map(row => row.id));
    const creditAdjustments = carry.priorYear.creditAdjustments.map(row => newIds.has(row.id)
        ? { ...structuredClone(row), createdAt: row.createdAt || now } : structuredClone(row));
    return { creditAdjustments, owedAdjustments: structuredClone(carry.priorYear.owedAdjustments),
        carriedCreditRecords: creditAdjustments.filter(row => newIds.has(row.id)) };
}

/**
 * Build the confirmation message for closing a billing year.
 * When a carry-forward summary is supplied (#322), the message also states the
 * net amount carrying forward and how many members it affects, so the
 * administrator sees that undisposed credits/charges auto-carry rather than
 * blocking the close (ADR 0006).
 * @param {string} yearLabel
 * @param {number} outstandingBalance
 * @param {{ totalOpeningBalance?: number, memberCount?: number }} [carry]
 * @returns {string}
 */
export function buildCloseYearMessage(yearLabel, outstandingBalance, carry = null) {
    let msg = 'Close billing year ' + yearLabel + '.';
    if (outstandingBalance > 0) {
        msg += ' $' + outstandingBalance.toFixed(2) + ' is still outstanding. Closing will prevent further payments.';
    }
    if (carry && carry.memberCount > 0 && cents(carry.totalOpeningBalance) !== 0) {
        const amount = Math.abs(carry.totalOpeningBalance).toFixed(2);
        const members = carry.memberCount + ' member' + (carry.memberCount === 1 ? '' : 's');
        // A net-negative opening balance is credit-dominant (carried back to
        // members); a net-positive balance is charge-dominant (carried as owed).
        const direction = carry.totalOpeningBalance < 0 ? 'net credit' : 'net charges';
        msg += ' $' + amount + ' of ' + direction + ' across ' + members + ' will carry forward to next year.';
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
 * Clone members, current household names, bills and settings into a new year.
 * A supplied carry must already be finalized for these source/destination labels.
 * Stored seeds are copied verbatim: legacy zero-net seeds were omitted by the
 * plan; itemized review zero-net seeds retain their allocated explanation.
 */
export function buildNewYearData(familyMembers, bills, settings, yearId, carry = null, fromYearLabel = null) {
    const clonedMembers = familyMembers.map(m => {
        const linkedMembers = m.linkedMembers ? m.linkedMembers.slice() : [];
        const cloned = {
            id: m.id,
            name: m.name,
            email: m.email,
            phone: m.phone || '',
            avatar: m.avatar,
            paymentReceived: 0,
            linkedMembers
        };
        // The household name lives on the contact's record (#528, ADR 0011); carry it
        // so Start New Year does not lose it. Only a contact (a member with linked
        // members) keeps one.
        const householdName = normalizeHouseholdName(m.householdName);
        if (householdName && linkedMembers.length > 0) cloned.householdName = householdName;
        return cloned;
    });
    const clonedBills = bills.map(b => ({
        id: b.id,
        name: b.name,
        amount: b.amount,
        billingFrequency: b.billingFrequency || 'monthly',
        logo: b.logo,
        website: b.website,
        members: b.members ? b.members.slice() : []
    }));

    // Seed the netted opening balance for each carrying household (#322). Seed IDs
    // are deterministic per (source year, member) so a re-run never duplicates a
    // household's opening balance, and they are visibly distinct from usage-charge
    // ('oadj_') and payment ('pay_') ids.
    if (carry) {
        requireFinancialAvailability(carry);
        if (carry.nextYearLabel !== yearId || carry.fromYearLabel !== (fromYearLabel || 'prev')) {
            throw new Error('The finalized carry plan belongs to another year.');
        }
    }
    const owedAdjustments = (carry?.seeds || []).map(seed => ({ ...structuredClone(seed), createdAt: new Date().toISOString() }));

    return {
        label: yearId,
        status: 'open',
        archivedAt: null,
        familyMembers: clonedMembers,
        bills: clonedBills,
        payments: [],
        creditAdjustments: [],
        owedAdjustments,
        billingEvents: [],
        settings: {
            emailMessage: settings.emailMessage,
            emailSubject: settings.emailSubject || '',
            paymentLinks: (settings.paymentLinks || []).map(l => ({...l})),
            paymentMethods: (settings.paymentMethods || []).map(m => ({...m}))
        }
    };
}
