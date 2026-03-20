// Pure calculation functions — no DOM, no Firestore, no module-scoped state.
// All data is passed as parameters so these are independently testable.

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
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @returns {{ totalAnnual: number, totalPayments: number, totalOutstanding: number, paidCount: number, totalMembers: number, percentage: number }}
 */
export function calculateSettlementMetrics(familyMembers, bills, payments) {
    const summary = calculateAnnualSummary(familyMembers, bills);
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));

    let totalAnnual = 0;
    let totalPayments = 0;
    let paidCount = 0;

    mainMembers.forEach(member => {
        let combinedTotal = summary[member.id] ? summary[member.id].total : 0;
        (member.linkedMembers || []).forEach(id => {
            if (summary[id]) combinedTotal += summary[id].total;
        });
        const payment = getPaymentTotalForMember(payments, member.id) +
            (member.linkedMembers || []).reduce((s, id) => s + getPaymentTotalForMember(payments, id), 0);
        totalAnnual += combinedTotal;
        totalPayments += payment;
        if (combinedTotal <= 0 || payment >= combinedTotal) paidCount++;
    });

    const totalOutstanding = Math.max(0, totalAnnual - totalPayments);
    const percentage = totalAnnual > 0 ? Math.min(100, Math.round((totalPayments / totalAnnual) * 100)) : 0;

    return {
        totalAnnual: totalAnnual,
        totalPayments: totalPayments,
        totalOutstanding: totalOutstanding,
        paidCount: paidCount,
        totalMembers: mainMembers.length,
        percentage: percentage
    };
}
