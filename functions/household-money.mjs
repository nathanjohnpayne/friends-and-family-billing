/**
 * Unused ADR 0010 source-domain adapter. No IO or production imports.
 * All monetary output is safe integer cents. A held household returns diagnostics
 * and no money; sibling households can still be assessed. Source records are never
 * changed. Artifact admission and coherent caller activation are separate gates.
 */
import { MoneyIntegrityError, rational, exactNumber, multiplyExact, divideExact,
    sumExact, quantizeDollarsToCents, allocateCents } from './money.mjs';

const hundred = rational(100n);
const exact = exactNumber;
const sum = sumExact;
const q = quantizeDollarsToCents;
const clone = value => structuredClone(value);
const idsFor = member => [member.id, ...(member.linkedMembers || [])];
const observedType = value => value === null ? 'null' : typeof value;

function fail(code, recordId, component, field, value, message) {
    const error = new MoneyIntegrityError(code, message);
    error.source = { recordId, component, field, observedType: observedType(value) };
    throw error;
}

function key(value, component, field = 'id') {
    if (!((typeof value === 'string' && value.trim()) || Number.isSafeInteger(value))) {
        fail('INVALID_ID', value, component, field, value, 'Missing or ambiguous source id');
    }
    return String(value);
}

/** Integer arithmetic also fails closed if composition exceeds safe cents. */
function integerSum(...values) {
    return q(rational(values.reduce((total, value) => total + BigInt(value), 0n), 100n));
}

function nonnegativeSum(...values) {
    const total = values.reduce((value, next) => value + BigInt(next), 0n);
    return q(rational(total < 0n ? 0n : total, 100n));
}

function snapshotDollars(cents, recordId) {
    const value = cents / 100;
    if (toExactCents(value) !== cents) {
        fail('UNSAFE_CENTS', recordId, 'carry', 'amount', value,
            'Dollar snapshot cannot preserve the assigned integer cents');
    }
    return value === 0 ? 0 : value;
}

/** Exact replacement for the legacy review toCents edge; no epsilon or coercion. */
export function toExactCents(value) { return q(exact(value)); }

/** Same review binding fields; monetary comparison uses the exact edge. */
export function snapshotExactCredit(record) {
    return { memberId: record.memberId, amountCents: toExactCents(record.amount),
        incurredDate: record.incurredDate ?? null, reason: record.reason ?? null,
        createdAt: record.createdAt ?? null, status: record.status };
}

function admit(source, member, reopened) {
    const ids = idsFor(member);
    const belongs = row => row && ids.includes(row.memberId);
    // calculateAnnualSummary admits through object keys, then getHouseholdFinancials
    // iterates primary/linked ids. Preserve both repeated bill assignments and the
    // full assigned-member denominator, including ids absent from familyMembers.
    const present = new Set((source.familyMembers || []).map(row => String(row.id)));
    const bills = (source.bills || []).flatMap(bill => {
        if (!bill.members?.length) return [];
        const count = bill.members.reduce((total, id) => total + (present.has(String(id))
            ? ids.filter(householdId => String(householdId) === String(id)).length : 0), 0);
        return count ? [{ record: bill, count }] : [];
    });
    const owed = (source.owedAdjustments || []).filter(belongs);
    return { bills,
        S: owed.filter(row => row.kind === 'service_credit' && row.status === 'active'),
        O: owed.filter(row => row.kind === 'carry_opening' && row.status !== 'voided'),
        P: (source.payments || []).filter(belongs),
        R: (source.creditAdjustments || []).filter(row => belongs(row)
            && row.status !== 'cancelled' && !reopened?.has(row.id)),
        B: owed.filter(row => row.kind === 'usage_charge' && row.status === 'billed'),
        deferred: owed.filter(row => row.kind === 'usage_charge' && row.status === 'deferred') };
}

