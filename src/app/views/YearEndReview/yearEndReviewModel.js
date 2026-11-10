/**
 * Year-End Review model (#608): local-draft storage helpers and the derived
 * state of Steps 1–3. Everything here is pure or touches only the guarded
 * storage wrappers; all money math is delegated to src/lib/year-end-review.js
 * (#605). Nothing here writes the billing-year document.
 */
import {
    computePriceChange, computeEnded, computeLateStart, buildUsageChargeRecord,
    computeSourceFingerprint, existingCreditCoverage, revalidateExistingCreditAnswers,
    snapshotExistingCredit, toCents
} from '../../../lib/year-end-review.js';
import { isLinkedToAnyone } from '../../../lib/calculations.js';
import { getHouseholdName, getHouseholdMemberIds } from '../../../lib/household.js';

export const DRAFT_VERSION = 1;
export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const currencyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
/** "$1,234.50" (negative amounts render with a leading minus). */
export const money = amount => currencyFormat.format(amount);
/** "+$12.00" / "−$26.00" for signed figures. */
export const signedMoney = amount => (amount < 0 ? '−' : '+') + currencyFormat.format(Math.abs(amount));

export const isPositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The twelve YYYY-MM values of the source year, for the month selects. */
export function monthOptions(sourceLabel) {
    return MONTH_NAMES.map((name, index) => ({ value: `${sourceLabel}-${String(index + 1).padStart(2, '0')}`, label: `${name} ${sourceLabel}` }));
}

export function monthName(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) ? MONTH_NAMES[Number(value.slice(5)) - 1] : '';
}

export function formatDate(iso) {
    const date = new Date(iso + (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'T00:00:00' : ''));
    if (!Number.isFinite(date.getTime())) return iso;
    return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

// ── Draft storage ────────────────────────────────────────────────────────────

export const draftStorageKey = (userId, sourceYearId) => `ffb.yearEndReview.v1.${userId}.${sourceYearId}`;
/** Counts recorded beside the draft so a stale banner can say what changed (the draft shape itself is fixed). */
export const snapshotStorageKey = (userId, sourceYearId) => `${draftStorageKey(userId, sourceYearId)}.counts`;

function store() {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch (_) { return null; }
}

/** @returns {{ available: boolean, value?: any, corrupt?: boolean }} value is undefined when nothing is stored. */
export function readStored(key) {
    const storage = store();
    if (!storage) return { available: false };
    let raw;
    try { raw = storage.getItem(key); } catch (_) { return { available: false }; }
    if (raw == null) return { available: true };
    try { return { available: true, value: JSON.parse(raw) }; } catch (_) { return { available: true, corrupt: true }; }
}

/** @returns {boolean} true when the value was stored. */
export function writeStored(key, value) {
    const storage = store();
    if (!storage) return false;
    try { storage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
}

export function removeStored(key) {
    const storage = store();
    if (!storage) return false;
    try { storage.removeItem(key); return true; } catch (_) { return false; }
}

export function newReconciliationId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return 'rec_' + crypto.randomUUID();
    } catch (_) { /* fall through */ }
    return 'rec_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e9).toString(36);
}

export function createDraft({ userId, sourceYear, nextYearLabel, sourceFingerprint }) {
    return {
        draftVersion: DRAFT_VERSION,
        reconciliationId: newReconciliationId(),
        userId,
        sourceYearId: sourceYear.id,
        sourceLabel: sourceYear.label,
        nextYearLabel,
        sourceFingerprint,
        savedAt: new Date().toISOString(),
        bills: {},
        newBills: [],
        charges: [],
        confirmations: { noBillChanges: false, noNewSubscriptions: false, noExtraCharges: false }
    };
}

/** The same fingerprint validateDraft recomputes: live arrays override the year document's. */
export function fingerprintOf(source) {
    return computeSourceFingerprint({
        ...source.sourceYear, bills: source.bills, familyMembers: source.familyMembers, owedAdjustments: source.owedAdjustments,
        payments: source.payments, creditAdjustments: source.creditAdjustments, billingEvents: source.billingEvents
    });
}

