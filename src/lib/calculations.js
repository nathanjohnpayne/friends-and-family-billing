// Pure calculation functions — no DOM, no Firestore, no module-scoped state.
// All data is passed as parameters so these are independently testable.

/**
 * Threshold (≈ half a cent) below which an overpayment is treated as zero.
 * Distributed-payment remainders and bill-split division can leave sub-cent
 * residue; a credit at or below this is rounding noise, not money owed back.
 */
export const CREDIT_EPSILON = 0.005;

/**
 * @param {{ billingFrequency?: string, amount: number }} bill
 * @returns {number}
 */
export function getBillAnnualAmount(bill) {
    if (bill.billingFrequency === 'annual') return bill.amount;
    return bill.amount * 12;
}

/**
 * @param {{ billingFrequency?: string, amount: number }} bill
 * @returns {number}
 */
export function getBillMonthlyAmount(bill) {
    if (bill.billingFrequency === 'annual') return bill.amount / 12;
    return bill.amount;
}

/**
 * @param {Array} familyMembers
 * @param {Array} bills
 * @returns {Object} summary keyed by member ID
 */
export function calculateAnnualSummary(familyMembers, bills) {
    const summary = {};

    familyMembers.forEach(member => {
        summary[member.id] = {
            member: member,
            total: 0,
            bills: []
        };
    });

    bills.forEach(bill => {
        if (bill.members.length > 0) {
            const annualTotal = getBillAnnualAmount(bill);
            const annualPerPerson = annualTotal / bill.members.length;
            const monthlyPerPerson = annualPerPerson / 12;

            bill.members.forEach(memberId => {
                if (summary[memberId]) {
                    summary[memberId].total += annualPerPerson;
                    summary[memberId].bills.push({
                        bill: bill,
                        monthlyShare: monthlyPerPerson,
                        annualShare: annualPerPerson
                    });
                }
            });
        }
    });

    return summary;
}

/**
 * @param {Array} payments
 * @param {*} memberId
 * @returns {number}
 */
export function getPaymentTotalForMember(payments, memberId) {
    return payments
        .filter(p => p.memberId === memberId)
        .reduce((sum, p) => sum + p.amount, 0);
}

/**
 * Sum of recorded credit adjustments (refunds + carried-forward credits) for a
 * member. These leave the payments ledger and subtract from gross payments to
 * yield Net Contribution. Cancelled adjustments are excluded. Mirrors
 * getPaymentTotalForMember so household-grain math composes the same way.
 *
 * `reopenedAdjustmentIds` (optional, #319 / ADR 0003): adjustment ids whose
 * credit has been re-opened by an active, unresolved `not_received` report.
 * While the year is open these are excluded — the optimistic refund (#318) no
 * longer counts, so the credit is owed again. Omit (or pass null/empty) and the
 * function behaves exactly as before, so existing three-argument callers and the
 * Record-Payment cap are unaffected.
 *
 * @param {Array} creditAdjustments
 * @param {*} memberId
 * @param {Set<string>|null} [reopenedAdjustmentIds]
 * @returns {number}
 */
export function getCreditAdjustmentTotalForMember(creditAdjustments, memberId, reopenedAdjustmentIds = null) {
    return (creditAdjustments || [])
        .filter(a => a && a.memberId === memberId && a.status !== 'cancelled')
        .filter(a => !(reopenedAdjustmentIds && reopenedAdjustmentIds.has(a.id)))
        .reduce((sum, a) => sum + (a.amount || 0), 0);
}

/**
 * Predicate: a deferred Usage Charge for a specific member (#317).
 * A Usage Charge is a `+owed` per-member adjustment (kind `usage_charge`).
 * "deferred" means recorded and visible but NOT yet billed, so only deferred
 * charges count toward the member's pending total. Voided (append-only void via
 * status) and already-billed charges are excluded, as are credit-direction
 * adjustments (Service Credits, #321), which are a different kind.
 * @param {Object} a  an owedAdjustments[] record
 * @param {*} memberId
 * @returns {boolean}
 */
function isDeferredUsageChargeFor(a, memberId) {
    return !!a && a.memberId === memberId && a.kind === 'usage_charge' && a.status === 'deferred';
}

/**
 * Sum of a member's *deferred* Usage Charges (#317). Deferred charges are not
 * yet billed, so this is a "pending" figure that never feeds owed/credit/the
 * settlement gate — it is surfaced for transparency only.
 * @param {Array} owedAdjustments
 * @param {*} memberId
 * @returns {number}
 */
export function getDeferredUsageChargeTotalForMember(owedAdjustments, memberId) {
    return (owedAdjustments || [])
        .filter(a => isDeferredUsageChargeFor(a, memberId))
        .reduce((sum, a) => sum + (a.amount || 0), 0);
}