function sourceHolds(rows, householdId) {
    const holds = [];
    const check = (row, component, field = 'amount', recordId = row?.id, positive = false) => {
        const value = row?.[field];
        const finite = typeof value === 'number' && Number.isFinite(value);
        if (!finite || (positive && value <= 0)) holds.push({ householdId, recordId,
            component, field, observedType: observedType(value),
            code: finite ? 'INVALID_DOMAIN' : 'INVALID_NUMBER',
            message: finite ? 'Non-positive source was silently dropped by the legacy guard'
                : 'Admitted money field must be an actual finite Number' });
    };
    rows.bills.forEach(({ record }) => check(record, 'G'));
    for (const component of ['S', 'O', 'P', 'R', 'B', 'deferred']) {
        rows[component].forEach(row => {
            check(row, component, 'amount', row.id, component === 'S' || component === 'B');
            if (component !== 'O') return;
            Array.from(Array.isArray(row.items) ? row.items : []).forEach((item, index) => {
                const itemId = item?.sourceId ?? String(row.id) + '.items[' + index + ']';
                check(item, 'O', 'amount', itemId);
                Array.from(Array.isArray(item?.detail) ? item.detail : []).forEach((detail, detailIndex) =>
                    check(detail, 'O', 'amount', detail?.sourceId ?? itemId + '.detail[' + detailIndex + ']'));
            });
        });
    }
    return holds;
}

function allocate(rows, target, component) {
    try {
        const assigned = allocateCents(rows.map(row => ({ id: row.tieKey ?? row.id,
            exactCents: multiplyExact(row.value, hundred) })), target);
        return rows.map((row, index) => ({ ...row, cents: assigned[index].cents }));
    } catch (error) {
        if (!(error instanceof MoneyIntegrityError)) throw error;
        error.source = { recordId: rows.map(row => row.id), component, field: 'id/amount',
            observedType: 'projection', ...error.source };
        throw error;
    }
}

function rawRows(records, component, idField = 'id') {
    return records.map(record => ({ id: key(record[idField], component, idField),
        value: exact(record.amount), record }));
}

function uniqueRows(rows, component) {
    const seen = new Set();
    rows.forEach(row => {
        if (seen.has(row.id)) fail('DUPLICATE_ID', row.id, component, 'id', row.id, 'Ambiguous source id');
        seen.add(row.id);
    });
}

function projectRecords(records, component) {
    const rows = rawRows(records, component);
    const cents = q(sum(rows.map(row => row.value)));
    return { cents, rows: allocate(rows, cents, component) };
}

/** Private grouping: exact amounts come exclusively from validated child rows. */
function groupRows(rows, groups, target, component) {
    uniqueRows(rows, component);
    const byId = new Map(rows.map(row => [row.id, row]));
    const used = new Set();
    const parents = groups.map(ids => {
        if (!Array.isArray(ids) || !ids.length) {
            fail('INVALID_PROVENANCE', ids, component, 'groups', ids, 'Groups must be nonempty id lists');
        }
        const children = ids.map(id => {
            const canonical = key(id, component, 'sourceId');
            if (!byId.has(canonical) || used.has(canonical)) {
                fail('INVALID_PROVENANCE', id, component, 'groups', id, 'Duplicate or foreign constituent id');
            }
            used.add(canonical);
            return byId.get(canonical);
        });
        const sortedIds = children.map(row => row.id).sort();
        return { id: JSON.stringify(sortedIds), tieKey: sortedIds[0], sourceIds: sortedIds,
            value: sum(children.map(row => row.value)), children };
    });
    if (used.size !== rows.length) {
        fail('INVALID_PROVENANCE', rows.filter(row => !used.has(row.id)).map(row => row.id),
            component, 'groups', groups, 'Groups must cover the entire declared parent');
    }
    return allocate(parents, target, component).map(parent => ({ ...parent,
        children: allocate(parent.children, parent.cents, component) }));
}

