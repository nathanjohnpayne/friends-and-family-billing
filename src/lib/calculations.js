// Pure calculation functions — no DOM, no Firestore, no module-scoped state.
// All data is passed as parameters so these are independently testable.

/**
 * Threshold (≈ half a cent) below which an overpayment is treated as zero.
 * Distributed-payment remainders and bill-split division can leave sub-cent
 * residue; a credit at or below this is rounding noise, not money owed back.
 */
export const CREDIT_EPSILON = 0.005;

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
 * Billed Usage Charges (#320, owedAdjustments) add to owed at the household grain:
 * once a Charge Notice bills a deferred charge it is present-tense money, so
 * unpaid → the household carries a collectable balance → Outstanding → blocks close.
 * Still-deferred charges are NOT applied here (they never raise owed).
 *
 * Opening balance (#322, ADR 0005/0006): a household's next year is seeded with
 * a single netted carry-forward `openingBalance` (a carried credit is negative
 * and lowers owed; a carried charge is positive and raises owed). It is an
 * additive modifier of the bill-derived owed, defaulting to 0 so every existing
 * call is unchanged. The bill-derived owed (after Service Credits and the opening
 * balance) is floored at 0 so neither an over-large Service Credit nor a carried
 * credit can make the bills owe the member money — any excess surfaces through the
 * normal credit path once payments land, not as negative owed. Billed Usage
 * Charges are then added on top of that floored figure (#320 is real owed, never
 * cancelled by a credit/carry).
 *
 * Both owedAdjustments (6th) and openingBalance (7th) are optional and default to
 * empty/0, so every existing 4-arg caller is unaffected (the #316 additive pattern).
 *
 * @param {{ id: *, linkedMembers?: Array }} member  the household's primary member
 * @param {Object} summary  output of calculateAnnualSummary (owed per member)
 * @param {Array} payments
 * @param {Array} [creditAdjustments]
 * @param {Set<string>|null} [reopenedAdjustmentIds]  adjustment ids re-opened by an
 *   active not_received (#319, ADR 0003); excluded so the credit is owed again
 * @param {Array} [owedAdjustments]  Service Credits (−owed, #321, applied) and billed
 *   Usage Charges (+owed, #320, added); deferred Usage Charges (#317) and the
 *   `carry_opening` seed records (#322, applied via openingBalance) are ignored here
 * @param {number} [openingBalance]  netted carried-forward opening balance (#322); a
 *   carried credit is negative (owe less), a carried charge positive (owe more)
 * @returns {{ owed: number, grossOwed: number, serviceCreditTotal: number, grossPaid: number, creditAdjustmentTotal: number, billedChargeTotal: number, netContribution: number, credit: number }}
 */
export function getHouseholdFinancials(member, summary, payments, creditAdjustments = [], reopenedAdjustmentIds = null, owedAdjustments = [], openingBalance = 0) {
    const linkedIds = member.linkedMembers || [];

    let grossOwed = summary[member.id] ? summary[member.id].total : 0;
    linkedIds.forEach(id => { if (summary[id]) grossOwed += summary[id].total; });

    const serviceCreditTotal = getServiceCreditTotalForMember(owedAdjustments, member.id)
        + linkedIds.reduce((s, id) => s + getServiceCreditTotalForMember(owedAdjustments, id), 0);

    // Billed Usage Charges raise owed at the household grain (ADR 0001, #320).
    const billedChargeTotal = getBilledUsageChargeTotalForMember(owedAdjustments, member.id)
        + linkedIds.reduce((s, id) => s + getBilledUsageChargeTotalForMember(owedAdjustments, id), 0);

    // Compose all four owed slices (ADR 0005). A Service Credit (#321) lowers the
    // bill-derived owed and a carried opening balance (#322) adjusts it (credit −,
    // charge +); their combined effect is floored at 0 so neither an over-large
    // credit nor a carried credit turns owed negative — the residual rides the
    // credit path as payments arrive. A billed Usage Charge (#320) is real owed,
    // added on top of that floored figure (never cancelled by a credit/carry).
    // The carry_opening seed records that produce openingBalance are a distinct
    // `kind`, so the two helpers above ignore them — no double-count.
    const owed = Math.max(0, grossOwed - serviceCreditTotal + (openingBalance || 0)) + billedChargeTotal;

    const grossPaid = getPaymentTotalForMember(payments, member.id)
        + linkedIds.reduce((s, id) => s + getPaymentTotalForMember(payments, id), 0);

    const creditAdjustmentTotal = getCreditAdjustmentTotalForMember(creditAdjustments, member.id, reopenedAdjustmentIds)
        + linkedIds.reduce((s, id) => s + getCreditAdjustmentTotalForMember(creditAdjustments, id, reopenedAdjustmentIds), 0);

    const netContribution = grossPaid - creditAdjustmentTotal;
    const rawCredit = netContribution - owed;
    const credit = rawCredit > CREDIT_EPSILON ? rawCredit : 0;

    return { owed, grossOwed, serviceCreditTotal, grossPaid, creditAdjustmentTotal, billedChargeTotal, netContribution, credit };
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
 * The carry-forward seam (#322, ADR 0005/0006/0007). Given a closing year's
 * state, compute — at the household grain (ADR 0001) — what UNDISPOSED items
 * roll into next year and net them to a single per-household opening balance.
 *
 * Two feeds, netted to one number (the issue's "credits negative, charges
 * positive"):
 *   - undisposed Credit            → carried as a NEGATIVE opening balance (owe less)
 *   - still-deferred Usage Charges → carried as a POSITIVE opening balance (owe more)
 *
 * The household's carryable Credit is its `getHouseholdFinancials` credit, which
 * already nets out recorded refunds and carry-forwards — so a credit already
 * disposed by a refund is not double-carried, and a partial refund leaves only
 * the residual to carry.
 *
 * #319 reconciliation (Refund Notices / `not_received`, ADR 0003): an active
 * `not_received` re-opens a credit — that amount is owed back THIS year, not
 * undisposed surplus, so it must not be carried. The optional
 * `reopenedAdjustmentIds` set (from `reopenedCreditAdjustmentIds`, #319) names
 * recorded refund/carry adjustments that are currently re-opened; this seam
 * treats them as still-effective FOR THE CARRY (it does not add their amount back
 * into the carried credit), so the resurfaced credit stays live this year and
 * only genuine surplus rolls forward. When the set is empty, behavior is unchanged.
 *
 * Pure: computes only; never mutates. The close/rollover path consumes the
 * returned ids to mark the old year (append-only) and the opening balances to
 * seed the new year.
 *
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {Array} [creditAdjustments]
 * @param {Array} [owedAdjustments]
 * @param {{ reopenedAdjustmentIds?: Set }} [options]
 * @returns {{ households: Array<{ primaryMemberId: *, credit: number, deferredChargeTotal: number, deferredChargeIds: Array, creditAdjustmentIds: Array, openingBalance: number }>, totalOpeningBalance: number, memberCount: number }}
 */
export function buildCarryForward(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], options = {}) {
    const reopenedAdjustmentIds = options.reopenedAdjustmentIds || new Set();
    const summary = calculateAnnualSummary(familyMembers, bills);
    const mainMembers = familyMembers.filter(m => !isLinkedToAnyone(familyMembers, m.id));

    const households = [];
    let totalOpeningBalance = 0;

    mainMembers.forEach(member => {
        // Carryable credit is the household's full getHouseholdFinancials credit, so
        // it composes ALL owed slices of the closing year: a Service Credit (#321)
        // that reduced owed and PRODUCED a Credit rides this same axis (it must
        // carry — ADR 0005), and the closing year's own carried-in opening balance
        // (#322) lowers/raises owed exactly as the board shows. Billed Usage Charges
        // (#320) raise owed and so reduce the surplus, also correctly. The credit
        // subtracts ALL recorded refunds/carries, INCLUDING any currently re-opened
        // by an active not_received: a re-opened refund is owed back THIS year (it
        // re-blocks the gate, ADR 0003), not undisposed surplus, so it stays
        // effective for the carry and only genuine residual surplus rolls forward.
        // (reopenedAdjustmentIds only governs which records are eligible to be marked
        // carried-forward, never the carryable amount.)
        // priorOpeningBalance is the CLOSING year's own carried-in balance (#322), so
        // its credit composes exactly as the board showed; distinct from `openingBalance`
        // below, which is the NEW netted balance this seam carries OUT to next year.
        const priorOpeningBalance = getHouseholdOpeningBalance(member, owedAdjustments);
        const { credit } = getHouseholdFinancials(member, summary, payments, creditAdjustments, null, owedAdjustments, priorOpeningBalance);

        const ids = [member.id, ...((member.linkedMembers) || [])];
        const deferred = (owedAdjustments || []).filter(
            a => a && a.kind === 'usage_charge' && a.status === 'deferred' && ids.includes(a.memberId)
        );
        const deferredChargeTotal = deferred.reduce((sum, a) => sum + (a.amount || 0), 0);
        const deferredChargeIds = deferred.map(a => a.id);

        // Credit-adjustment records to mark carried-forward on the old year: the
        // active (recorded, not cancelled, not re-opened) household credit records.
        const creditAdjustmentIds = (creditAdjustments || [])
            .filter(a => a && a.status !== 'cancelled' && !reopenedAdjustmentIds.has(a.id) && ids.includes(a.memberId))
            .map(a => a.id);

        const hasCarryableCredit = credit > CREDIT_EPSILON;
        const hasDeferredCharge = deferredChargeTotal > CREDIT_EPSILON;
        if (!hasCarryableCredit && !hasDeferredCharge) return;

        // Net to one opening balance: charges positive, credit negative.
        const openingBalance = deferredChargeTotal - (hasCarryableCredit ? credit : 0);

        households.push({
            primaryMemberId: member.id,
            credit: hasCarryableCredit ? credit : 0,
            deferredChargeTotal,
            deferredChargeIds,
            creditAdjustmentIds,
            openingBalance
        });
        totalOpeningBalance += openingBalance;
    });

    return { households, totalOpeningBalance, memberCount: households.length };
}

/**
 * Billed Usage Charges (#320, owedAdjustments) raise each household's owed, so an
 * unpaid billed charge becomes Outstanding and blocks close (ADR 0006), while
 * still-deferred charges stay out of the gate. Carried opening balances (#322) fold
 * into owed via getHouseholdOpeningBalance — a carried charge becomes collectable and
 * a carried credit lowers what is owed. Both owedAdjustments and the carry_opening
 * seeds default to empty, so every existing 4-arg caller is unaffected (the #316
 * additive pattern).
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
 * @param {Array} [owedAdjustments]  owed-modifiers: Service Credits (−owed, #321) lower
 *   owed, billed Usage Charges (+owed, #320) raise it, and the `carry_opening` seed
 *   records (#322) fold a household's carried opening balance into its owed/annual
 *   total. Deferred Usage Charges (#317) in this array are still ignored (pending, not owed).
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
        // `owed` here is the post-Service-Credit (#321), post-opening-balance (#322),
        // plus-billed-charge (#320) owed, so totalAnnual reflects what is actually
        // owed after bill-level reductions and the carried balance, and a paid
        // household whose owed dropped below its Net Contribution surfaces a credit on
        // the existing axis. owedAdjustments is the 6th arg, openingBalance the 7th.
        const openingBalance = getHouseholdOpeningBalance(member, owedAdjustments);
        const { owed, grossPaid, netContribution, credit } =
            getHouseholdFinancials(member, summary, payments, creditAdjustments, reopenedAdjustmentIds, owedAdjustments, openingBalance);
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
