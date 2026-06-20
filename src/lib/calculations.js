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
 * @param {{ id: *, linkedMembers?: Array }} member  the household's primary member
 * @param {Object} summary  output of calculateAnnualSummary (owed per member)
 * @param {Array} payments
 * @param {Array} [creditAdjustments]
 * @param {Set<string>|null} [reopenedAdjustmentIds]  adjustment ids re-opened by an
 *   active not_received (#319, ADR 0003); excluded so the credit is owed again
 * @returns {{ owed: number, grossPaid: number, creditAdjustmentTotal: number, netContribution: number, credit: number }}
 */
export function getHouseholdFinancials(member, summary, payments, creditAdjustments = [], reopenedAdjustmentIds = null) {
    const linkedIds = member.linkedMembers || [];

    let owed = summary[member.id] ? summary[member.id].total : 0;
    linkedIds.forEach(id => { if (summary[id]) owed += summary[id].total; });

    const grossPaid = getPaymentTotalForMember(payments, member.id)
        + linkedIds.reduce((s, id) => s + getPaymentTotalForMember(payments, id), 0);

    const creditAdjustmentTotal = getCreditAdjustmentTotalForMember(creditAdjustments, member.id, reopenedAdjustmentIds)
        + linkedIds.reduce((s, id) => s + getCreditAdjustmentTotalForMember(creditAdjustments, id, reopenedAdjustmentIds), 0);

    const netContribution = grossPaid - creditAdjustmentTotal;
    const rawCredit = netContribution - owed;
    const credit = rawCredit > CREDIT_EPSILON ? rawCredit : 0;

    return { owed, grossPaid, creditAdjustmentTotal, netContribution, credit };
}

/**
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {Array} [creditAdjustments]  refunds + carried-forward credits (#316)
 * @param {Set<string>|null} [reopenedAdjustmentIds]  adjustment ids re-opened by an
 *   active not_received (#319, ADR 0003); raises Net Contribution back so the
 *   household credit (totalCreditsOwed) is owed again while the year is open.
 *   Outstanding is unaffected — a re-opened credit is overpayment owed back, never
 *   underpayment — so it never inflates settlement progress.
 * @returns {{ totalAnnual: number, totalPayments: number, totalOutstanding: number, totalCreditsOwed: number, paidCount: number, totalMembers: number, percentage: number }}
 */
export function calculateSettlementMetrics(familyMembers, bills, payments, creditAdjustments = [], reopenedAdjustmentIds = null) {
    const summary = calculateAnnualSummary(familyMembers, bills);
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));

    let totalAnnual = 0;
    let totalPayments = 0;
    let totalOutstanding = 0;
    let totalCreditsOwed = 0;
    let paidCount = 0;

    mainMembers.forEach(member => {
        const { owed, grossPaid, netContribution, credit } =
            getHouseholdFinancials(member, summary, payments, creditAdjustments, reopenedAdjustmentIds);
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