function projectGroups(records) {
    const rows = rawRows(records, 'S');
    const groups = new Map();
    rows.forEach(row => {
        const group = String(row.record.billId) + '|' + (row.record.reason || '');
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(row.id);
    });
    const cents = q(sum(rows.map(row => row.value)));
    return { cents, rows: groupRows(rows, [...groups.values()], cents, 'S') };
}

function projectPayments(records) {
    const rows = rawRows(records, 'P');
    const cents = q(sum(rows.map(row => row.value)));
    // Validate all ids before resolving links, including canonical string collisions.
    uniqueRows(rows, 'P');
    const byId = new Map(rows.map(row => [row.id, row]));
    const pairs = new Map();
    const invalid = (row, field = 'reversesPaymentId') => fail('INVALID_REVERSAL', row.record.id, 'P',
        field, row.record[field], 'Malformed or unmatched reversal');
    rows.forEach(row => {
        const record = row.record;
        // Legacy public writers treat truthy markers as a reversal claim. A
        // non-boolean truthy marker cannot silently hide an unpaired payment.
        if (record.reversed && record.reversed !== true) invalid(row, 'reversed');
        if (record.type !== 'reversal' && record.reversesPaymentId === undefined) return;
        if (record.type !== 'reversal') invalid(row);
        let originalId;
        try { originalId = key(record.reversesPaymentId, 'P', 'reversesPaymentId'); }
        catch (error) {
            if (!(error instanceof MoneyIntegrityError)) throw error;
            invalid(row);
        }
        const original = byId.get(originalId);
        if (!original || original === row || original.record.type === 'reversal'
            || original.record.reversed !== true || original.record.memberId !== record.memberId
            || pairs.has(original.id) || sum([original.value, row.value]).numerator !== 0n) invalid(row);
        pairs.set(original.id, row);
    });
    rows.forEach(row => { if (row.record.reversed === true && !pairs.has(row.id)) invalid(row, 'reversed'); });
    const paired = new Map();
    pairs.forEach((reversal, originalId) => {
        const original = byId.get(originalId);
        paired.set(originalId, q(original.value));
        paired.set(reversal.id, -q(original.value) || 0);
    });
    const remaining = allocate(rows.filter(row => !paired.has(row.id)), cents, 'P');
    const assigned = new Map(remaining.map(row => [row.id, row.cents]));
    return { cents, rows: rows.map(row => ({ ...row,
        cents: paired.has(row.id) ? paired.get(row.id) : assigned.get(row.id),
        publicVisible: row.record.type !== 'reversal' && !row.record.reversed })) };
}

function projectOpening(records, householdIds, detailGroups) {
    const seeds = rawRows(records, 'O');
    const cents = q(sum(seeds.map(row => row.value)));
    const ensureParent = (parent, children) => {
        if (q(sum(children.map(row => row.value))) !== q(parent.value)) {
            fail('PARENT_MISMATCH', parent.id, 'O', 'amount', parent.record.amount,
                'Canonical-cent parent/child totals disagree');
        }
    };
    const attribution = (record, fallback) => {
        const id = record.memberId ?? fallback;
        if (id !== null && !householdIds.includes(id)) {
            fail('INVALID_PROVENANCE', record.sourceId, 'O', 'memberId', id,
                'Opening line belongs to another household');
        }
    };
    const usedGroups = new Set();
    const rows = allocate(seeds, cents, 'O').map(seed => {
        if (seed.record.items === undefined) return { ...seed, opaque: true };
        if (!Array.isArray(seed.record.items)) {
            fail('INVALID_PROVENANCE', seed.id, 'O', 'items', seed.record.items, 'Items must be an array');
        }
        const items = rawRows(seed.record.items, 'O', 'sourceId');
        ensureParent(seed, items);
        return { ...seed, items: allocate(items, seed.cents, 'O').map(item => {
            attribution(item.record, seed.record.memberId);
            if (item.record.kind !== 'credit') return item;
            if (!Array.isArray(item.record.detail)) {
                fail('INVALID_PROVENANCE', item.id, 'O', 'detail', item.record.detail, 'Credit detail must be an array');
            }
            const detail = item.record.detail.map(record => {
                attribution(record, null);
                let id = record.sourceId;
                if (id === undefined && ['unused', 'remainder', 'applied'].includes(record.kind)) {
                    id = JSON.stringify([seed.id, item.id, record.kind]);
                }
                return { id: key(id, 'O', 'sourceId'), value: exact(record.amount), record };
            });
            ensureParent(item, detail);
            const options = detailGroups.filter(group => String(group.seedId) === seed.id
                && String(group.itemSourceId) === item.id);
            if (options.length > 1) {
                fail('INVALID_PROVENANCE', item.id, 'O', 'groups', options, 'Duplicate parent group declaration');
            }
            if (options.length) usedGroups.add(options[0]);
            return { ...item, detail: options.length
                ? groupRows(detail, options[0].groups, item.cents, 'O')
                : allocate(detail, item.cents, 'O') };
        }) };
    });
    if (usedGroups.size !== detailGroups.length) {
        fail('INVALID_PROVENANCE', detailGroups.filter(group => !usedGroups.has(group)).map(group => group.itemSourceId),
            'O', 'groups', detailGroups, 'Unknown declared credit-detail parent');
    }
    return { cents, rows };
}

