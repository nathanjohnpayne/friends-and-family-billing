// Private consumer bridge for #634. The legacy producer does not emit holds yet.
// Never infer a hold from raw data here or activate the exact-money adapter.
import { calculateAnnualSummary, getHouseholdFinancials, getHouseholdOpeningBalance, isLinkedToAnyone } from './calculations.js';

export const FINANCIAL_UNAVAILABLE = 'Financial data unavailable';
export const FINANCIAL_CORRECTION = 'Correct the affected record before settling this household.';

/** Read the existing producer seam, retaining only availability and identity. */
function read(member, source, summary, { reopenedAdjustmentIds = null } = {}) {
    const result = getHouseholdFinancials(member, summary, source.payments || [], source.creditAdjustments || [],
        reopenedAdjustmentIds, source.owedAdjustments || [], getHouseholdOpeningBalance(member, source.owedAdjustments || []));
    return { householdId: member.id, available: result.ok !== false,
        holdCount: result.ok === false ? (result.holds || []).length : 0 };
}

/** No money, source diagnostics or allocation keys cross this UI boundary. */
export function getYearFinancialAvailability(source, options = {}) {
    const members = source.familyMembers || [];
    const summary = calculateAnnualSummary(members, source.bills || []);
    const households = members.filter(member => !isLinkedToAnyone(members, member.id))
        .map(member => read(member, source, summary, options));
    return { households, needsCorrectionCount: households.filter(row => !row.available).length };
}

/** Linked-member invoice entry points use their primary household's signal. */
export function getHouseholdFinancialAvailability(source, memberId, options = {}) {
    const members = source.familyMembers || [];
    const member = members.find(row => (row.linkedMembers || []).includes(memberId))
        || members.find(row => row.id === memberId);
    // Missing-member behavior stays with the existing caller's validation.
    if (!member) return { householdId: memberId, available: true, holdCount: 0 };
    return read(member, source, calculateAnnualSummary(members, source.bills || []), options);
}

export function assertYearFinanciallyAvailable(source) {
    if (getYearFinancialAvailability(source).needsCorrectionCount) {
        throw new Error(FINANCIAL_UNAVAILABLE + '. ' + FINANCIAL_CORRECTION);
    }
}
