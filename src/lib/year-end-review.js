/** Pure Year-End Review math and draft validation (ADR 0009). No storage or IO. */
import { calculateAnnualSummary, isLinkedToAnyone } from './calculations.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => (typeof value === 'string' && value.length > 0) || (typeof value === 'number' && Number.isSafeInteger(value));
const money = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const dollars = cents => cents / 100;
const currency = amount => '$' + amount.toFixed(2);
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Magnitudes use the existing service's rounding; signed values round symmetrically. */
export function toCents(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Amount must be finite.');
    const cents = Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(cents)) throw new Error('Amount is too large.');
    return cents === 0 ? 0 : cents;
}

/** Preserve order: floor for every member except the last, who receives the remainder. */
export function splitCents(totalCents, memberIds) {
    if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('Cents must be a non-negative integer.');
    if (!Array.isArray(memberIds) || memberIds.some(memberId => !id(memberId)) || new Set(memberIds).size !== memberIds.length) {
        throw new Error('Members must be distinct ids.');
    }
    if (memberIds.length === 0) return [];
    const base = Math.floor(totalCents / memberIds.length);
    return memberIds.map((memberId, index) => ({ memberId, cents: index === memberIds.length - 1 ? totalCents - base * index : base }));
}

function monthNumber(value, sourceYear) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Choose a valid month.');
    const label = typeof sourceYear === 'object' ? sourceYear?.label : sourceYear;
    if (label != null && value.slice(0, 4) !== String(label)) throw new Error('Month must be in the source year.');
    return Number(value.slice(5));
}

export function monthsFromFirst(firstMonth, sourceYear) { return 13 - monthNumber(firstMonth, sourceYear); }
export function monthsAfterLast(lastMonth, sourceYear) { return 12 - monthNumber(lastMonth, sourceYear); }

function frequencyOf(bill) {
    const frequency = bill.frequency ?? bill.billingFrequency ?? 'monthly';
    if (!['monthly', 'annual'].includes(frequency)) throw new Error('Choose monthly or annual.');
    return frequency;
}

function validateBill(bill) {
    if (!object(bill) || !id(bill.id ?? bill.billId) || !money(bill.amount)) throw new Error('A bill with a positive price is required.');
    frequencyOf(bill);
    splitCents(0, bill.members);
}

/** Stable serialization for financial equality and fingerprints; object key order is irrelevant. */
function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
        .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
}

const same = (a, b) => canonical(a) === canonical(b);

/** The exact live record fields a stored answer must still match. */
export function snapshotExistingCredit(record) {
    return {
        memberId: record.memberId, amountCents: toCents(record.amount), incurredDate: record.incurredDate ?? null,
        reason: record.reason ?? null, createdAt: record.createdAt ?? null, status: record.status
    };
}

/** Complete change identity, including inputs that can change without changing the delta. */
export function existingCreditCoverage(result, memberId) {
    const { basis, calc, shares } = result;
    return {
        basis, frequency: calc.frequency, fromAmount: calc.fromAmount, toAmount: calc.toAmount,
        firstMonth: calc.firstMonth, lastMonth: calc.lastMonth, override: calc.overridden ? calc.gross : null,
        shareCents: shares.find(share => share.memberId === memberId)?.shareCents ?? 0
    };
}

function relevantCredits(records, billId) {
    return (records || []).filter(record => record && record.kind === 'service_credit' && record.status === 'active' && record.billId === billId);
}

/**
 * coverage is a computation result (or a member-id keyed coverage map).
 * Missing snapshots are deliberately cleared. Call after edits and on restore.
 */