/**
 * Household-grain (ADR 0001) pending Usage Charge summary: the count and running
 * total of deferred charges across a primary member and their linked members.
 * Used by the settlement board to show "Pending charges: $X.XX" per household.
 * @param {{ id: *, linkedMembers?: Array }} member  the household's primary member
 * @param {Array} owedAdjustments
 * @returns {{ count: number, total: number }}
 */
export function getHouseholdDeferredCharges(member, owedAdjustments) {
    const ids = [member.id, ...((member.linkedMembers) || [])];
    const deferred = (owedAdjustments || []).filter(a => ids.some(id => isDeferredUsageChargeFor(a, id)));
    const total = deferred.reduce((sum, a) => sum + (a.amount || 0), 0);
    return { count: deferred.length, total };
}

/**
 * Predicate: a *billed* Usage Charge for a specific member (Charge Notice, #320).
 * "billed" means an off-cycle Charge Notice has invoiced the charge, so unlike a
 * deferred charge it IS now owed. Voided charges (append-only void via status) and
 * still-deferred charges are excluded.
 * @param {Object} a  an owedAdjustments[] record
 * @param {*} memberId
 * @returns {boolean}
 */
function isBilledUsageChargeFor(a, memberId) {
    return !!a && a.memberId === memberId && a.kind === 'usage_charge' && a.status === 'billed';
}

/**
 * Sum of a member's *billed* Usage Charges (#320). Once a Charge Notice bills a
 * deferred charge it becomes present-tense money that raises owed (ADR 0005), so
 * this addend feeds the household's owed in getHouseholdFinancials — the mirror of
 * getDeferredUsageChargeTotalForMember, which deliberately does not.
 * @param {Array} owedAdjustments
 * @param {*} memberId
 * @returns {number}
 */
export function getBilledUsageChargeTotalForMember(owedAdjustments, memberId) {
    return (owedAdjustments || [])
        .filter(a => isBilledUsageChargeFor(a, memberId))
        .reduce((sum, a) => sum + (a.amount || 0), 0);
}

/**
 * @param {Array} payments
 * @param {*} memberId
 * @returns {Array}
 */
export function getMemberPayments(payments, memberId) {
    return payments
        .filter(p => p.memberId === memberId)
        .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}

/**
 * @param {Array} familyMembers
 * @param {*} memberId
 * @returns {boolean}
 */
export function isLinkedToAnyone(familyMembers, memberId) {
    return familyMembers.some(m => m.linkedMembers.includes(memberId));
}

/**
 * @param {Array} familyMembers
 * @param {*} memberId
 * @returns {Object|undefined}
 */
export function getParentMember(familyMembers, memberId) {
    return familyMembers.find(m => m.linkedMembers.includes(memberId));
}

/**
 * Settlement financials for one household, computed at the household grain
 * (ADR 0001): a primary member plus their linked members settle as one unit.
 * Owed, gross paid, and recorded credit adjustments are summed across the whole
 * household before differencing, so internal imbalance between members (one over,
 * one under) nets out and never surfaces as a household credit.
 *
 *   Net Contribution = gross paid − recorded refunds/carried-forward credits
 *   Credit           = max(0, Net Contribution − owed), sub-cent residue zeroed
 *
 * Invariant: in valid states a household's recorded dispositions (refunds +
 * carry-forwards) are capped at its credit, enforced at the mutation/import
 * boundary by later slices, so netContribution >= owed and a settled household
 * never reads as underpaid. The settlement board and metrics nonetheless derive
 * every figure (status, balance, the Record-Payment gate, outstanding totals)
 * from netContribution, so an over-disposition degrades to an honest collectable
 * shortfall rather than splitting status from balance.
 *
 * Billed Usage Charges (#320, optional trailing arg) add to owed at the household
 * grain: once a Charge Notice bills a deferred charge it is present-tense money, so
 * unpaid → the household carries a collectable balance → Outstanding → blocks close.
 * Still-deferred charges are NOT passed through here (they never raise owed). The
 * arg is optional and defaults to empty, so every existing 4-arg caller is
 * unaffected (the #316 additive pattern).
 *
 * @param {{ id: *, linkedMembers?: Array }} member  the household's primary member
 * @param {Object} summary  output of calculateAnnualSummary (owed per member)
 * @param {Array} payments
 * @param {Array} [creditAdjustments]
 * @param {Set<string>|null} [reopenedAdjustmentIds]  adjustment ids re-opened by an
 *   active not_received (#319, ADR 0003); excluded so the credit is owed again
 * @param {Array} [owedAdjustments]  Usage Charges (#317/#320); only BILLED ones add to owed
 * @returns {{ owed: number, grossPaid: number, creditAdjustmentTotal: number, billedChargeTotal: number, netContribution: number, credit: number }}
 */
