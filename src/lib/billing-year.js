// Billing year lifecycle helpers — no DOM, no Firestore, no module-scoped state.

import { calculateAnnualSummary, isLinkedToAnyone, getHouseholdFinancials, getHouseholdOpeningBalance, buildCarryForward, CREDIT_EPSILON } from './calculations.js';

/**
 * Calculate total outstanding balance across all main (non-linked) households.
 * Used by closeCurrentYear to show the user how much is still unpaid. Mirrors
 * the per-household NET shortfall summed by calculateSettlementMetrics, so the
 * close path and the dashboard agree and recorded refunds/carry-forwards never
 * mask a real shortfall.
 *
 * owedAdjustments (#320/#321) flow through getHouseholdFinancials: a billed Usage
 * Charge (#320) RAISES owed, so an unpaid billed charge surfaces as outstanding
 * (ADR 0006) and blocks close on present-tense money, while a Service Credit (#321,
 * ADR 0005) LOWERS owed and can only shrink a shortfall, never inflate it. The
 * carried opening balance (#322) folds into owed via getHouseholdOpeningBalance —
 * a carried charge becomes collectable and a carried credit lowers what is owed —
 * keeping the Outstanding figure consistent with the board. Deferred Usage Charges
 * (#317) are ignored (pending, not owed). Both args default to empty/0, so existing
 * 4-arg callers are unaffected.
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {Array} [creditAdjustments]
 * @param {Array} [owedAdjustments]  Service Credits (−owed, #321) lower owed, billed
 *   Usage Charges (+owed, #320) raise it, and the `carry_opening` seeds (#322) fold the
 *   carried opening balance in; deferred Usage Charges (#317) are ignored
 * @returns {number}
 */
export function calculateOutstandingBalance(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = []) {
    const summary = calculateAnnualSummary(familyMembers, bills);
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));
    let total = 0;
    mainMembers.forEach(member => {
        // reopenedAdjustmentIds is null (5th arg): the close-gate outstanding figure
        // does not re-open credits (#319), and a re-opened credit never creates a
        // shortfall anyway. owedAdjustments is the 6th arg so billed Usage Charges
        // (#320) raise owed and Service Credits (#321) lower it on this close path;
        // openingBalance is the 7th arg so the carried balance (#322) folds in too.
        const openingBalance = getHouseholdOpeningBalance(member, owedAdjustments);
        const { owed, netContribution } = getHouseholdFinancials(member, summary, payments, creditAdjustments, null, owedAdjustments, openingBalance);
        const shortfall = owed - netContribution;
        if (shortfall > CREDIT_EPSILON) total += shortfall;
    });
    return total;
}

/**
 * The carry-forward summary for the close/rollover path (#322). Thin wrapper over
 * the shared seam `buildCarryForward` (ADR 0005) so the billing-year lifecycle
 * code has one named entry point. Returns the per-household carried opening
 * balances plus an aggregate total and member count for the confirmation copy.
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {Array} [creditAdjustments]
 * @param {Array} [owedAdjustments]
 * @param {{ reopenedAdjustmentIds?: Set }} [options]
 * @returns {{ households: Array, totalOpeningBalance: number, memberCount: number }}
 */
export function buildCarryForwardSummary(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], options = {}) {
    return buildCarryForward(familyMembers, bills, payments, creditAdjustments, owedAdjustments, options);
}

/**
 * Mark a closing year's undisposed items as carried-forward, APPEND-ONLY (#322,
 * ADR 0006/0007). Given the prior year's `creditAdjustments`/`owedAdjustments`
 * and a carry summary, returns NEW arrays where:
 *
 *   - each carrying household gets one `creditAdjustments[]` record of
 *     `type: 'carry_forward'` (status `recorded`) for its carried credit — this
 *     disposes the credit on the old year exactly like a refund (it subtracts
 *     from Net Contribution via getHouseholdFinancials), so the old year stops
 *     reading it as undisposed and the gate no longer sees it; and
 *   - each still-deferred Usage Charge that carried has its `status` transitioned
 *     `deferred` → `carried_forward` (stamped `carriedForwardTo`) IN PLACE — the
 *     record is preserved, never deleted (append-only via status, mirroring the
 *     payments-ledger discipline). It drops out of the deferred/pending total.
 *
 * Pure: returns fresh arrays and record copies; does not mutate the inputs.
 * @param {Array} creditAdjustments  the prior year's credit adjustments
 * @param {Array} owedAdjustments    the prior year's owed adjustments
 * @param {{ households: Array<{ primaryMemberId: *, credit: number, deferredChargeIds: Array }> }} carry
 * @param {{ nextYearLabel: string, userId?: string|null, idFactory?: function, now?: string }} ctx
 * @returns {{ creditAdjustments: Array, owedAdjustments: Array, carriedCreditRecords: Array }}
 */