export function revalidateExistingCreditAnswers(draftBill, liveRecords, coverage) {
    const answers = draftBill.existingCredits || {};
    const existingCredits = {};
    const notices = [];
    const unanswered = [];
    const records = liveRecords.filter(record => record.kind === 'service_credit' && record.status === 'active');
    for (const record of records) {
        const answer = answers[record.id];
        const currentCoverage = coverage?.calc ? existingCreditCoverage(coverage, record.memberId) : coverage?.[record.memberId];
        if (answer && same(answer.seen, snapshotExistingCredit(record)) && same(answer.coverage, currentCoverage)) {
            existingCredits[record.id] = structuredClone(answer);
        } else {
            unanswered.push(record.id);
            if (answer) notices.push({ adjustmentId: record.id, message: same(answer.seen, snapshotExistingCredit(record))
                ? 'Answer again: the change this credit covers changed' : 'Answer again: this member’s credit changed' });
        }
    }
    for (const adjustmentId of Object.keys(answers)) {
        if (!records.some(record => String(record.id) === adjustmentId)) notices.push({ adjustmentId, message: 'A credit no longer exists; its answer was removed' });
    }
    return { draftBill: { ...draftBill, existingCredits }, existingCredits, notices, unanswered };
}

function formulaFor(result) {
    const { calc, basis, shares } = result;
    const price = basis === 'price_change' ? `(${currency(calc.toAmount)} − ${currency(calc.fromAmount)})` : currency(basis === 'ended' ? calc.fromAmount : calc.toAmount);
    const period = basis === 'ended' && calc.months > 0 ? ` (${monthNames[12 - calc.months].slice(0, 3)}–Dec)` : '';
    let formula = `${price}${calc.frequency === 'annual' ? ' ÷ 12' : ''} × ${calc.months} months${period} = ${currency(calc.computed)}`;
    if (calc.overridden) formula += `; computed ${currency(calc.computed)} → entered ${currency(calc.gross)}`;
    if (shares.length) {
        const amounts = shares.map(share => share.shareCents);
        formula += ` ÷ ${shares.length} members = ` + (amounts.every(amount => amount === amounts[0])
            ? `${currency(dollars(amounts[0]))} each` : amounts.map(amount => currency(dollars(amount))).join(' · '));
    }
    if (calc.alreadyCreditedCents > 0) formula += ` − ${currency(dollars(calc.alreadyCreditedCents))} already covered = ${currency(calc.recorded)} to record`;
    return formula;
}

