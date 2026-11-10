// Billing year lifecycle helpers — no DOM, no Firestore, no module-scoped state.

import { calculateSettlementMetrics, buildCarryForward, getHouseholdFinancials, isLinkedToAnyone } from './calculations.js';
import { toExactCents } from './household-money.js';
import { requireFinancialAvailability } from './financial-availability.js';
import { normalizeHouseholdName } from './household.js';
import {
    computePriceChange, computeEnded, computeLateStart, buildTrueUpRecords, buildServiceCreditRecords,
    buildUsageChargeRecord, deriveNextYearBills, computePayloadFingerprint
} from './year-end-review.js';

// Carry arithmetic uses integer cents, including symmetric signed rounding.
const cents = toExactCents;

/**
 * Return the exact year outstanding alias after checking every household and the
 * aggregate. Null reopening preserves the existing service close context.
 */
export function calculateOutstandingBalance(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = []) {
    const metrics = calculateSettlementMetrics(familyMembers, bills, payments, creditAdjustments, null, owedAdjustments);
    requireFinancialAvailability(metrics);
    return metrics.totalOutstanding;
}

/**
 * Finalize carry once, including actual ids, candidate ledgers and stored seeds.
 * Options bind destination/source labels, actual creditDispositionIds, itemized
 * review detail, carry-only U and the caller's marking reopening context.
 */
export function buildCarryForwardSummary(familyMembers, bills, payments, creditAdjustments = [], owedAdjustments = [], options = {}) {
    return buildCarryForward(familyMembers, bills, payments, creditAdjustments, owedAdjustments, options);
}

/**
 * Clone already allocated items from a finalized household plan. Context is
 * retained for call-site compatibility; it cannot change ids, money or detail.
 */
export function buildCarryOpeningItems(household, _ctx) {
    if (!household.ok || !household.seed) throw new Error('A finalized carry plan is required.');
    return structuredClone(household.seed.items);
}

/**
 * Consume the detached prior-year arrays from the validated whole-year plan.
 * No ids or monetary amounts are generated here. A caller may supply the clock
 * for createdAt; late idFactory/destination changes are rejected before writes.
 */
