// Private availability boundary over the complete exact household authority.
import { calculateSettlementMetrics, getFinancialSourceHolds, getHouseholdFinancials } from './calculations.js';

export const FINANCIAL_UNAVAILABLE = 'Financial data unavailable';
export const FINANCIAL_CORRECTION = 'Correct the affected record before settling this household.';

/** Read the existing producer seam, retaining only availability and identity. */
function read(member, source, options = {}) {
    const result = getHouseholdFinancials(member, source, options);
    return { householdId: member.id, available: result.ok !== false,
        holdCount: result.ok === false ? (result.holds || []).length : 0 };
}

/** No money, source diagnostics or allocation keys cross this UI boundary. */
export function getYearFinancialAvailability(source, options = {}) {
    const sourceHolds = getFinancialSourceHolds(source);
    const members = Array.isArray(source?.familyMembers) ? source.familyMembers : [];
    const households = members.filter(member => !members.some(row => row.linkedMembers?.includes(member.id)))
        .map(member => read(member, source, options));
    const metrics = sourceHolds.length ? null : calculateSettlementMetrics(source.familyMembers, source.bills, source.payments,
        source.creditAdjustments, options.reopenedAdjustmentIds ?? null, source.owedAdjustments);
    const needsCorrectionCount = households.filter(row => !row.available).length;
    return { available: !sourceHolds.length && !needsCorrectionCount && metrics.ok, households, needsCorrectionCount,
        yearHoldCount: sourceHolds.length || (metrics?.holds || []).filter(row => row.householdId == null).length };
}

/** Linked-member invoice entry points use their primary household's signal. */
export function getHouseholdFinancialAvailability(source, memberId, options = {}) {
    const sourceHolds = getFinancialSourceHolds(source, memberId);
    if (sourceHolds.length) return { householdId: memberId, available: false, holdCount: sourceHolds.length };
    const members = source.familyMembers;
    const member = members.find(row => (row.linkedMembers || []).includes(memberId))
        || members.find(row => row.id === memberId);
    // A stale or removed member cannot authorize a financial entry point.
    if (!member) return { householdId: memberId, available: false, holdCount: 1 };
    return read(member, source, options);
}

/** Refuse year-wide close/rollover before a queue entry or persistence side effect. */
export function assertYearFinanciallyAvailable(source) {
    const availability = getYearFinancialAvailability(source);
    if (!availability.available) throw new Error(FINANCIAL_UNAVAILABLE + '. ' + FINANCIAL_CORRECTION);
}

/** Fail before any write while retaining private diagnostics for local audit. */
export function requireFinancialAvailability(result) {
    if (!result?.ok) {
        const error = new Error(FINANCIAL_UNAVAILABLE + '. ' + FINANCIAL_CORRECTION);
        error.holds = result?.holds || result?.households?.flatMap(row => row.holds || []) || [];
        throw error;
    }
    return result;
}