/**
 * Project a complete current OR proposed post-mutation raw snapshot. Candidate
 * caps compare this result, never q(request) or old component + rounded request.
 * This function imposes no payment request amount ceiling and performs no writes.
 */
export function projectHouseholdMoney(source, member, { reopenedAdjustmentIds = null, detailGroups = [] } = {}) {
    const householdId = member.id;
    try {
        const admitted = admit(source, member, reopenedAdjustmentIds);
        const holds = sourceHolds(admitted, householdId);
        if (holds.length) return { ok: false, householdId, holds };
        const bills = admitted.bills.map(({ record, count }) => ({ id: key(record.id, 'G'), record,
            value: divideExact(multiplyExact(exact(record.amount), rational(BigInt(count)
                * (record.billingFrequency === 'annual' ? 1n : 12n))), rational(BigInt(record.members.length))) }));
        const G = q(sum(bills.map(row => row.value)));
        const service = projectGroups(admitted.S);
        const opening = projectOpening(admitted.O, idsFor(member), detailGroups);
        const payment = projectPayments(admitted.P);
        const disposition = projectRecords(admitted.R, 'R');
        const billed = projectRecords(admitted.B, 'B');
        const deferred = projectRecords(admitted.deferred, 'deferred');
        const S = service.cents, O = opening.cents, P = payment.cents, R = disposition.cents, B = billed.cents;
        const N = integerSum(P, -R);
        const invoice = nonnegativeSum(G, -S, O);
        const owed = integerSum(invoice, B);
        const balance = integerSum(owed, -N);
        const credit = Math.max(0, -balance);
        const I = Math.max(0, -O), Q = Math.max(0, O);
        const A = nonnegativeSum(G, -S, Q);
        const U = nonnegativeSum(I, -A);
        // Rationals and record references are private and never escape this edge.
        const clean = row => ({ id: row.id, cents: row.cents,
            ...(row.sourceIds ? { sourceIds: [...row.sourceIds] } : {}),
            ...(row.publicVisible !== undefined ? { publicVisible: row.publicVisible } : {}),
            ...(row.opaque ? { opaque: true } : {}),
            ...Object.fromEntries(['items', 'detail', 'children'].filter(field => row[field])
                .map(field => [field, row[field].map(clean)])) });
        return { ok: true, householdId, G, S, O, P, R, B, N, invoice, owed, balance, credit, I, Q, A, U,
            deferredCents: deferred.cents, rows: { bills: allocate(bills, G, 'G').map(clean),
                service: service.rows.map(clean), opening: opening.rows.map(clean),
                payments: payment.rows.map(clean), dispositions: disposition.rows.map(clean),
                billed: billed.rows.map(clean), deferred: deferred.rows.map(clean) } };
    } catch (error) {
        if (!(error instanceof MoneyIntegrityError)) throw error;
        return { ok: false, householdId, holds: [{ householdId, code: error.code,
            recordId: member.id, component: 'composition', field: 'amount', observedType: 'number',
            ...error.source, message: error.message }] };
    }
}