export function applyCarryForwardToPriorYear(_creditAdjustments, _owedAdjustments, carry, ctx = {}) {
    requireFinancialAvailability(carry);
    if (ctx.idFactory || (ctx.nextYearLabel && ctx.nextYearLabel !== carry.nextYearLabel)) {
        throw new Error('Carry ids and destination must be finalized before validation.');
    }
    const now = ctx.now || new Date().toISOString();
    const newIds = new Set(carry.carriedCreditRecords.map(row => row.id));
    const creditAdjustments = carry.priorYear.creditAdjustments.map(row => row && newIds.has(row.id)
        ? { ...structuredClone(row), createdAt: row.createdAt || now } : structuredClone(row));
    return { creditAdjustments, owedAdjustments: structuredClone(carry.priorYear.owedAdjustments),
        carriedCreditRecords: creditAdjustments.filter(row => row && newIds.has(row.id)) };
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
    if (carry && carry.memberCount > 0 && cents(carry.totalOpeningBalance) !== 0) {
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
 * Clone members, current household names, bills and settings into a new year.
 * A supplied carry must already be finalized for these source/destination labels.
 * Stored seeds are copied verbatim: legacy zero-net seeds were omitted by the
 * plan; itemized review zero-net seeds retain their allocated explanation.
 */
export function buildNewYearData(familyMembers, bills, settings, yearId, carry = null, fromYearLabel = null) {
    const clonedMembers = familyMembers.map(m => {
        const linkedMembers = m.linkedMembers ? m.linkedMembers.slice() : [];
        const cloned = {
            id: m.id,
            name: m.name,
            email: m.email,
            phone: m.phone || '',
            avatar: m.avatar,
            paymentReceived: 0,
            linkedMembers
        };
        // The household name lives on the contact's record (#528, ADR 0011); carry it
        // so Start New Year does not lose it. Only a contact (a member with linked
        // members) keeps one.
        const householdName = normalizeHouseholdName(m.householdName);
        if (householdName && linkedMembers.length > 0) cloned.householdName = householdName;
        return cloned;
    });
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
    if (carry) {
        requireFinancialAvailability(carry);
        if (carry.nextYearLabel !== yearId || carry.fromYearLabel !== (fromYearLabel || 'prev')) {
            throw new Error('The finalized carry plan belongs to another year.');
        }
    }
    const owedAdjustments = (carry?.seeds || []).map(seed => ({ ...structuredClone(seed), createdAt: new Date().toISOString() }));

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

// ────────── Year-End Review rollover preparation (ADR 0009 § 3) ──────────

/** Source statuses the review may roll over from; an Archived year is never rolled over. */
const REVIEW_SOURCE_STATUSES = ['open', 'settling', 'closed'];

/**
 * True when createYear's options select the review path. `'reconciliation' in options`
 * selects it, so an empty `{}` payload is still the review path; an omitted or
 * explicitly `undefined` reconciliation is the legacy call.
 */
export function isReviewedRollover(options) {
    return !!options && typeof options === 'object' && 'reconciliation' in options && options.reconciliation !== undefined;
}

const sameId = (a, b) => String(a) === String(b);
const reviewId = value => (typeof value === 'string' && value.length > 0) || (typeof value === 'number' && Number.isSafeInteger(value));
const centsToDollars = value => value / 100;

function payloadList(reconciliation, key) {
    const value = reconciliation[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('The review payload field ' + key + ' must be a list.');
    return value;
}

/**
 * Prepare the reviewed rollover's two documents without committing anything
 * (specs/year-end-review.md § Rollover, steps 1–5). HIGH-RISK: appends financial
 * records to the source year, computes the carry over that updated state and seeds
 * the new year. Pure over its inputs: no Firestore, no service state, a caller-fixed
 * clock (ctx.now) and no id allocation except event ids from ctx.eventId, so the
 * commit step (today a writeBatch, later the version-checked transaction) can call
 * it over whatever source snapshot it read.
 *
 * Every record is rebuilt through the reconciliation library from the payload's
 * inputs; amounts computed by the page are never trusted. Payload:
 *   { reconciliationId, sourceYearId, sourceFingerprint?,
 *     trueUps: [{ billId, newAmount, firstMonth, override? }],              price increases
 *     serviceCredits: [{ billId, basis: 'price_change' | 'ended', newAmount?, firstMonth?,
 *                        lastMonth?, override?, existingCredits? }],       decreases, ended bills
 *     usageCharges: [{ rowId, memberId, amount, description, incurredDate }
 *                    | { existingAdjustmentId }],                          new or reused charges
 *     billOverrides: { [sourceBillId]: nextYearAmount },
 *     endedBillIds: [sourceBillId],
 *     newBills: [{ rowId, billId, name, amount, frequency, website, members, firstMonth, override? }],
 *     confirmations }
 *
 * @param {{ activeYear: Object, familyMembers: Array, bills: Array, payments?: Array,
 *   creditAdjustments?: Array, owedAdjustments?: Array, billingEvents?: Array, settings?: Object }} source
 * @param {string} yearId the new year's label
 * @param {Object} reconciliation the review payload
 * @param {{ now: string, userId?: string, reopenedAdjustmentIds?: Set, eventId: () => string }} ctx
 * @returns {{ newYearData: Object, priorYear: { creditAdjustments: Array, owedAdjustments: Array,
 *   billingEvents: Array }, carry: Object, payloadFingerprint: string, summary: Object }}
 */
export function buildReviewedRollover(source, yearId, reconciliation, ctx) {
    const { activeYear, familyMembers, bills, settings } = source;
    const payments = source.payments || [];
    const creditAdjustments = source.creditAdjustments || [];
    const owedAdjustments = source.owedAdjustments || [];
    if (!activeYear) throw new Error('The Year-End Review needs a source billing year.');
    const status = activeYear.status || 'open';
    if (!REVIEW_SOURCE_STATUSES.includes(status)) throw new Error('A ' + status + ' billing year cannot be rolled over.');
    if (!reconciliation || typeof reconciliation !== 'object' || Array.isArray(reconciliation)) throw new Error('The review payload is invalid.');
    const { reconciliationId } = reconciliation;
    if (!reviewId(reconciliationId)) throw new Error('The review payload needs its reconciliation id.');
    if (!sameId(reconciliation.sourceYearId, activeYear.id)) throw new Error('The review payload belongs to another billing year.');
    if (typeof ctx?.now !== 'string' || typeof ctx.eventId !== 'function') throw new Error('A fixed timestamp and an event id factory are required.');
    const { now } = ctx;
    const sourceLabel = activeYear.label || activeYear.id;
    const trueUps = payloadList(reconciliation, 'trueUps');
    const serviceCredits = payloadList(reconciliation, 'serviceCredits');
    const usageCharges = payloadList(reconciliation, 'usageCharges');
    const newBills = payloadList(reconciliation, 'newBills');
    const endedBillIds = payloadList(reconciliation, 'endedBillIds');
    const billOverrides = reconciliation.billOverrides ?? {};
    if (!billOverrides || typeof billOverrides !== 'object' || Array.isArray(billOverrides)) throw new Error('The review payload field billOverrides must be an object.');

    const computeCtx = { sourceYear: sourceLabel, owedAdjustments };
    const recordCtx = { sourceYearId: activeYear.id, reconciliationId, now };
    const billFor = billId => {
        const bill = bills.find(row => sameId(row.id, billId));
        if (!bill) throw new Error('Bill ' + billId + ' is not in the ' + sourceLabel + ' billing year.');
        return bill;
    };

    // (1) Rebuild every closing-year change through the library, at most one per bill.
    const reviewBills = {}; // deriveNextYearBills input, keyed by source bill id
    const changes = [];
    const claim = (bill, row) => {
        if (reviewBills[bill.id]) throw new Error(bill.name + ' appears more than once in the review.');
        reviewBills[bill.id] = row;
    };
    for (const entry of trueUps) {
        const bill = billFor(entry?.billId);
        const result = computePriceChange(bill, entry, computeCtx);
        if (result.kind !== 'usage_charge') throw new Error(bill.name + ': a price decrease is a Service Credit, not a True-up.');
        claim(bill, { change: 'price_change', newAmount: entry.newAmount });
        changes.push({ result, records: buildTrueUpRecords(result, recordCtx) });
    }
    const ended = new Set(endedBillIds.map(String));
    for (const entry of serviceCredits) {
        const bill = billFor(entry?.billId);
        let result;
        if (entry.basis === 'ended') {
            if (!ended.has(String(bill.id))) throw new Error(bill.name + ' is credited as ended but not listed as ended.');
            result = computeEnded(bill, entry, computeCtx);
            claim(bill, { change: 'ended' });
        } else if (entry.basis === 'price_change') {
            result = computePriceChange(bill, entry, computeCtx);
            if (result.kind !== 'service_credit') throw new Error(bill.name + ': a price increase is a True-up, not a Service Credit.');
            claim(bill, { change: 'price_change', newAmount: entry.newAmount });
        } else {
            throw new Error(bill.name + ': a review Service Credit needs basis price_change or ended.');
        }
        changes.push({ result, records: buildServiceCreditRecords(result, recordCtx) });
    }
    for (const billId of endedBillIds) {
        const bill = billFor(billId);
        if (reviewBills[bill.id]?.change !== 'ended') throw new Error(bill.name + ' is listed as ended without its last month of service.');
    }
    for (const [billId, amount] of Object.entries(billOverrides)) {
        const bill = billFor(billId);
        if (reviewBills[bill.id]?.change === 'ended') throw new Error(bill.name + ' ended; it has no next-year price.');
        reviewBills[bill.id] = { ...(reviewBills[bill.id] || { change: 'unchanged' }), nextYearAmount: amount };
    }
    for (const row of newBills) {
        if (!row || typeof row !== 'object' || bills.some(bill => sameId(bill.id, row.billId))) {
            throw new Error('A new subscription id collides with a ' + sourceLabel + ' bill.');
        }
        const result = computeLateStart(row, computeCtx);
        changes.push({ result, records: buildTrueUpRecords(result, recordCtx) });
    }

    // Member charges: new rows are recorded once; listed existing deferred charges are reused.
    const reusedChargeIds = [];
    const chargeRecords = [];
    for (const row of usageCharges) {
        if (row && typeof row === 'object' && row.existingAdjustmentId !== undefined) {
            const existing = owedAdjustments.find(record => record && sameId(record.id, row.existingAdjustmentId));
            if (!existing || existing.kind !== 'usage_charge' || existing.status !== 'deferred') {
                throw new Error('Charge ' + row.existingAdjustmentId + ' is not a deferred Usage Charge in ' + sourceLabel + '.');
            }
            reusedChargeIds.push(existing.id);
            continue;
        }
        chargeRecords.push(buildUsageChargeRecord(row, { ...recordCtx, familyMembers }));
    }

    const trueUpRecords = changes.filter(change => change.result.kind === 'usage_charge').flatMap(change => change.records);
    const serviceCreditRecords = changes.filter(change => change.result.kind === 'service_credit').flatMap(change => change.records);
    const appended = [...trueUpRecords, ...serviceCreditRecords, ...chargeRecords];
    const knownIds = new Set(owedAdjustments.filter(Boolean).map(record => String(record.id)));
    for (const record of appended) {
        if (knownIds.has(String(record.id))) throw new Error('Review record ' + record.id + ' already exists in ' + sourceLabel + '.');
        knownIds.add(String(record.id));
    }
    const appendedOwed = [...owedAdjustments, ...appended];

    // Pre-commit status assertion (ADR 0009 § Closed-year rollover). True-ups and member
    // charges are deferred and never touch owed; a review Service Credit may only lower a
    // shortfall. For a Closed source this is the assertion that no household reads
    // Outstanding because of the review (a year closed with a balance keeps that balance).
    const primaries = familyMembers.filter(member => !isLinkedToAnyone(familyMembers, member.id));
    const before = { familyMembers, bills, payments, creditAdjustments, owedAdjustments };
    const after = { ...before, owedAdjustments: appendedOwed };
    for (const member of primaries) {
        const was = requireFinancialAvailability(getHouseholdFinancials(member, before));
        const is = requireFinancialAvailability(getHouseholdFinancials(member, after));
        if (Math.max(0, is.cents.balance) > Math.max(0, was.cents.balance)) {
            throw new Error((status === 'closed' ? 'A household of the closed year would read Outstanding: ' : 'The review would raise a shortfall: ')
                + (member.name || member.id) + '. Nothing was saved.');
        }
    }

    // (2)–(3) Carry over the updated state with the deterministic disposition ids, the
    // review's Service Credits as detail provenance and the unused incoming credit.
    const creditDispositionIds = new Map(primaries.map(member => [member.id, 'cadj_carry_' + yearId + '_' + member.id]));
    const carry = buildCarryForwardSummary(familyMembers, bills, payments, creditAdjustments, appendedOwed, {
        reopenedAdjustmentIds: ctx.reopenedAdjustmentIds || new Set(), fromYearLabel: sourceLabel, nextYearLabel: yearId,
        creditDispositionIds, carryUnusedOpeningCredit: true, itemized: true, reviewServiceCredits: serviceCreditRecords, now
    });
    requireFinancialAvailability(carry);
    const marked = applyCarryForwardToPriorYear(creditAdjustments, appendedOwed, carry, { now });
    // Debit records are born deferred and carried in the same commit: never persisted deferred.
    const markedById = new Map(marked.owedAdjustments.filter(Boolean).map(record => [String(record.id), record]));
    for (const id of [...trueUpRecords, ...chargeRecords].map(record => record.id).concat(reusedChargeIds)) {
        if (markedById.get(String(id))?.status !== 'carried_forward') throw new Error('Review charge ' + id + ' did not carry. Nothing was saved.');
    }

    // (4) Seed the new year with the derived bills and the itemized carry.
    const nextBills = deriveNextYearBills(bills, reviewBills, newBills);
    const newYearData = buildNewYearData(familyMembers, nextBills, settings || {}, yearId, carry, sourceLabel);

    // (5) Events on both documents.
    const payloadFingerprint = computePayloadFingerprint(reconciliation, yearId);
    const event = (eventType, payload) => ({ id: ctx.eventId(), timestamp: now,
        actor: { type: 'admin', userId: ctx.userId ?? null }, eventType, payload, note: '', source: 'ui' });
    const sourceEvents = [];
    let trueUpCount = 0;
    let serviceCreditCount = 0;
    let coveredCount = 0;
    for (const { result, records } of changes) {
        const calc = structuredClone(result.calc);
        const bill = { billId: result.billId, billName: result.billName };
        if (result.kind === 'usage_charge') {
            if (!records.length) continue;
            trueUpCount += 1;
            sourceEvents.push(event('TRUE_UP_RECORDED', { trueUpId: records[0].trueUpId, ...bill, basis: result.basis, calc,
                amount: result.calc.gross, memberCount: result.shares.length, memberIds: result.shares.map(share => share.memberId), reconciliationId }));
        } else if (records.length) {
            serviceCreditCount += 1;
            sourceEvents.push(event('SERVICE_CREDIT_RECORDED', { ...bill, amount: result.calc.recorded, reason: result.formula,
                incurredDate: records[0].incurredDate, memberId: null, memberCount: result.shares.length,
                shares: result.shares.map(share => ({ memberId: share.memberId, amount: centsToDollars(share.netCents) })),
                basis: result.basis, calc, coveredBy: structuredClone(result.coveredBy), reconciliationId }));
        } else if (result.outcome === 'covered') {
            coveredCount += 1;
            sourceEvents.push(event('SERVICE_CREDIT_COVERED', { ...bill, basis: result.basis, calc,
                coveredBy: structuredClone(result.coveredBy), reconciliationId }));
        } else if (result.outcome === 'no_members' && result.basis === 'ended') {
            sourceEvents.push(event('BILL_ENDED_UNASSIGNED', { ...bill, lastMonth: result.calc.lastMonth, reconciliationId }));
        }
    }
    for (const charge of chargeRecords) {
        sourceEvents.push(event('USAGE_CHARGE_RECORDED', { adjustmentId: charge.id, memberId: charge.memberId,
            memberName: familyMembers.find(member => member.id === charge.memberId)?.name || '', amount: charge.amount,
            description: charge.description, incurredDate: charge.incurredDate, status: charge.status, reconciliationId }));
    }
    if (carry.memberCount > 0) {
        sourceEvents.push(event('YEAR_CARRIED_FORWARD', { toYear: yearId, memberCount: carry.memberCount,
            totalOpeningBalance: carry.totalOpeningBalance, reconciliationId,
            itemCount: carry.seeds.reduce((sum, seed) => sum + (seed.items || []).length, 0) }));
    }
    const summary = { trueUpCount, serviceCreditCount, coveredCount, usageChargeCount: chargeRecords.length,
        priceChangeCount: Object.values(reviewBills).filter(row => row.change === 'price_change').length,
        endedCount: endedBillIds.length, newBillCount: newBills.length };
    sourceEvents.push(event('YEAR_ROLLED_OVER', { toYear: yearId, reconciliationId, payloadFingerprint, ...summary }));

    const nextEvents = [event('YEAR_CREATED_FROM_REVIEW', { fromYear: sourceLabel, reconciliationId, payloadFingerprint,
        householdCount: carry.memberCount, carriedTotal: carry.totalOpeningBalance })];
    for (const bill of nextBills) {
        const sourceBill = bills.find(row => sameId(row.id, bill.id));
        if (sourceBill && sourceBill.amount !== bill.amount) {
            nextEvents.push(event('BILL_PRICE_ROLLED_OVER', { billId: bill.id, billName: bill.name, previousValue: sourceBill.amount,
                newValue: bill.amount, billingFrequency: bill.billingFrequency || 'monthly', fromYear: sourceLabel }));
        }
    }
    for (const row of newBills) {
        const bill = nextBills.find(value => sameId(value.id, row.billId));
        nextEvents.push(event('BILL_CREATED', { billId: bill.id, billName: bill.name, amount: bill.amount,
            billingFrequency: bill.billingFrequency, website: bill.website, source: 'year_end_review',
            firstMonth: row.firstMonth, reconciliationId }));
    }
    newYearData.billingEvents = nextEvents;

    return {
        newYearData,
        priorYear: { creditAdjustments: marked.creditAdjustments, owedAdjustments: marked.owedAdjustments,
            billingEvents: [...(source.billingEvents || []), ...sourceEvents] },
        carry, payloadFingerprint, summary
    };
}