function compute(bill, input, ctx, basis) {
    validateBill(bill);
    const frequency = frequencyOf(bill);
    const fromAmount = basis === 'late_start' ? null : bill.amount;
    const toAmount = basis === 'ended' ? null : basis === 'late_start' ? bill.amount : input.newAmount;
    if (toAmount !== null && !money(toAmount)) throw new Error('The new price must be positive.');
    if (basis === 'price_change' && toAmount === fromAmount) throw new Error('No change—leave the bill Unchanged or enter a different price.');
    const firstMonth = basis === 'ended' ? null : input.firstMonth;
    const lastMonth = basis === 'ended' ? input.lastMonth : null;
    const months = basis === 'ended' ? monthsAfterLast(lastMonth, ctx.sourceYear) : monthsFromFirst(firstMonth, ctx.sourceYear);
    const divisor = frequency === 'annual' ? 12 : 1;
    const signed = basis === 'ended' ? (fromAmount / divisor) * months : basis === 'late_start'
        ? (toAmount / divisor) * months : ((toAmount - fromAmount) / divisor) * months;
    const kind = basis === 'ended' || signed < 0 || (basis === 'price_change' && toAmount < fromAmount) ? 'service_credit' : 'usage_charge';
    const computedCents = toCents(Math.abs(signed));
    const overridden = input.override !== undefined && input.override !== null;
    if (overridden && (!money(input.override) || toCents(input.override) <= 0)) throw new Error('Override must be positive and in the formula’s direction.');
    if (overridden && computedCents === 0) throw new Error('There is no nonzero computed amount to override.');
    const beforeNet = overridden ? toCents(input.override) : computedCents;
    if (basis === 'late_start' && bill.members.length === 0) throw new Error('Choose at least one member for a new subscription.');
    const shares = splitCents(beforeNet, bill.members).map(({ memberId, cents }) => ({ memberId, shareCents: cents, appliedCents: 0, netCents: cents, coveredBy: [] }));
    const result = {
        billId: bill.id ?? bill.billId, billName: bill.name, kind, basis,
        calc: { frequency, fromAmount, toAmount, fromMonthly: fromAmount === null ? null : fromAmount / divisor,
            toMonthly: toAmount === null ? null : toAmount / divisor, firstMonth, lastMonth, months,
            computed: dollars(computedCents), gross: dollars(beforeNet), overridden, recorded: 0, coveredBy: [], alreadyCreditedCents: 0 },
        grossCents: beforeNet, shares, coveredBy: [], records: [], outcome: 'recorded',
        billOutcome: basis === 'ended' ? 'omitted' : 'kept_at_new_price'
    };
    const records = relevantCredits(ctx.owedAdjustments, result.billId);
    if (kind === 'service_credit' && beforeNet > 0 && shares.length && !ctx.skipExistingCredits) {
        const answers = input.existingCredits || {};
        for (const record of records) {
            const answer = answers[record.id];
            if (!answer || !['covers', 'partial', 'unrelated'].includes(answer.choice)) throw new Error(`Answer whether credit ${record.id} covers this change.`);
            if ((answer.seen && !same(answer.seen, snapshotExistingCredit(record))) ||
                (answer.coverage && !same(answer.coverage, existingCreditCoverage(result, record.memberId)))) throw new Error(`Answer again: credit ${record.id} changed.`);
            if (typeof record.amount !== 'number' || !Number.isFinite(record.amount) || record.amount < 0) throw new Error(`Credit ${record.id} has an invalid amount.`);
            const share = shares.find(item => item.memberId === record.memberId);
            const amountCents = toCents(record.amount);
            const appliedCents = answer.choice === 'covers' ? amountCents : answer.choice === 'partial' ? answer.appliedCents : 0;
            if (!Number.isSafeInteger(appliedCents) || appliedCents < 0 ||
                (answer.choice === 'partial' && (appliedCents <= 0 || appliedCents >= amountCents)) ||
                appliedCents > (share?.netCents ?? 0)) throw new Error(`Credit ${record.id} exceeds this member’s remaining share or has an invalid covering amount.`);
            if (appliedCents > 0) {
                const covered = { adjustmentId: record.id, memberId: record.memberId, appliedAmount: dollars(appliedCents) };
                share.appliedCents += appliedCents;
                share.netCents -= appliedCents;
                share.coveredBy.push(covered);
                result.coveredBy.push(covered);
            }
        }
        for (const adjustmentId of Object.keys(answers)) {
            if (!records.some(record => String(record.id) === adjustmentId)) throw new Error(`Answer again: credit ${adjustmentId} no longer exists.`);
        }
    }
    result.grossCents = shares.reduce((sum, share) => sum + share.netCents, 0);
    result.calc.recorded = dollars(result.grossCents);
    result.calc.coveredBy = result.coveredBy;
    result.calc.alreadyCreditedCents = shares.reduce((sum, share) => sum + share.appliedCents, 0);
    if (!shares.length) result.outcome = 'no_members';
    else if (result.grossCents === 0) result.outcome = result.coveredBy.length ? 'covered' : result.billOutcome;
    result.zeroReason = !shares.length ? 'no_members' : months === 0 ? 'no_months' : computedCents === 0 && !overridden ? 'rounds_to_zero' : result.outcome === 'covered' ? 'covered' : null;
    result.formula = formulaFor(result);
    return result;
}

/** ctx = { sourceYear: label or {label}, owedAdjustments: live source records }. */
export function computePriceChange(bill, change, ctx = {}) { return compute(bill, change, ctx, 'price_change'); }
export function computeEnded(bill, change, ctx = {}) { return compute(bill, change, ctx, 'ended'); }
export function computeLateStart(bill, ctx = {}) { return compute(bill, bill, ctx, 'late_start'); }

function recordContext(ctx) {
    if (!id(ctx.sourceYearId) || !id(ctx.reconciliationId) || typeof ctx.now !== 'string' || !Number.isFinite(Date.parse(ctx.now))) {
        throw new Error('Source year, reconciliation id and a fixed timestamp are required.');
    }
}