export function sourceCounts(source) {
    return {
        payments: (source.payments || []).length, charges: (source.owedAdjustments || []).length,
        credits: (source.creditAdjustments || []).length, bills: (source.bills || []).length,
        members: (source.familyMembers || []).length
    };
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Plain-terms differences between the counts saved with the draft and today's. */
export function describeSourceChange(previous, current, sourceLabel) {
    if (!previous || typeof previous !== 'object') return `${sourceLabel} changed since you saved it`;
    const parts = [];
    const diff = (key, one, many, verbAdd, verbRemove) => {
        const delta = (current[key] ?? 0) - (previous[key] ?? 0);
        if (delta > 0) parts.push(`${plural(delta, one, many)} ${verbAdd}`);
        else if (delta < 0) parts.push(`${plural(-delta, one, many)} ${verbRemove}`);
    };
    diff('payments', 'payment', 'payments', 'recorded', 'removed');
    diff('charges', 'charge or credit record', 'charge or credit records', 'added', 'removed');
    diff('credits', 'credit adjustment', 'credit adjustments', 'added', 'removed');
    diff('bills', 'bill', 'bills', 'added', 'removed');
    diff('members', 'member', 'members', 'added', 'removed');
    return parts.length ? `${sourceLabel} changed since you saved it: ${parts.join(', ')}` : `${sourceLabel} changed since you saved it`;
}

// ── Households ───────────────────────────────────────────────────────────────

/** Primary members with their linked members, in member order (ADR 0001). */
export function householdsOf(familyMembers) {
    return familyMembers.filter(member => !isLinkedToAnyone(familyMembers, member.id)).map(primary => {
        const members = getHouseholdMemberIds(primary).map(id => familyMembers.find(member => member.id === id)).filter(Boolean);
        const named = getHouseholdName(primary, familyMembers);
        return { id: primary.id, name: members.length > 1 ? (named ? named + ' household' : 'Household') : primary.name, individual: members.length === 1, members };
    });
}

export function memberName(familyMembers, memberId) {
    return familyMembers.find(member => member.id === memberId)?.name ?? 'Unknown member';
}

/** Existing deferred Usage Charges (carried once, never re-recorded). */
export function deferredCharges(owedAdjustments) {
    return (owedAdjustments || []).filter(record => record && record.kind === 'usage_charge' && record.status === 'deferred');
}

/** Active Service Credit records recorded against a bill during the year. */
export function creditsOnBill(owedAdjustments, billId) {
    return (owedAdjustments || []).filter(record => record && record.kind === 'service_credit' && record.status === 'active' && record.billId === billId);
}

// ── Derived state ────────────────────────────────────────────────────────────

const unitOf = bill => (bill.billingFrequency === 'annual' ? 'year' : 'month');

function creditSentence(record, familyMembers) {
    return `${memberName(familyMembers, record.memberId)}’s ${money(record.amount)} credit from ${formatDate(record.incurredDate || (record.createdAt || '').slice(0, 10))}`;
}

/** The answer a record currently stands at, after the per-member remaining share is applied in list order. */
function resolveCredits(bill, row, base, ctx, flags) {
    const live = creditsOnBill(ctx.owedAdjustments, bill.id);
    const checked = revalidateExistingCreditAnswers(row, live, base);
    const running = new Map();
    const resolved = [];
    const shareOf = memberId => base.shares.find(share => share.memberId === memberId)?.shareCents ?? 0;
    const apply = new Map();
    for (const record of live) {
        const answer = checked.existingCredits[record.id];
        const amountCents = toCents(record.amount);
        const entry = { record, amountCents, answer: answer || null, applied: 0, complete: false, message: null, flag: flags?.[record.id] || null };
        if (answer) {
            const share = shareOf(record.memberId);
            const used = running.get(record.memberId) || 0;
            const applied = answer.choice === 'covers' ? amountCents : answer.choice === 'partial' ? answer.appliedCents : 0;
            if (answer.choice === 'partial' && !(Number.isSafeInteger(applied) && applied > 0 && applied < amountCents)) {
                entry.message = `Enter how much of ${creditSentence(record, ctx.familyMembers)} covers this change.`;
            } else if (applied > share - used) {
                entry.message = `${memberName(ctx.familyMembers, record.memberId)}’s remaining share is now ${money((share - used) / 100)}; answer ${creditSentence(record, ctx.familyMembers)} again.`;
            } else {
                entry.applied = applied;
                entry.complete = true;
                running.set(record.memberId, used + applied);
                apply.set(record.id, answer);
            }
        } else {
            entry.message = `Say whether ${creditSentence(record, ctx.familyMembers)} covers this change.`;
        }
        resolved.push(entry);
    }
    for (const entry of resolved) {
        const share = shareOf(entry.record.memberId);
        entry.remainingCents = share - ((running.get(entry.record.memberId) || 0) - entry.applied);
    }
    return { resolved, answers: Object.fromEntries(apply), checked };
}

function monthMissing(row, field) {
    return !(typeof row[field] === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(row[field]));
}

function outcomeNote(result, bill, row, next) {
    const kept = result.billOutcome === 'kept_at_new_price';
    const tail = kept ? `${next} uses ${money(row.nextYearAmount ?? row.newAmount ?? bill.amount)}` : `the bill is left out of ${next}`;
    switch (result.zeroReason) {
        case 'no_members': return `No members on this bill—nothing to credit or charge. ${kept ? `${next} uses ${money(row.nextYearAmount ?? row.newAmount ?? bill.amount)}.` : `The bill is left out of ${next}.`}`;
        case 'no_months': return `Ended in December—records nothing, left out of ${next}.`;
        case 'rounds_to_zero': return `Rounds to $0.00—nothing to record; ${tail}.`;
        case 'covered': return `Nothing more to record; ${tail}.`;
        default: return null;
    }
}

function deriveBill(bill, row, ctx) {
    const next = ctx.nextYearLabel;
    const out = { billId: bill.id, change: row.change, errors: {}, result: null, credits: [], unanswered: [], note: null, base: null, nextYearAmount: null };
    out.nextYearAmount = row.change === 'ended' ? null : row.nextYearAmount ?? (row.change === 'price_change' ? row.newAmount : bill.amount);
    if (row.change !== 'ended' && row.nextYearAmount !== undefined && row.nextYearAmount !== null && !isPositive(row.nextYearAmount)) {
        out.errors.nextYearAmount = `Enter a ${next} price greater than $0.00.`;
    }
    if (row.change === 'unchanged') return out;
    const err = (field, message) => { out.errors[field] = message; };
    if (row.change === 'price_change') {
        if (row.newAmount === undefined || row.newAmount === null) err('newAmount', 'Enter the new price.');
        else if (!isPositive(row.newAmount)) err('newAmount', 'Enter a price greater than $0.00.');
        else if (row.newAmount === bill.amount) err('newAmount', 'No change—leave the bill Unchanged or enter a different price.');
        if (monthMissing(row, 'firstMonth')) err('firstMonth', isPositive(row.newAmount) ? `Choose the first month billed at ${money(row.newAmount)}.` : 'Choose the first month billed at the new price.');
    } else if (monthMissing(row, 'lastMonth')) {
        err('lastMonth', 'Choose the last month of service.');
    }
    if (row.override !== undefined && row.override !== null && !(isPositive(row.override) && toCents(row.override) > 0)) {
        err('override', 'Enter an amount greater than $0.00. An override of $0.00 is not allowed.');
    }
    if (Object.keys(out.errors).some(field => field !== 'nextYearAmount')) return out;

    const compute = row.change === 'ended' ? computeEnded : computePriceChange;
    const sourceYear = ctx.sourceYear;
    let base;
    try {
        base = compute(bill, row, { sourceYear, skipExistingCredits: true });
    } catch (error) {
        err('_', error.message);
        return out;
    }
    out.base = base;
    let answers = {};
    if (base.kind === 'service_credit' && base.grossCents > 0 && base.shares.length) {
        const { resolved, answers: valid } = resolveCredits(bill, row, base, ctx, ctx.flags?.[bill.id]);
        out.credits = resolved;
        answers = valid;
        out.unanswered = resolved.filter(entry => !entry.complete);
        if (out.unanswered.length) {
            err('credits', out.unanswered[0].message);
            return out;
        }
    }
    try {
        out.result = compute(bill, { ...row, existingCredits: answers }, { sourceYear, owedAdjustments: ctx.owedAdjustments });
    } catch (error) {
        err('_', error.message);
        return out;
    }
    out.note = outcomeNote(out.result, bill, row, next);
    return out;
}

function deriveNewBill(row, ctx) {
    const out = { rowId: row.rowId, errors: {}, result: null };
    const err = (field, message) => { out.errors[field] = message; };
    if (typeof row.name !== 'string' || !row.name.trim()) err('name', 'Enter a name for the subscription.');
    if (row.amount === undefined || row.amount === null) err('amount', 'Enter the price.');
    else if (!isPositive(row.amount)) err('amount', 'Enter a price greater than $0.00.');
    if (monthMissing(row, 'firstMonth')) err('firstMonth', 'Choose the first month of service.');
    if (!Array.isArray(row.members) || row.members.length === 0) err('members', 'Choose at least one member for a new subscription.');
    else if (row.members.some(memberId => !ctx.familyMembers.some(member => member.id === memberId))) err('members', 'A selected member no longer exists. Choose the members again.');
    if (row.override !== undefined && row.override !== null && !(isPositive(row.override) && toCents(row.override) > 0)) {
        err('override', 'Enter an amount greater than $0.00. An override of $0.00 is not allowed.');
    }
    if (Object.keys(out.errors).length) return out;
    try {
        out.result = computeLateStart({ ...row, name: row.name.trim() }, { sourceYear: ctx.sourceYear });
    } catch (error) {
        err('_', error.message);
    }
    return out;
}

function deriveCharge(row, ctx) {
    const out = { rowId: row.rowId, errors: {} };
    if (!ctx.familyMembers.some(member => member.id === row.memberId)) out.errors.memberId = 'Choose a member.';
    if (!isPositive(row.amount) || toCents(row.amount) <= 0) out.errors.amount = 'Enter an amount greater than zero.';
    if (typeof row.description !== 'string' || !row.description.trim()) out.errors.description = 'Enter a description.';
    if (typeof row.incurredDate !== 'string' || !row.incurredDate) out.errors.incurredDate = 'Choose the date this charge was incurred.';
    if (Object.keys(out.errors).length) return out;
    try {
        buildUsageChargeRecord(row, { sourceYearId: ctx.sourceYear.id, reconciliationId: ctx.reconciliationId, now: new Date().toISOString(), familyMembers: ctx.familyMembers });
    } catch (error) {
        out.errors._ = error.message;
    }
    return out;
}

/**
 * Derived, never stored (spec § Draft): the computed results and validation of
 * Steps 1–3. ctx = { draft, sourceYear, bills, familyMembers, owedAdjustments, flags }.
 */
export function deriveReview(ctx) {
    const { draft } = ctx;
    const full = { ...ctx, nextYearLabel: draft.nextYearLabel, reconciliationId: draft.reconciliationId };
    const bills = {};
    for (const bill of ctx.bills) bills[bill.id] = deriveBill(bill, draft.bills[bill.id] || { change: 'unchanged' }, full);
    const newBills = {};
    for (const row of draft.newBills) newBills[row.rowId] = deriveNewBill(row, full);
    const charges = {};
    for (const row of draft.charges) charges[row.rowId] = deriveCharge(row, full);
    const stepErrors = { 1: [], 2: [], 3: [] };
    for (const bill of ctx.bills) {
        for (const [field, message] of Object.entries(bills[bill.id].errors)) stepErrors[1].push({ billId: bill.id, field, message });
    }
    for (const row of draft.newBills) for (const [field, message] of Object.entries(newBills[row.rowId].errors)) stepErrors[2].push({ rowId: row.rowId, field, message });
    for (const row of draft.charges) for (const [field, message] of Object.entries(charges[row.rowId].errors)) stepErrors[3].push({ rowId: row.rowId, field, message });
    const changed = Object.values(bills).filter(item => item.change !== 'unchanged');
    const summary = {
        priceChanges: changed.filter(item => item.change === 'price_change').length,
        ended: changed.filter(item => item.change === 'ended').length,
        unchanged: ctx.bills.length - changed.length,
        trueUpCents: 0, trueUpShares: 0, creditCents: 0, creditShares: 0, coveredCents: 0
    };
    const tally = (result) => {
        if (!result) return;
        const positive = result.shares.filter(share => share.netCents > 0);
        if (result.kind === 'usage_charge') { summary.trueUpCents += result.grossCents; summary.trueUpShares += positive.length; }
        else { summary.creditCents += result.grossCents; summary.creditShares += positive.length; summary.coveredCents += result.calc.alreadyCreditedCents; }
    };
    changed.forEach(item => tally(item.result));
    Object.values(newBills).forEach(item => tally(item.result));
    return { bills, newBills, charges, stepErrors, summary };
}

/** Per-step "is anything here" for the Nothing changed confirmations. */
export function entryCounts(draft) {
    return {
        bills: Object.values(draft.bills).filter(row => row.change && row.change !== 'unchanged').length,
        newBills: draft.newBills.length,
        charges: draft.charges.length
    };
}

/** Answers cleared by a restore or an edit, as the plain-language flags the row shows. */
export function explainClearedAnswers(previousAnswers, nextAnswers, liveRecords, familyMembers, cause = 'months') {
    const flags = {};
    for (const [adjustmentId, answer] of Object.entries(previousAnswers || {})) {
        if (nextAnswers && nextAnswers[adjustmentId]) continue;
        const record = liveRecords.find(item => String(item.id) === adjustmentId);
        if (!record) continue;
        let changedRecord = false;
        try { changedRecord = JSON.stringify(answer.seen) !== JSON.stringify(snapshotExistingCredit(record)); } catch (_) { changedRecord = true; }
        flags[adjustmentId] = changedRecord
            ? `Answer again: ${memberName(familyMembers, record.memberId)}’s ${money(record.amount)} credit changed`
            : (cause === 'months' ? 'Answer again: the months this change covers changed' : 'Answer again: the change this credit covers changed');
    }
    return flags;
}

/** Coverage identity the stored answer is bound to (spec § Draft). */
export function coverageFor(base, memberId) { return existingCreditCoverage(base, memberId); }
export { snapshotExistingCredit, unitOf };