/** Independently assess each primary household; never return partial global totals. */
export function projectHouseholdsMoney(source, options = {}) {
    return (source.familyMembers || []).filter(member => !(source.familyMembers || [])
        .some(other => (other.linkedMembers || []).includes(member.id)))
        .map(member => projectHouseholdMoney(source, member, options));
}

/**
 * Detached carry snapshots and marking ids only. U is optional carry-only money,
 * never a disposition. Null reopening controls amount; supplied reopening controls
 * marking eligibility. No clock, ids, source status, ledger or year is mutated.
 */
export function buildCarryMoneySnapshot(source, { fromYearLabel, nextYearLabel,
    reopenedAdjustmentIds = null, carryUnusedOpeningCredit = false, reviewServiceCredits = [] } = {}) {
    const households = projectHouseholdsMoney(source).map(projection => {
        if (!projection.ok) return projection;
        try {
            const member = source.familyMembers.find(row => row.id === projection.householdId);
            const ids = idsFor(member);
            const admitted = admit(source, member, null);
            // Component ids are unique within the already-validated household;
            // unrelated households/kinds must never supply snapshot metadata.
            const deferredById = new Map(admitted.deferred.map(record => [String(record.id), record]));
            const serviceById = new Map(admitted.S.map(record => [String(record.id), record]));
            const unused = carryUnusedOpeningCredit ? projection.U : 0;
            // ADR 0010 preserves the carry seam's positive aggregate feed gate.
            // A zero monetary contribution is not a malformed-source exclusion.
            if (!(projection.credit > 0 || projection.deferredCents > 0 || unused > 0)) {
                return { ...projection, creditAdjustmentIds: [], openingSeedIds: [],
                    unusedOpeningCreditCents: 0, deferredChargeIds: [], openingBalanceCents: 0, seed: null };
            }
            const openingBalanceCents = integerSum(projection.deferredCents, -projection.credit, -unused);
            const billName = row => row.billName ?? source.bills?.find(bill => bill.id === row.billId)?.name ?? null;
            const items = projection.rows.deferred.map(row => {
                const record = deferredById.get(row.id);
                return { sourceId: record.id, kind: 'usage_charge', basis: record.basis || 'member',
                    memberId: record.memberId, billName: billName(record), description: record.description || '',
                    amount: snapshotDollars(row.cents, record.id), incurredDate: record.incurredDate || null,
                    ...(record.calc ? { calc: clone(record.calc) } : {}) };
            });
            const openingSeedIds = admitted.O.map(row => row.id);
            const totalCredit = integerSum(projection.credit, unused);
            if (totalCredit > 0) {
                const reviewIds = new Set(reviewServiceCredits.filter(row => row && row.kind === 'service_credit'
                    && row.status === 'active' && ids.includes(row.memberId)).map(row => String(row.id)));
                // Reuse allocated S rows; don't independently round detail records.
                const serviceRows = projection.rows.service.flatMap(group => group.children);
                if ([...reviewIds].some(id => !serviceRows.some(row => row.id === id))) {
                    fail('INVALID_PROVENANCE', [...reviewIds], 'carry', 'reviewServiceCredits', reviewServiceCredits,
                        'Review credit must belong to the admitted source snapshot');
                }
                const detail = serviceRows.filter(row => reviewIds.has(row.id)).map(row => {
                    const record = serviceById.get(row.id);
                    return { sourceId: record.id, basis: record.basis ?? null, memberId: record.memberId,
                        billName: billName(record), description: record.reason || '', amount: snapshotDollars(-row.cents, record.id) };
                });
                if (unused > 0) detail.push({ kind: 'unused', description: 'Unused ' + fromYearLabel + ' credit', amount: snapshotDollars(-unused, member.id) });
                const remainder = integerSum(-projection.credit, -unused, ...detail.map(row => -toExactCents(row.amount)));
                if (remainder !== 0) detail.push({ kind: remainder < 0 ? 'remainder' : 'applied',
                    description: remainder < 0 ? 'Other ' + fromYearLabel + ' overpayment'
                        : 'Part applied to your ' + fromYearLabel + ' balance', amount: snapshotDollars(remainder, member.id) });
                items.push({ sourceId: projection.credit > 0 ? 'cadj_carry_' + nextYearLabel + '_' + member.id : openingSeedIds[0],
                    kind: 'credit', basis: 'credit', memberId: member.id, billName: null,
                    description: "Your household's " + fromYearLabel + ' credit',
                    amount: snapshotDollars(-totalCredit, member.id), detail });
            }
            const creditAdjustmentIds = admitted.R.filter(row => !reopenedAdjustmentIds?.has(row.id)).map(row => row.id);
            return { ...projection, creditAdjustmentIds, openingSeedIds, unusedOpeningCreditCents: unused,
                deferredChargeIds: projection.rows.deferred.map(row => deferredById.get(row.id).id),
                openingBalanceCents, seed: items.length ? { id: 'coadj_' + fromYearLabel + '_' + member.id,
                    memberId: member.id, kind: 'carry_opening', status: 'carried_in', fromYear: fromYearLabel,
                    amount: snapshotDollars(openingBalanceCents, member.id), items } : null };
        } catch (error) {
            if (!(error instanceof MoneyIntegrityError)) throw error;
            return { ok: false, householdId: projection.householdId, holds: [{ code: error.code,
                householdId: projection.householdId, component: 'carry', recordId: projection.householdId,
                field: 'amount', observedType: 'number', ...error.source, message: error.message }] };
        }
    });
    const ok = households.every(row => row.ok);
    if (!ok) return { ok, households };
    try {
        return { ok, households, totalOpeningBalanceCents: integerSum(...households.map(row => row.openingBalanceCents)) };
    } catch (error) {
        if (!(error instanceof MoneyIntegrityError)) throw error;
        return { ok: false, households, holds: [{ code: error.code, component: 'carry-total',
            recordId: households.map(row => row.householdId), field: 'totalOpeningBalanceCents',
            observedType: 'number', message: error.message }] };
    }
}

