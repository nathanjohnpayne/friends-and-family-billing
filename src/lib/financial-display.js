// Private authenticated presentation over the shared authority. Never a public payload.
import { projectHouseholdMoney, snapshotDollars } from './household-money.js';
import { getFinancialSourceHolds, sumMoneyCents } from './calculations.js';
import { MoneyIntegrityError } from './money.js';

/** Strip source evidence and all money at an unavailable renderer boundary. */
export function financialUnavailable(householdId = null) {
    const identity = Number.isSafeInteger(householdId) || (typeof householdId === 'string' && householdId.trim()) ? householdId : null;
    return { ok: false, kind: 'financial-unavailable', householdId: identity };
}

/** Keep existing Annual and ordinary-invoice scopes distinct from settlement owed. */
export function projectHouseholdDisplay(source, member, options = {}) {
    if (!member || getFinancialSourceHolds(source, member.id).length) return financialUnavailable(member?.id);
    const projected = projectHouseholdMoney(source, member, options);
    if (!projected.ok) return financialUnavailable(member.id);
    try {
        const cents = { ...Object.fromEntries(['G', 'S', 'O', 'P', 'R', 'B', 'N', 'invoice', 'owed', 'balance', 'credit', 'deferredCents']
            .map(field => [field, projected[field]])),
            annual: Math.max(0, sumMoneyCents([projected.G, projected.O])),
            invoiceBalance: sumMoneyCents([projected.invoice, -projected.N]) };
        return { ok: true, householdId: member.id, cents, rows: projected.rows,
            ...Object.fromEntries(Object.entries(cents).map(([field, value]) => [field, snapshotDollars(value, member.id)])) };
    } catch (error) {
        if (!(error instanceof MoneyIntegrityError)) throw error;
        return financialUnavailable(member.id);
    }
}
