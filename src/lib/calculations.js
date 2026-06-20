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
 * @param {Array} creditAdjustments
 * @param {*} memberId
 * @returns {number}
 */
export function getCreditAdjustmentTotalForMember(creditAdjustments, memberId) {
    return (creditAdjustments || [])
        .filter(a => a && a.memberId === memberId && a.status !== 'cancelled')
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
 * Predicate: an active Service Credit for a specific member (#321, ADR 0005).
 * A Service Credit is the `−owed` mirror of a Usage Charge — a bill-level
 * reduction recorded per-member (kind `service_credit`). Its `amount` is stored
 * as a positive magnitude; the sign (subtraction from owed) is applied by the
 * consumer. Unlike a deferred Usage Charge it takes effect immediately, so only
 * `active` records reduce owed; voided ones (append-only void via status) are
 * excluded, as is the `+owed` Usage Charge direction (a different kind).
 * @param {Object} a  an owedAdjustments[] record
 * @param {*} memberId
 * @returns {boolean}
 */
function isActiveServiceCreditFor(a, memberId) {
    return !!a && a.memberId === memberId && a.kind === 'service_credit' && a.status === 'active';
}

/**
 * Sum of a member's *active* Service Credits (#321) as a positive magnitude.
 * This figure is subtracted from the member's owed by getHouseholdFinancials, so
 * a paid household's reduced owed surfaces as a Credit on the existing
 * refund/carry axis (no new disposition path). Mirrors
 * getDeferredUsageChargeTotalForMember / getCreditAdjustmentTotalForMember so the
 * household-grain math composes the same way.
 * @param {Array} owedAdjustments
 * @param {*} memberId
 * @returns {number}
 */
export function getServiceCreditTotalForMember(owedAdjustments, memberId) {
    return (owedAdjustments || [])
        .filter(a => isActiveServiceCreditFor(a, memberId))
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
 *   owed             = bill-derived owed − active Service Credits, floored at 0
 *   Net Contribution = gross paid − recorded refunds/carried-forward credits
 *   Credit           = max(0, Net Contribution − owed), sub-cent residue zeroed
 *
 * Service Credits (#321, ADR 0005) are the `−owed` direction of owedAdjustments[]:
 * an active service_credit LOWERS the affected members' owed. When the household
 * has already paid (Net Contribution now exceeds the reduced owed) the surplus
 * surfaces as a Credit on the EXISTING refund/carry axis above — no new
 * disposition path. owed is floored at 0 so an over-large credit becomes a Credit
 * rather than negative debt. Deferred Usage Charges in the same array are NOT
 * applied here (they are `+owed` but not yet billed); only active Service Credits
 * feed owed. Passing owedAdjustments is optional and defaults to empty, so every
 * existing four-argument caller is unaffected.
 *
 * Invariant: in valid states a household's recorded dispositions (refunds +
 * carry-forwards) are capped at its credit, enforced at the mutation/import
 * boundary by later slices, so netContribution >= owed and a settled household
 * never reads as underpaid. The settlement board and metrics nonetheless derive
 * every figure (status, balance, the Record-Payment gate, outstanding totals)
 * from netContribution, so an over-disposition degrades to an honest collectable
 * shortfall rather than splitting status from balance.
 *
 * @param {{ id: *, linkedMembers?: Array }} member  the household's primary member
 * @param {Object} summary  output of calculateAnnualSummary (owed per member)
 * @param {Array} payments
 * @param {Array} [creditAdjustments]
 * @param {Array} [owedAdjustments]  Usage Charges (+owed, ignored here) and Service Credits (−owed, applied)
 * @returns {{ owed: number, grossOwed: number, serviceCreditTotal: number, grossPaid: number, creditAdjustmentTotal: number, netContribution: number, credit: number }}
 */
export function getHouseholdFinancials(member, summary, payments, creditAdjustments = [], owedAdjustments = []) {
    const linkedIds = member.linkedMembers || [];

    let grossOwed = summary[member.id] ? summary[member.id].total : 0;
    linkedIds.forEach(id => { if (summary[id]) grossOwed += summary[id].total; });

    const serviceCreditTotal = getServiceCreditTotalForMember(owedAdjustments, member.id)
        + linkedIds.reduce((s, id) => s + getServiceCreditTotalForMember(owedAdjustments, id), 0);

    // A Service Credit lowers owed; owed never goes below zero (an over-large
    // credit surfaces as a Credit on the netContribution axis, not negative debt).
    const owed = Math.max(0, grossOwed - serviceCreditTotal);

    const grossPaid = getPaymentTotalForMember(payments, member.id)
        + linkedIds.reduce((s, id) => s + getPaymentTotalForMember(payments, id), 0);

    const creditAdjustmentTotal = getCreditAdjustmentTotalForMember(creditAdjustments, member.id)
        + linkedIds.reduce((s, id) => s + getCreditAdjustmentTotalForMember(creditAdjustments, id), 0);

    const netContribution = grossPaid - creditAdjustmentTotal;
    const rawCredit = netContribution - owed;
    const credit = rawCredit > CREDIT_EPSILON ? rawCredit : 0;

    return { owed, grossOwed, serviceCreditTotal, grossPaid, creditAdjustmentTotal, netContribution, credit };
}

/**
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {Array} [creditAdjustments]  refunds + carried-forward credits (#316)
 * @param {Array} [owedAdjustments]  Service Credits (−owed, #321) lower owed; deferred Usage Charges are ignored
 * @returns {{ totalAnnual: number, totalPayments: number, totalOutstanding: number, totalCreditsOwed: number, paidCount: number, totalMembers: number, percentage: number }}
 */
export function calculateSettlementMetrics(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = []) {
    const summary = calculateAnnualSummary(familyMembers, bills);
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));

    let totalAnnual = 0;
    let totalPayments = 0;
    let totalOutstanding = 0;
    let totalCreditsOwed = 0;
    let paidCount = 0;

    mainMembers.forEach(member => {
        // `owed` here is the post-Service-Credit owed (#321), so totalAnnual reflects
        // what is actually owed after bill-level reductions, and a paid household whose
        // owed dropped below its Net Contribution surfaces a credit on the existing axis.
        const { owed, grossPaid, netContribution, credit } =
            getHouseholdFinancials(member, summary, payments, creditAdjustments, owedAdjustments);
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
