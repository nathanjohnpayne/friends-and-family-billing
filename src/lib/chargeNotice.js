// Charge Notice helpers — pure domain logic for off-cycle billing a member's
// deferred Usage Charges (#320). No DOM, no Firestore, no module-scoped state.
//
// A Charge Notice is the outbound Request (ADR 0002, distinct kind) the
// administrator sends when off-cycle-billing a member's deferred Usage Charges as
// a single invoice — the debit mirror of a Refund Notice. It rides the shared
// `disputes` substrate, raises the member's owed (settled via the normal payments
// ledger), and is contested via the existing Review Request path (no new
// acknowledgment Cloud Function). It is excluded from the Open Reviews KPI.

import { localDateString } from './validation.js';
import { formatAnnualSummaryCurrency } from './formatting.js';

/** Discriminator for a Charge Notice in the shared `disputes` subcollection (ADR 0002). */
export const CHARGE_NOTICE_KIND = 'charge_notice';

/**
 * Inclusive YYYY-MM-DD bounds for the calendar month containing `date`, in the
 * LOCAL timezone. Backs the "this month" preset on the off-cycle billing preview.
 * @param {Date} [date]
 * @returns {{ from: string, to: string }}
 */
export function monthRange(date = new Date()) {
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0); // day 0 of next month = last day
    return { from: localDateString(first), to: localDateString(last) };
}

/**
 * @param {Object} request  a `disputes` subcollection record
 * @returns {boolean} true only for Charge Notices
 */
export function isChargeNotice(request) {
    return !!request && request.kind === CHARGE_NOTICE_KIND;
}

/**
 * Select *deferred* Usage Charges that are billable now for one member OR a whole
 * household (pass an array of member ids — primary plus linked, ADR 0001 grain),
 * optionally filtered to an inclusive incurred-date range (the period). Defaults to
 * ALL of the deferred charges for the given member(s). Already-billed, voided,
 * other-member, and credit-direction (Service Credit) adjustments are excluded.
 * Sorted by incurred date ascending so a preview reads chronologically.
 *
 * @param {Array} owedAdjustments
 * @param {*|Array} memberId  the member id, or an array of household member ids
 * @param {{ from?: string, to?: string }} [range]  inclusive YYYY-MM-DD bounds
 * @returns {Array} the matching deferred usage-charge records
 */
export function selectBillableCharges(owedAdjustments, memberId, range = {}) {
    const { from, to } = range;
    const ids = Array.isArray(memberId) ? memberId : [memberId];
    return (owedAdjustments || [])
        .filter(a =>
            a && ids.includes(a.memberId) && a.kind === 'usage_charge' && a.status === 'deferred'
        )
        .filter(a => {
            const d = String(a.incurredDate || '');
            if (from && d < from) return false;
            if (to && d > to) return false;
            return true;
        })
        .slice()
        .sort((a, b) => String(a.incurredDate || '').localeCompare(String(b.incurredDate || '')));
}

/**
 * Summarize a set of selected charges for the off-cycle billing preview: the count,
 * the grand total, and each charge annotated with a running total (chronological).
 * Only member-safe display fields are surfaced. Mirrors the shape of the share-page
 * pending-charges payload so the preview and the member's view read the same.
 *
 * The grand `total` is rounded ONCE over the raw amounts — the exact formula
 * buildChargeNoticeDoc uses for the persisted `amount` — so the admin preview
 * total can never diverge from the dispute document for fractional-cent charges
 * (PR #328 review r3447513513). The per-row `runningTotal` stays a rounded
 * cumulative display figure.
 *
 * @param {Array} charges  the output of selectBillableCharges
 * @returns {{ charges: Array<{ id: *, description: string, amount: number, incurredDate: string, runningTotal: number }>, total: number, count: number }}
 */
export function summarizeChargePreview(charges) {
    const list = charges || [];
    let running = 0;
    const rows = list.map(a => {
        running = Math.round((running + (a.amount || 0)) * 100) / 100;
        return {
            id: a.id,
            description: a.description || '',
            amount: a.amount || 0,
            incurredDate: a.incurredDate || '',
            runningTotal: running
        };
    });
    const total = Math.round(list.reduce((sum, a) => sum + (a.amount || 0), 0) * 100) / 100;
    return { charges: rows, total, count: rows.length };
}

/**
 * Build the Charge Notice document for the shared `disputes` subcollection.
 * Captures a presentational snapshot of the billed charges (the financial source of
 * truth stays on the owedAdjustments[] records, now `status: 'billed'`). The member
 * pays it via the normal payments ledger or contests it via a Review Request; there
 * is no member-confirmation field (no new acknowledgment Cloud Function, ADR 0005).
 *
 * @param {Object} opts
 * @param {*}        opts.memberId        the household primary being billed
 * @param {string}   opts.memberName
 * @param {string}   opts.chargeNoticeId  links the notice to the billDeferredCharges mutation
 * @param {Array}    opts.charges         the selected (now-billed) usage charges
 * @param {string}   [opts.tokenHash]     share-token hash, when a link was minted
 * @returns {Object} the dispute doc (caller adds createdAt: serverTimestamp())
 */
export function buildChargeNoticeDoc({ memberId, memberName, chargeNoticeId, charges, tokenHash }) {
    const list = charges || [];
    if (list.length === 0) {
        throw new Error('A Charge Notice has no charges to bill — nothing to invoice.');
    }
    const amount = Math.round(list.reduce((sum, c) => sum + (c.amount || 0), 0) * 100) / 100;
    const lineItems = list.map(c => ({
        id: c.id,
        description: c.description || '',
        amount: c.amount || 0,
        incurredDate: c.incurredDate || ''
    }));
    const doc = {
        kind: CHARGE_NOTICE_KIND,
        memberId,
        memberName: memberName || '',
        chargeNoticeId,
        amount,
        charges: lineItems,
        chargeIds: list.map(c => c.id)
    };
    if (tokenHash) doc.tokenHash = tokenHash;
    return doc;
}

/**
 * Build the member email announcing a Charge Notice. Plain markdown body (rendered
 * by the Cloud Function's simpleMarkdownToHtml); lists each billed charge and the
 * total, and links to the member's share page where they can review or contest it.
 *
 * @param {Object} opts
 * @param {string}   opts.memberName
 * @param {number}   opts.amount
 * @param {Array}    [opts.charges]   line items { description, amount }
 * @param {string}   [opts.yearLabel]
 * @param {string}   [opts.shareUrl]
 * @returns {{ subject: string, body: string }}
 */
export function buildChargeNoticeEmail({ memberName, amount, charges, yearLabel, shareUrl }) {
    const total = formatAnnualSummaryCurrency(amount);
    const subject = 'Charge Notice—' + total + (yearLabel ? ' (' + yearLabel + ')' : '');

    let body = 'Hi ' + (memberName || 'there') + ',\n\n';
    body += 'The following usage charge' + ((charges || []).length === 1 ? ' has' : 's have') +
        ' been billed to your household, for a total of **' + total + '**:\n\n';
    (charges || []).forEach(c => {
        body += '- ' + (c.description || 'Charge') + ': ' + formatAnnualSummaryCurrency(c.amount) + '\n';
    });
    body += '\nThis amount is now due and can be paid the same way as your regular bill.\n\n';
    if (shareUrl) {
        body += '[Review this charge](' + shareUrl + ')\n\n';
    } else {
        body += 'Use your existing billing share link to review it, or contact the account owner if you no longer have it.\n\n';
    }
    body += 'If anything looks wrong, you can request a review from your share page.\n\nThanks!';
    return { subject, body };
}
