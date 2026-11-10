// Pure calculation functions — no DOM, no Firestore, no module-scoped state.
// All data is passed as parameters so these are independently testable.

import { projectHouseholdMoney, buildCarryMoneySnapshot, snapshotDollars } from './household-money.js';
import { MoneyIntegrityError, rational, quantizeDollarsToCents } from './money.js';

/**
 * Coerce an adjustment amount and add it to a running sum only when it is a
 * finite, positive number. A malformed amount (a string, NaN, Infinity, a
 * negative, or a missing field) is dropped rather than coerced into the total —
 * `sum + (a.amount || 0)` would turn `'5'` into string concatenation and let a
 * negative silently reduce a magnitude that is stored as a positive. Adjustment
 * amounts are always positive magnitudes (the sign is applied by the consumer),
 * so this is a pure defensive guard against bad persisted data.
 * @param {number} sum
 * @param {*} amount
 * @returns {number}
 */
function addFinitePositiveAmount(sum, amount) {
    const n = Number.parseFloat(amount);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
}

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
 * Legacy raw member/audit total; never household settlement authority.
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
 * Legacy raw per-member audit total with existing cancellation/reopening rules.
 * Household financial authority reads exact source components directly instead.
 */
export function getCreditAdjustmentTotalForMember(creditAdjustments, memberId, reopenedAdjustmentIds = null) {
    return (creditAdjustments || [])
        .filter(a => a && a.memberId === memberId && a.status !== 'cancelled')
        .filter(a => !(reopenedAdjustmentIds && reopenedAdjustmentIds.has(a.id)))
        .reduce((sum, a) => sum + (a.amount || 0), 0);
}

/**
 * Predicate: an active recorded Refund for a specific member (#318, ADR 0003).
 * A Refund is a `type: 'refund'` creditAdjustment; "active" is `status !== 'cancelled'`,
 * the same active test getCreditAdjustmentTotalForMember applies (a cancelled refund no
 * longer counts). Carried-forward credits (`type: 'carry_forward'`, #316) share the
 * array but are a different type and excluded — only a true refund is relevant here.
 * @param {Object} a  a creditAdjustments[] record
 * @param {*} memberId
 * @returns {boolean}
 */
function isActiveRefundFor(a, memberId) {
    return !!a && a.memberId === memberId && a.type === 'refund' && a.status !== 'cancelled';
}

/**
 * Household-grain (ADR 0001) recorded-Refund summary: whether the household holds an
 * active Refund and the running total of those refunds, summed across a primary member
 * and their linked members. Refunds are always issued to the primary
 * (BillingYearService.issueRefund), but linked ids are checked too so the household
 * grain holds regardless of where a refund is recorded. Mirrors getHouseholdDeferredCharges.
 *
 * Drives the non-blocking warning shown when an admin reverses a payment for a refunded
 * household (#331): reversing lowers gross paid → Net Contribution drops → the household
 * flips to Outstanding, while the refund stays on the books (append-only, never
 * auto-clawed-back). This is pure display — it has no effect on owed, credit, the
 * settlement gate, or any mutation.
 *
 * `total` is summed through addFinitePositiveAmount (as getServiceCreditTotalForMember /
 * getBilledUsageChargeTotalForMember do), so a malformed persisted amount (a string,
 * NaN, negative, or missing) is dropped rather than leaking a `NaN`/string into the
 * warning copy. `has` keys off the existence of an active refund record, independent of
 * amount validity, so the warning still fires for a refund whose amount is unparseable.
 * @param {{ id: *, linkedMembers?: Array }} member  the household's primary member
 * @param {Array} creditAdjustments
 * @returns {{ has: boolean, total: number }}
 */