export function getHouseholdFinancials(member, summary, payments, creditAdjustments = [], reopenedAdjustmentIds = null, owedAdjustments = []) {
    const linkedIds = member.linkedMembers || [];

    let owed = summary[member.id] ? summary[member.id].total : 0;
    linkedIds.forEach(id => { if (summary[id]) owed += summary[id].total; });

    // Billed Usage Charges raise owed at the household grain (ADR 0001, #320).
    const billedChargeTotal = getBilledUsageChargeTotalForMember(owedAdjustments, member.id)
        + linkedIds.reduce((s, id) => s + getBilledUsageChargeTotalForMember(owedAdjustments, id), 0);
    owed += billedChargeTotal;

    const grossPaid = getPaymentTotalForMember(payments, member.id)
        + linkedIds.reduce((s, id) => s + getPaymentTotalForMember(payments, id), 0);

    const creditAdjustmentTotal = getCreditAdjustmentTotalForMember(creditAdjustments, member.id, reopenedAdjustmentIds)
        + linkedIds.reduce((s, id) => s + getCreditAdjustmentTotalForMember(creditAdjustments, id, reopenedAdjustmentIds), 0);

    const netContribution = grossPaid - creditAdjustmentTotal;
    const rawCredit = netContribution - owed;
    const credit = rawCredit > CREDIT_EPSILON ? rawCredit : 0;

    return { owed, grossPaid, creditAdjustmentTotal, billedChargeTotal, netContribution, credit };
}

/**
 * Billed Usage Charges (#320, optional trailing arg) raise each household's owed,
 * so an unpaid billed charge becomes Outstanding and blocks close (ADR 0006), while
 * still-deferred charges stay out of the gate. The arg defaults to empty, so every
 * existing 4-arg caller is unaffected (the #316 additive pattern).
 *
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {Array} [creditAdjustments]  refunds + carried-forward credits (#316)
 * @param {Set<string>|null} [reopenedAdjustmentIds]  adjustment ids re-opened by an
 *   active not_received (#319, ADR 0003); raises Net Contribution back so the
 *   household credit (totalCreditsOwed) is owed again while the year is open.
 *   Outstanding is unaffected — a re-opened credit is overpayment owed back, never
 *   underpayment — so it never inflates settlement progress.
 * @param {Array} [owedAdjustments]  Usage Charges (#317/#320); only BILLED ones raise owed
 * @returns {{ totalAnnual: number, totalPayments: number, totalOutstanding: number, totalCreditsOwed: number, paidCount: number, totalMembers: number, percentage: number }}
 */
export function calculateSettlementMetrics(familyMembers, bills, payments, creditAdjustments = [], reopenedAdjustmentIds = null, owedAdjustments = []) {
    const summary = calculateAnnualSummary(familyMembers, bills);
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));

    let totalAnnual = 0;
    let totalPayments = 0;
    let totalOutstanding = 0;
    let totalCreditsOwed = 0;
    let paidCount = 0;

    mainMembers.forEach(member => {
        const { owed, grossPaid, netContribution, credit } =
            getHouseholdFinancials(member, summary, payments, creditAdjustments, reopenedAdjustmentIds, owedAdjustments);
        totalAnnual += owed;
        totalPayments += grossPaid;
        totalCreditsOwed += credit;
        // Outstanding is the sum of per-household NET shortfalls, not a global gross
        // difference. A refund leaves the ledger, so it must not offset another
        // household's debt, and one household's overpayment must not mask another's
        // shortfall. With no adjustments netContribution === grossPaid, so for a
        // household that is underpaid this equals the prior gross shortfall.
        const shortfall = owed - netContribution;
        if (shortfall > CREDIT_EPSILON) totalOutstanding += shortfall;
        // Settled = not underpaid beyond a sub-cent tolerance (shortfall <= epsilon).
        // Overpaid households satisfy this too (their credit is tracked separately).
        if (owed <= 0 || netContribution >= owed - CREDIT_EPSILON) paidCount++;
    });

    // Progress = the share of total owed that is net-satisfied (totalAnnual − the
    // net shortfall), so returned money never counts as settlement progress.
    const percentage = totalAnnual > 0
        ? Math.max(0, Math.min(100, Math.round(((totalAnnual - totalOutstanding) / totalAnnual) * 100)))
        : 0;

    return {
        totalAnnual: totalAnnual,
        totalPayments: totalPayments,
        totalOutstanding: totalOutstanding,
        totalCreditsOwed: totalCreditsOwed,
        paidCount: paidCount,
        totalMembers: mainMembers.length,
        percentage: percentage
    };
}
