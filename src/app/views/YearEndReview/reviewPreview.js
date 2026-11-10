/**
 * Step 4's household preview (specs/year-end-review.md § Household preview).
 *
 * The preview is a dry run of the exact pure builder Start commits through:
 * buildReviewedRollover (#606) rebuilds every record from the payload, carries
 * over the updated state and derives the next-year bills, and the library's
 * buildHouseholdPreview projects the households from that finalized carry. So
 * the figures shown are the figures written; nothing here touches Firestore.
 */
import { buildReviewedRollover } from '../../../lib/billing-year.js';
import { buildHouseholdPreview, computePayloadFingerprint, toCents } from '../../../lib/year-end-review.js';
import { buildReconciliationPayload } from './reconciliationPayload.js';

const sumCents = values => values.reduce((total, value) => total + toCents(value), 0);
const sameId = (a, b) => String(a) === String(b);

/** Totals across the households the preview could compute (cents-exact sums, returned in dollars). */
export function previewTotals(households) {
    const ok = households.filter(household => household.ok);
    const total = field => sumCents(ok.map(household => household[field])) / 100;
    return {
        households: ok.length,
        sourceBillTotal: total('sourceBillTotal'),
        nextBillTotal: total('nextBillTotal'),
        subscriptionDelta: total('subscriptionDelta'),
        carriedTotal: total('carriedTotal'),
        firstInvoiceTotal: total('firstInvoiceTotal')
    };
}

/** What Start will write, in counts, from the prepared (not yet committed) rollover. */
export function startStatement(prepared, payload, sourceBills) {
    const appended = prepared.priorYear.owedAdjustments.filter(record => record && record.reconciliationId === payload.reconciliationId);
    const trueUps = appended.filter(record => record.kind === 'usage_charge' && record.basis);
    const credits = appended.filter(record => record.kind === 'service_credit');
    const charges = appended.filter(record => record.kind === 'usage_charge' && !record.basis);
    const nextBills = prepared.newYearData.bills;
    const sourceBill = id => sourceBills.find(bill => sameId(bill.id, id));
    return {
        trueUpShares: trueUps.length, trueUpTotal: sumCents(trueUps.map(record => record.amount)) / 100,
        creditShares: credits.length, creditTotal: sumCents(credits.map(record => record.amount)) / 100,
        chargeCount: charges.length, chargeTotal: sumCents(charges.map(record => record.amount)) / 100,
        reusedCharges: payload.usageCharges.filter(row => row.existingAdjustmentId !== undefined).length,
        coveredCount: prepared.summary.coveredCount,
        newBills: payload.newBills.map(row => row.name),
        repriced: nextBills.filter(bill => sourceBill(bill.id) && sourceBill(bill.id).amount !== bill.amount).map(bill => bill.name),
        keptPrice: nextBills.filter(bill => sourceBill(bill.id) && sourceBill(bill.id).amount === bill.amount).length,
        ended: payload.endedBillIds.map(id => sourceBill(id)?.name).filter(Boolean),
        householdsCarrying: prepared.carry.memberCount,
        nothingNew: appended.length === 0
    };
}

/** Refunds re-opened by an active not_received stay in the source year, per household (spec § Itemized carry (c)). */
export function reopenedRefunds(source, reopenedAdjustmentIds, memberIds) {
    if (!reopenedAdjustmentIds || reopenedAdjustmentIds.size === 0) return 0;
    const ids = new Set(memberIds.map(String));
    return sumCents((source.creditAdjustments || [])
        .filter(record => record && reopenedAdjustmentIds.has(record.id) && ids.has(String(record.memberId)))
        .map(record => Math.abs(record.amount))) / 100;
}

/**
 * @param {{ source: Object, draft: Object, derived: Object, yearId: string,
 *   reopenedAdjustmentIds: Set, now: string }} input
 * @returns {{ ok: boolean, payload: Object, error?: string, prepared?: Object, households?: Array,
 *   totals?: Object, statement?: Object, payloadFingerprint?: string }}
 */
export function previewRollover({ source, draft, derived, yearId, reopenedAdjustmentIds, now }) {
    const payload = buildReconciliationPayload(draft, source, { derived, lenient: true });
    try {
        let sequence = 0;
        const prepared = buildReviewedRollover({
            activeYear: source.sourceYear, familyMembers: source.familyMembers, bills: source.bills,
            payments: source.payments, creditAdjustments: source.creditAdjustments, owedAdjustments: source.owedAdjustments,
            billingEvents: source.billingEvents, settings: source.settings || {}
        }, yearId, payload, { now, eventId: () => 'preview_' + (sequence += 1), reopenedAdjustmentIds });
        const households = buildHouseholdPreview({ familyMembers: source.familyMembers, sourceBills: source.bills,
            nextBills: prepared.newYearData.bills, carry: prepared.carry });
        return { ok: true, payload, prepared, households, totals: previewTotals(households),
            statement: startStatement(prepared, payload, source.bills), payloadFingerprint: computePayloadFingerprint(payload, yearId) };
    } catch (error) {
        return { ok: false, payload, error: error.message };
    }
}