function memberSentence(result, share) {
    const { calc, billName, basis } = result;
    const price = amount => Number.isInteger(amount) ? '$' + amount : currency(amount);
    const unit = calc.frequency === 'annual' ? 'year' : 'month';
    const month = monthNames[monthNumber(calc.firstMonth || calc.lastMonth) - 1];
    if (basis === 'ended') return `${billName} ended in ${month}. Your share of ${calc.months} months: ${currency(dollars(share.netCents))}.`;
    const lead = basis === 'late_start' ? `${billName} started in ${month} at ${price(calc.toAmount)} a ${unit}.`
        : `${billName} went from ${price(calc.fromAmount)} to ${price(calc.toAmount)} a ${unit} in ${month}.`;
    return `${lead} Your share of ${calc.months} months: ${currency(dollars(share.netCents))}.`;
}

function buildRecords(result, ctx, kind) {
    recordContext(ctx);
    if (result.kind !== kind) throw new Error('Wrong record factory for this change.');
    const trueUpId = `tu_${ctx.sourceYearId}_${result.basis === 'late_start' ? 'new_' : ''}${result.billId}`;
    return result.shares.filter(share => share.netCents > 0).map(share => {
        const credit = kind === 'service_credit';
        return {
            id: credit ? `oadj_sc_${ctx.sourceYearId}_${result.basis}_${result.billId}_${share.memberId}` : `oadj_tu_${ctx.sourceYearId}_${trueUpId}_${share.memberId}`,
            ...(credit ? {} : { trueUpId }), memberId: share.memberId, billId: result.billId, billName: result.billName, kind,
            basis: result.basis, amount: dollars(share.netCents),
            [credit ? 'reason' : 'description']: memberSentence(result, share),
            incurredDate: credit && result.basis === 'ended' ? result.calc.lastMonth + '-01' : result.calc.firstMonth + '-01',
            calc: { ...structuredClone(result.calc), share: dollars(share.shareCents), applied: dollars(share.appliedCents), coveredBy: structuredClone(share.coveredBy) },
            status: credit ? 'active' : 'deferred', createdAt: ctx.now, reconciliationId: ctx.reconciliationId
        };
    });
}

export function buildTrueUpRecords(result, ctx) { return buildRecords(result, ctx, 'usage_charge'); }
export function buildServiceCreditRecords(result, ctx) { return buildRecords(result, ctx, 'service_credit'); }

export function buildUsageChargeRecord(row, ctx) {
    recordContext(ctx);
    if (!id(row.rowId) || !id(row.memberId) || !money(row.amount) || toCents(row.amount) <= 0 || typeof row.description !== 'string' || !row.description.trim()) {
        throw new Error('A charge needs a stable row id, member, positive amount and description.');
    }
    if (row.id || row.existingAdjustmentId) throw new Error('An existing deferred charge must be reused, never recorded again.');
    if (ctx.familyMembers && !ctx.familyMembers.some(member => member.id === row.memberId)) throw new Error('Member not found.');
    if (!validDate(row.incurredDate)) throw new Error('Choose a valid incurred date.');
    return { id: `oadj_uc_${ctx.sourceYearId}_${row.rowId}`, memberId: row.memberId, kind: 'usage_charge', amount: dollars(toCents(row.amount)),
        description: row.description.trim(), incurredDate: row.incurredDate, status: 'deferred', createdAt: ctx.now, reconciliationId: ctx.reconciliationId };
}

export function deriveNextYearBills(sourceBills, reviewBills = {}, newBills = []) {
    const bills = sourceBills.filter(bill => reviewBills[bill.id]?.change !== 'ended').map(bill => {
        const row = reviewBills[bill.id] || {};
        const amount = row.nextYearAmount ?? (row.change === 'price_change' ? row.newAmount : bill.amount);
        if (!money(amount)) throw new Error('Next year’s price must be positive.');
        return { ...structuredClone(bill), amount };
    });
    for (const row of newBills) {
        validateBill(row);
        if (bills.some(bill => bill.id === row.billId) || sourceBills.some(bill => bill.id === row.billId)) throw new Error('New bill id collides with a source bill.');
        bills.push({ id: row.billId, name: row.name, amount: row.amount, billingFrequency: frequencyOf(row), website: row.website || '', logo: '', members: [...row.members] });
    }
    return bills;
}