export function applyCarryForwardToPriorYear(creditAdjustments, owedAdjustments, carry, ctx = {}) {
    const nextYearLabel = ctx.nextYearLabel || null;
    const now = ctx.now || new Date().toISOString();
    const households = (carry && carry.households) || [];

    // Set of deferred-charge ids that carried, for the in-place status transition.
    const carriedChargeIds = new Set();
    households.forEach(h => (h.deferredChargeIds || []).forEach(id => carriedChargeIds.add(id)));

    const updatedOwed = (owedAdjustments || []).map(a => {
        if (a && carriedChargeIds.has(a.id)) {
            return { ...a, status: 'carried_forward', carriedForwardTo: nextYearLabel };
        }
        return a;
    });

    // One carry_forward credit record per household carrying a credit.
    const carriedCreditRecords = [];
    households.forEach((h, i) => {
        if (!(h.credit > CREDIT_EPSILON)) return;
        const id = ctx.idFactory
            ? ctx.idFactory(h, i)
            : 'cadj_carry_' + (nextYearLabel || 'next') + '_' + h.primaryMemberId;
        carriedCreditRecords.push({
            id,
            memberId: h.primaryMemberId,
            type: 'carry_forward',
            amount: h.credit,
            status: 'recorded',
            reason: 'Carried forward to ' + (nextYearLabel || 'next year'),
            toYear: nextYearLabel,
            createdAt: now
        });
    });

    return {
        creditAdjustments: [...(creditAdjustments || []), ...carriedCreditRecords],
        owedAdjustments: updatedOwed,
        carriedCreditRecords
    };
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
    if (carry && carry.memberCount > 0 && Math.abs(carry.totalOpeningBalance || 0) > CREDIT_EPSILON) {
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
 * Build the cloned data for a new billing year (members reset, bills preserved).
 * Does NOT include Firestore-specific fields (createdAt, updatedAt) — caller adds those.
 *
 * Carry-forward seeding (#322, ADR 0005/0006): when a `carry` summary (from
 * `buildCarryForwardSummary` on the prior year) is supplied, the new year is
 * seeded with one `carry_opening` record in `owedAdjustments[]` per carrying
 * household — a netted opening balance (carried credit negative, carried charge
 * positive). `getHouseholdOpeningBalance` reads these so the carried balance
 * lands in the new year's owed (its annual total) and first invoice. The seed
 * records ride the same verbatim `owedAdjustments[]` round-trip the full-document
 * save preserves, so they are never dropped. If no carry is supplied,
 * the arrays initialize empty (parity with buildSavePayload / buildInitialYearData).
 *
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Object} settings
 * @param {string} yearId
 * @param {{ households?: Array<{ primaryMemberId: *, openingBalance: number }> }} [carry]  carry-forward summary FROM the prior year
 * @param {string} [fromYearLabel]  the prior year's label (defaults to currentBillingYear-less mode: omit to tag nothing)
 * @returns {Object}
 */
export function buildNewYearData(familyMembers, bills, settings, yearId, carry = null, fromYearLabel = null) {
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

    // Seed the netted opening balance for each carrying household (#322). Seed IDs
    // are deterministic per (source year, member) so a re-run never duplicates a
    // household's opening balance, and they are visibly distinct from usage-charge
    // ('oadj_') and payment ('pay_') ids.
    const owedAdjustments = [];
    if (carry && Array.isArray(carry.households)) {
        carry.households.forEach(h => {
            if (Math.abs(h.openingBalance || 0) <= CREDIT_EPSILON) return;
            owedAdjustments.push({
                id: 'coadj_' + (fromYearLabel || 'prev') + '_' + h.primaryMemberId,
                memberId: h.primaryMemberId,
                kind: 'carry_opening',
                amount: h.openingBalance,
                status: 'carried_in',
                fromYear: fromYearLabel || null,
                createdAt: new Date().toISOString()
            });
        });
    }

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
