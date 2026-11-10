/**
 * The one mapping from the Year-End Review draft (#608, specs/year-end-review.md
 * § Draft) to the `reconciliation` payload `createYear` consumes (#606,
 * buildReviewedRollover's JSDoc in src/lib/billing-year.js, § Rollover). Pure.
 *
 * The two shapes do not line up one to one; every difference is bridged here
 * and nowhere else:
 *   1. The draft keys bill changes by bill id with `change: 'price_change'` for
 *      either direction; the payload splits them by direction into `trueUps`
 *      (an increase) and `serviceCredits` with `basis: 'price_change'` (a
 *      decrease). Only a decrease carries its existing-credit answers.
 *   2. A draft `change: 'ended'` becomes a `serviceCredits` entry with
 *      `basis: 'ended'` AND an `endedBillIds` entry (the builder requires both).
 *   3. The draft's per-bill `nextYearAmount` becomes `billOverrides[billId]`;
 *      an ended bill has no next-year price, so it is never sent.
 *   4. Existing deferred Usage Charges are not in the draft at all (Step 3 lists
 *      them read-only from the source year); the payload names each one as
 *      `{ existingAdjustmentId }` so the builder reuses it by id and asserts it
 *      carried, never recording it again.
 *   5. The draft's Step 3 rows map to `usageCharges` rows and its Step 2 rows to
 *      `newBills`, with names and descriptions trimmed and empty optional fields
 *      (`override: null/undefined`, `website: undefined`) normalized away.
 *   6. The draft carries `nextYearLabel`; the payload does not (it is
 *      createYear's `yearId` and enters computePayloadFingerprint separately).
 *      `savedAt`, `userId`, `draftVersion` and `sourceLabel` are draft-only.
 *   7. The draft's `sourceFingerprint` (the reviewed one) is sent unchanged.
 *
 * `lenient` is for the Step 4 preview only: rows with validation errors are
 * left out so the rest can still be previewed (the figures are then marked
 * pending and Start is disabled). Start always builds the strict payload.
 */

const present = value => value !== undefined && value !== null;
const has = (errors, ignore = []) => Object.keys(errors || {}).some(field => !ignore.includes(field));

function optional(entry, fields) {
    for (const [key, value] of Object.entries(fields)) if (present(value)) entry[key] = value;
    return entry;
}

/** The source year's deferred Usage Charges, reused by id (never re-recorded). */
export function deferredChargeIds(owedAdjustments) {
    return (owedAdjustments || []).filter(record => record && record.kind === 'usage_charge' && record.status === 'deferred').map(record => record.id);
}

/**
 * @param {Object} draft the validated input-only draft
 * @param {{ bills: Array, owedAdjustments: Array }} source the source year's live data
 * @param {{ derived?: Object, lenient?: boolean }} [options] derived = deriveReview() output (needed for lenient)
 * @returns {Object} the reconciliation payload
 */
export function buildReconciliationPayload(draft, source, { derived = null, lenient = false } = {}) {
    const trueUps = [];
    const serviceCredits = [];
    const endedBillIds = [];
    const billOverrides = {};
    for (const bill of source.bills) {
        const row = draft.bills[bill.id];
        if (!row) continue;
        const errors = derived?.bills?.[bill.id]?.errors || {};
        const skipChange = lenient && has(errors, ['nextYearAmount']);
        const answers = row.existingCredits && Object.keys(row.existingCredits).length ? structuredClone(row.existingCredits) : null;
        if (row.change === 'price_change' && !skipChange) {
            const entry = optional({ billId: bill.id, newAmount: row.newAmount, firstMonth: row.firstMonth }, { override: row.override });
            if (row.newAmount > bill.amount) trueUps.push(entry);
            else serviceCredits.push(optional({ ...entry, basis: 'price_change' }, { existingCredits: answers }));
        } else if (row.change === 'ended' && !skipChange) {
            serviceCredits.push(optional({ billId: bill.id, basis: 'ended', lastMonth: row.lastMonth }, { override: row.override, existingCredits: answers }));
            endedBillIds.push(bill.id);
        }
        const ended = row.change === 'ended' && !skipChange;
        if (!ended && present(row.nextYearAmount) && !(lenient && errors.nextYearAmount)) billOverrides[bill.id] = row.nextYearAmount;
    }
    const newBills = draft.newBills
        .filter(row => !(lenient && has(derived?.newBills?.[row.rowId]?.errors)))
        .map(row => optional({
            rowId: row.rowId, billId: row.billId, name: typeof row.name === 'string' ? row.name.trim() : row.name, amount: row.amount,
            frequency: row.frequency, website: row.website || '', members: [...(row.members || [])], firstMonth: row.firstMonth
        }, { override: row.override }));
    const usageCharges = [
        ...deferredChargeIds(source.owedAdjustments).map(existingAdjustmentId => ({ existingAdjustmentId })),
        ...draft.charges
            .filter(row => !(lenient && has(derived?.charges?.[row.rowId]?.errors)))
            .map(row => ({ rowId: row.rowId, memberId: row.memberId, amount: row.amount,
                description: typeof row.description === 'string' ? row.description.trim() : row.description, incurredDate: row.incurredDate }))
    ];
    return {
        reconciliationId: draft.reconciliationId,
        sourceYearId: draft.sourceYearId,
        sourceFingerprint: draft.sourceFingerprint,
        trueUps, serviceCredits, usageCharges, billOverrides, endedBillIds, newBills,
        confirmations: { ...draft.confirmations }
    };
}