/** Consume finalized carry.households[].items from billing-year; never recompute carry. */
export function buildHouseholdPreview({ familyMembers, sourceBills, nextBills, carry = { households: [] } }) {
    const source = calculateAnnualSummary(familyMembers, sourceBills);
    const next = calculateAnnualSummary(familyMembers, nextBills);
    return familyMembers.filter(member => !isLinkedToAnyone(familyMembers, member.id)).map(primary => {
        const members = [primary.id, ...(primary.linkedMembers || [])].filter(memberId => own(source, memberId)).map(memberId => ({
            memberId, sourceBillTotal: source[memberId].total, nextBillTotal: next[memberId].total
        }));
        const seed = carry.households.find(household => household.primaryMemberId === primary.id);
        const items = structuredClone(seed?.items || []);
        const carriedCents = items.reduce((sum, item) => sum + toCents(item.amount), 0);
        if (seed && toCents(seed.openingBalance) !== carriedCents) throw new Error('Carried items must sum to the opening balance.');
        const sourceBillTotal = dollars(toCents(members.reduce((sum, member) => sum + member.sourceBillTotal, 0)));
        const nextBillTotal = dollars(toCents(members.reduce((sum, member) => sum + member.nextBillTotal, 0)));
        const carriedTotal = dollars(carriedCents);
        const carriedCharges = dollars(items.reduce((sum, item) => sum + Math.max(0, toCents(item.amount)), 0));
        return { primaryMemberId: primary.id, members, sourceBillTotal, nextBillTotal, subscriptionDelta: dollars(toCents(nextBillTotal - sourceBillTotal)),
            items, carriedTotal, carriedCharges, carriedCredit: dollars(carriedCents - toCents(carriedCharges)),
            firstInvoiceTotal: dollars(Math.max(0, toCents(nextBillTotal) + carriedCents)), remainingCredit: dollars(Math.max(0, -(toCents(nextBillTotal) + carriedCents))) };
    });
}

function withoutVolatile(value) {
    if (Array.isArray(value)) return value.map(withoutVolatile);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['createdAt', 'updatedAt', 'rev', 'lastWriteId'].includes(key))
        .map(([key, nested]) => [key, withoutVolatile(nested)]));
}

/** Two independent 32-bit hash lanes over canonical source fields; not an auth token. */
export function computeSourceFingerprint(state) {
    const pick = (values, keys) => (values || []).map(value => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])));
    const text = canonical(withoutVolatile({ status: state.status ?? state.activeYear?.status ?? state.year?.status,
        bills: pick(state.bills, ['id', 'name', 'amount', 'billingFrequency', 'members']),
        familyMembers: pick(state.familyMembers ?? state.members, ['id', 'name', 'linkedMembers']),
        payments: pick(state.payments, ['id', 'memberId', 'amount', 'type', 'reversed']),
        creditAdjustments: state.creditAdjustments || [], owedAdjustments: state.owedAdjustments || [], billingEventCount: state.billingEvents?.length || 0 }));
    let a = 2166136261;
    let b = 2246822507;
    for (let index = 0; index < text.length; index++) {
        a = Math.imul(a ^ text.charCodeAt(index), 16777619);
        b = Math.imul(b ^ text.charCodeAt(index), 3266489909);
    }
    return 'yer1_' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function findSuccessorYear(billingYears, sourceYear, sourceEvents = []) {
    for (const event of sourceEvents) {
        if (['YEAR_ROLLED_OVER', 'YEAR_CARRIED_FORWARD'].includes(event.eventType)) {
            const target = event.payload?.nextYearId ?? event.payload?.nextYearLabel ?? event.payload?.toYear;
            if (target != null) return billingYears.find(year => String(year.id) === String(target) || year.label === String(target)) || { id: String(target), label: String(target) };
        }
    }
    if (!/^\d+$/.test(String(sourceYear?.label))) return null;
    return billingYears.filter(year => /^\d+$/.test(String(year.label)) && Number(year.label) > Number(sourceYear.label))
        .sort((a, b) => Number(a.label) - Number(b.label))[0] || null;
}