/** Exact monetary portion of review preview; member audit displays stay legacy. */
export function projectHouseholdPreviewMoney(source, member, nextBills, openingSeed = null) {
    const before = projectHouseholdMoney({ familyMembers: source.familyMembers, bills: source.bills }, member);
    if (!before.ok) return before;
    const after = projectHouseholdMoney({ familyMembers: source.familyMembers, bills: nextBills,
        owedAdjustments: openingSeed ? [openingSeed] : [] }, member);
    if (!after.ok) return after;
    try {
        const carriedCharges = integerSum(...after.rows.opening.flatMap(seed => seed.items || [])
            .map(item => Math.max(0, item.cents)));
        return { ok: true, householdId: member.id, sourceBillTotalCents: before.G, nextBillTotalCents: after.G,
            subscriptionDeltaCents: integerSum(after.G, -before.G), carriedTotalCents: after.O,
            carriedChargesCents: carriedCharges, carriedCreditCents: integerSum(after.O, -carriedCharges),
            firstInvoiceTotalCents: after.invoice, remainingCreditCents: after.U };
    } catch (error) {
        if (!(error instanceof MoneyIntegrityError)) throw error;
        return { ok: false, householdId: member.id, holds: [{ householdId: member.id, code: error.code,
            component: 'preview', recordId: member.id, field: 'amount', observedType: 'number', message: error.message }] };
    }
}