export function getHouseholdRecordedRefund(member, creditAdjustments) {
    if (!member) return { has: false, total: 0 };
    const ids = [member.id, ...((member.linkedMembers) || [])];
    const refunds = (creditAdjustments || []).filter(a => ids.some(id => isActiveRefundFor(a, id)));
    const total = refunds.reduce((sum, a) => addFinitePositiveAmount(sum, a.amount), 0);
    return { has: refunds.length > 0, total };
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

/** Legacy invoice/public-display sum; not authenticated financial authority. */
export function getServiceCreditTotalForMember(owedAdjustments, memberId) {
    return (owedAdjustments || [])
        .filter(a => isActiveServiceCreditFor(a, memberId))
        .reduce((sum, a) => addFinitePositiveAmount(sum, a.amount), 0);
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

/** Legacy per-member display sum; exact household B is projected independently. */
export function getBilledUsageChargeTotalForMember(owedAdjustments, memberId) {
    return (owedAdjustments || [])
        .filter(a => isBilledUsageChargeFor(a, memberId))
        .reduce((sum, a) => addFinitePositiveAmount(sum, a.amount), 0);
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
 * Exact settlement authority over the complete raw five-array year source.
 * Reopening only affects admitted R records; U is never a refundable credit.
 * Success exposes integer cents plus checked dollar aliases for existing UI.
 * Failure exposes private diagnostics and identity, with no money or source rows.
 */
export function getFinancialSourceHolds(source, householdId = null) {
    return ['familyMembers', 'bills', 'payments', 'creditAdjustments', 'owedAdjustments']
        .filter(field => !Array.isArray(source?.[field])).map(field => ({ householdId,
            code: 'INVALID_SOURCE', component: 'source', recordId: null, field,
            observedType: typeof source?.[field], message: 'Complete raw year collections are required' }));
}

/** Project one household without reconstructing source from member display totals. */
export function getHouseholdFinancials(member, source, { reopenedAdjustmentIds = null } = {}) {
    const holds = getFinancialSourceHolds(source, member.id);
    if (holds.length) return { ok: false, householdId: member.id, holds };
    const result = projectHouseholdMoney(source, member, { reopenedAdjustmentIds });
    if (!result.ok) return result;
    try {
        const fields = { grossOwed: result.G, serviceCreditTotal: result.S, grossPaid: result.P,
            creditAdjustmentTotal: result.R, billedChargeTotal: result.B, netContribution: result.N,
            owed: result.owed, balance: result.balance, credit: result.credit };
        return { ok: true, householdId: member.id,
            cents: Object.fromEntries(['G', 'S', 'O', 'P', 'R', 'B', 'N', 'invoice', 'owed', 'balance', 'credit', 'U', 'deferredCents'].map(field => [field, result[field]])),
            ...Object.fromEntries(Object.entries(fields).map(([field, cents]) => [field, snapshotDollars(cents, member.id)])) };
    } catch (error) {
        if (!(error instanceof MoneyIntegrityError)) throw error;
        return { ok: false, householdId: member.id, holds: [{ householdId: member.id, code: error.code,
            component: 'composition', recordId: member.id, field: 'amount', observedType: 'number', message: error.message }] };
    }
}

/** Exact sum at aggregate boundaries; safe households need not imply a safe year total. */
export function sumMoneyCents(values) {
    return quantizeDollarsToCents(rational(values.reduce((sum, value) => sum + BigInt(value), 0n), 100n));
}

/**
 * Household-grain (ADR 0001) carried-forward opening balance for the *current*
 * year: the sum of `carry_opening` seed records (#322) across a primary member
 * and their linked members. A carried credit is stored negative (owe less) and a
 * carried charge positive (owe more); they net to one number. These seed records
 * live in `owedAdjustments[]` with `kind: 'carry_opening'` and `status:
 * 'carried_in'`, distinct from deferred Usage Charges (which are pending and
 * surfaced separately, never as an opening balance).
 * @param {{ id: *, linkedMembers?: Array }} member  the household's primary member
 * @param {Array} owedAdjustments
 * @returns {number}
 */
export function getHouseholdOpeningBalance(member, owedAdjustments) {
    const ids = [member.id, ...((member.linkedMembers) || [])];
    return (owedAdjustments || [])
        .filter(a => a && a.kind === 'carry_opening' && a.status !== 'voided' && ids.includes(a.memberId))
        .reduce((sum, a) => sum + (a.amount || 0), 0);
}

/**
 * Finalize one detached whole-year carry plan using actual disposition ids before
 * validation. Markings, stored seeds and display aliases all consume this plan.
 * Legacy seeds omit zero net amounts; itemized review seeds retain their detail.
 */
export function buildCarryForward(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], options = {}) {
    const source = { familyMembers, bills, payments, creditAdjustments, owedAdjustments };
    const holds = getFinancialSourceHolds(source);
    if (holds.length) return { ok: false, households: [], holds };
    const plan = buildCarryMoneySnapshot(source,
        { fromYearLabel: 'prev', nextYearLabel: 'next', ...options });
    if (!plan.ok) return plan;
    try {
        return { ...plan, households: plan.households.filter(h => h.seed).map(h => ({ ...h,
            primaryMemberId: h.householdId, credit: snapshotDollars(h.credit, h.householdId),
            deferredChargeTotal: snapshotDollars(h.deferredCents, h.householdId),
            unusedOpeningCredit: snapshotDollars(h.unusedOpeningCreditCents, h.householdId),
            openingBalance: snapshotDollars(h.openingBalanceCents, h.householdId),
            ...(options.itemized ? { items: structuredClone(h.seed.items) } : {}) })),
            totalOpeningBalance: snapshotDollars(plan.totalOpeningBalanceCents, 'year'),
            memberCount: plan.households.filter(h => h.seed).length };
    } catch (error) {
        if (!(error instanceof MoneyIntegrityError)) throw error;
        return { ok: false, households: [], holds: [{ householdId: null, code: error.code,
            component: 'carry-total', recordId: null, field: 'amount', observedType: 'number', message: error.message }] };
    }
}

/** Round the clamped satisfied/annual ratio exactly to the nearest whole percent. */
function settlementPercentage(annualCents, outstandingCents) {
    if (annualCents <= 0) return 0;
    const annual = BigInt(annualCents);
    const satisfied = annual - BigInt(outstandingCents);
    if (satisfied <= 0n) return 0;
    if (satisfied >= annual) return 100;
    return Number((satisfied * 200n + annual) / (annual * 2n));
}

/**
 * Aggregate checked household cents, preserving structural counts on a hold.
 * A positive cent balance is outstanding even when the household's owed is zero.
 * Unsafe year totals withhold aggregates without inventing a held household.
 */
export function calculateSettlementMetrics(familyMembers, bills, payments, creditAdjustments = [], reopenedAdjustmentIds = null, owedAdjustments = []) {
    const source = { familyMembers, bills, payments, creditAdjustments, owedAdjustments };
    if (!Array.isArray(familyMembers)) return { ok: false, households: [], totalMembers: 0, paidCount: 0, needsCorrectionCount: 0, holds: getFinancialSourceHolds(source) };
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));
    const households = mainMembers.map(member => getHouseholdFinancials(member, source, { reopenedAdjustmentIds }));
    const valid = households.filter(row => row.ok);
    const structure = { households, totalMembers: mainMembers.length,
        paidCount: valid.filter(row => row.cents.balance <= 0).length,
        needsCorrectionCount: households.length - valid.length };
    if (valid.length !== households.length) return { ok: false, ...structure, holds: households.flatMap(row => row.holds || []) };
    try {
        const cents = { totalAnnual: sumMoneyCents(valid.map(row => row.cents.owed)),
            totalPayments: sumMoneyCents(valid.map(row => row.cents.P)),
            totalOutstanding: sumMoneyCents(valid.map(row => Math.max(0, row.cents.balance))),
            totalCreditsOwed: sumMoneyCents(valid.map(row => row.cents.credit)) };
        return { ok: true, ...structure, cents,
            ...Object.fromEntries(Object.entries(cents).map(([field, value]) => [field, snapshotDollars(value, 'year')])),
            percentage: settlementPercentage(cents.totalAnnual, cents.totalOutstanding) };
    } catch (error) {
        if (!(error instanceof MoneyIntegrityError)) throw error;
        return { ok: false, ...structure, holds: [{ householdId: null, code: error.code,
            component: 'aggregate', recordId: null, field: 'amount', observedType: 'number', message: error.message }] };
    }
}