export function shouldOfferYearEndReview(year, successor, today) {
    if (!year || successor != null || !['open', 'settling', 'closed'].includes(year.status)) return false;
    if (year.status === 'closed') return true;
    if (!/^\d{4}$/.test(year.label)) return false;
    if (typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)) return validDate(today) && today >= year.label + '-11-01';
    const date = today instanceof Date ? today : new Date(today);
    if (!Number.isFinite(date.getTime())) return false;
    // Calendar dates are local to the administrator, matching the entry point's date trigger.
    const calendar = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    return calendar >= year.label + '-11-01';
}

function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function assertKeys(value, keys) {
    if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Draft contains an invalid field.');
}

/** Returns a validated input-only draft plus recomputed results; never accepts stored totals. */
export function validateDraft(raw, ctx) {
    const notices = [];
    const errors = [];
    const fail = message => ({ valid: false, draft: null, errors: [{ step: 1, message }], notices, stale: false, needsPreview: true });
    if (!object(raw) || raw.draftVersion !== 1 || raw.userId !== ctx.userId || raw.sourceYearId !== ctx.sourceYear.id || raw.sourceLabel !== ctx.sourceYear.label) return fail('This draft belongs to another user, year, or draft version.');
    try {
        assertKeys(raw, ['draftVersion', 'reconciliationId', 'userId', 'sourceYearId', 'sourceLabel', 'nextYearLabel', 'sourceFingerprint', 'savedAt', 'bills', 'newBills', 'charges', 'confirmations']);
        if (!id(raw.reconciliationId) || typeof raw.nextYearLabel !== 'string' || !raw.nextYearLabel.trim() || typeof raw.sourceFingerprint !== 'string' || typeof raw.savedAt !== 'string' || !Number.isFinite(Date.parse(raw.savedAt))) throw new Error('Draft identity or metadata is invalid.');
        if (!object(raw.bills) || !Array.isArray(raw.newBills) || !Array.isArray(raw.charges)) throw new Error('Draft rows are invalid.');
        assertKeys(raw.confirmations, ['noBillChanges', 'noNewSubscriptions', 'noExtraCharges']);
        if (['noBillChanges', 'noNewSubscriptions', 'noExtraCharges'].some(key => typeof raw.confirmations[key] !== 'boolean')) throw new Error('Draft confirmations are invalid.');
    } catch (error) { return fail(error.message); }
    let draft;
    try { draft = structuredClone(raw); } catch (_) { return fail('Draft contains values that cannot be restored.'); }
    const results = {};
    for (const [billId, row] of Object.entries(draft.bills)) {
        const bill = ctx.bills.find(value => String(value.id) === billId);
        if (!bill) { delete draft.bills[billId]; notices.push('A bill no longer exists; its row was removed.'); continue; }
        try {
            assertKeys(row, ['change', 'newAmount', 'firstMonth', 'lastMonth', 'override', 'nextYearAmount', 'existingCredits']);
            if (!['unchanged', 'price_change', 'ended'].includes(row.change) || (row.nextYearAmount !== undefined && !money(row.nextYearAmount))) throw new Error('Bill change or next year’s price is invalid.');
            for (const field of ['newAmount', 'nextYearAmount']) {
                if (row[field] !== undefined && row[field] !== null && !money(row[field])) throw new Error('Bill prices must be positive numbers.');
            }
            if (row.override !== undefined && row.override !== null && (!money(row.override) || toCents(row.override) <= 0)) throw new Error('Override must be positive.');
            for (const field of ['firstMonth', 'lastMonth']) {
                if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') throw new Error('Bill months must be strings.');
            }
            if (row.existingCredits !== undefined && !object(row.existingCredits)) throw new Error('Existing credit answers are invalid.');
            for (const storedAnswer of Object.values(row.existingCredits || {})) {
                assertKeys(storedAnswer, ['choice', 'appliedCents', 'seen', 'coverage']);
                if (!['covers', 'partial', 'unrelated'].includes(storedAnswer.choice) ||
                    (storedAnswer.appliedCents !== undefined && (!Number.isSafeInteger(storedAnswer.appliedCents) || storedAnswer.appliedCents < 0))) throw new Error('Existing credit answer fields are invalid.');
            }
            if (row.change !== 'unchanged') {
                const computeChange = row.change === 'ended' ? computeEnded : computePriceChange;
                const base = computeChange(bill, row, { sourceYear: ctx.sourceYear, skipExistingCredits: true });
                const live = relevantCredits(ctx.owedAdjustments, bill.id);
                const checked = revalidateExistingCreditAnswers(row, live, base);
                row.existingCredits = checked.existingCredits;
                notices.push(...checked.notices.map(notice => notice.message));
                if (base.kind === 'service_credit' && base.shares.length && base.calc.gross > 0 && checked.unanswered.length) throw new Error('Answer every existing credit again before continuing.');
                results[billId] = computeChange(bill, row, { sourceYear: ctx.sourceYear, owedAdjustments: ctx.owedAdjustments });
            }
        } catch (error) { errors.push({ step: 1, billId: bill.id, message: error.message }); }
    }
    const billIds = new Set(ctx.bills.map(bill => bill.id));
    const rowIds = new Set();
    draft.newBills = draft.newBills.filter(row => {
        try {
            assertKeys(row, ['rowId', 'billId', 'name', 'amount', 'frequency', 'website', 'members', 'firstMonth', 'override']);
            if (!id(row.rowId) || !id(row.billId) || rowIds.has(row.rowId) || typeof row.name !== 'string' || !row.name.trim() || typeof row.website !== 'string') throw new Error('New subscription fields are invalid.');
            if (!['monthly', 'annual'].includes(row.frequency)) throw new Error('New subscription frequency must be monthly or annual.');
            rowIds.add(row.rowId);
            if (billIds.has(row.billId)) {
                // A deterministic unused numeric id preserves the row across subsequent restores.
                let replacement = typeof row.billId === 'number' ? row.billId + 1 : 1;
                while (billIds.has(replacement)) replacement++;
                row.billId = replacement;
                notices.push('A new bill id collided with a current bill; check this row again.');
                errors.push({ step: 2, rowId: row.rowId, message: 'Re-check the new subscription after its bill id changed.' });
            }
            billIds.add(row.billId);
            if (!Array.isArray(row.members) || row.members.some(memberId => !ctx.familyMembers.some(member => member.id === memberId))) throw new Error('A new subscription member no longer exists.');
            results['new_' + row.rowId] = computeLateStart(row, { sourceYear: ctx.sourceYear });
        } catch (error) { errors.push({ step: 2, rowId: row?.rowId, message: error.message }); }
        return true;
    });
    draft.charges = draft.charges.filter(row => {
        if (object(row) && !ctx.familyMembers.some(member => member.id === row.memberId)) { notices.push('A charge’s member no longer exists; its row was removed.'); return false; }
        try {
            assertKeys(row, ['rowId', 'memberId', 'amount', 'description', 'incurredDate']);
            if (rowIds.has(row.rowId)) throw new Error('Draft row ids must be unique.');
            rowIds.add(row.rowId);
            buildUsageChargeRecord(row, { sourceYearId: draft.sourceYearId, reconciliationId: draft.reconciliationId, now: draft.savedAt, familyMembers: ctx.familyMembers });
        } catch (error) { errors.push({ step: 3, rowId: row?.rowId, message: error.message }); }
        return true;
    });
    const state = { ...ctx.sourceYear, bills: ctx.bills, familyMembers: ctx.familyMembers, owedAdjustments: ctx.owedAdjustments };
    const stale = draft.sourceFingerprint !== computeSourceFingerprint(state);
    if (stale) notices.push('The source year changed; totals were recomputed. Review Step 4 again.');
    // Retain the reviewed fingerprint; restore never silently approves a new source state.
    return { valid: errors.length === 0, draft, results, errors, notices, stale, needsPreview: true };
}

/** validation = { errors: [{step,message}], unanswered: [], previewCurrent: boolean }. */
export function canStart(_draft, validation) {
    const blockers = [...(validation.errors || [])];
    if (validation.valid === false && blockers.length === 0) blockers.push({ step: 1, message: 'Resolve the draft validation errors.' });
    for (const adjustmentId of validation.unanswered || []) blockers.push({ step: 1, adjustmentId, message: 'Answer whether this existing credit covers the change.' });
    if (validation.previewCurrent !== true) blockers.push({ step: 4, message: 'Recompute and review the household preview after the last edit.' });
    return { canStart: blockers.length === 0, blockers };
}
