/**
 * Refund Notice helpers — pure, no DOM / Firestore / module state.
 *
 * A Refund Notice is an administrator-initiated, OUTBOUND Request (ADR 0002): it
 * rides the same `disputes` subcollection as the inbound Review Request but is a
 * distinct KIND (`refund_notice`). It NEVER reuses the Review Request resolution
 * vocabulary (`approved_by_user` / `rejected_by_user`); it carries its own
 * confirmation states `confirmed_by_member` / `not_received`.
 *
 * The financial source of truth is the household's `creditAdjustment` (#318). A
 * Refund Notice holds only a presentational snapshot plus the `creditAdjustmentId`
 * so the two never diverge lossily.
 */

/** The substrate `kind` discriminator for a Refund Notice. */
export const REFUND_NOTICE_KIND = 'refund_notice';

/** Member confirmation outcomes for a Refund Notice (never the Review Request states). */
export const REFUND_CONFIRMATIONS = ['confirmed_by_member', 'not_received'];

/**
 * Is this Request a Refund Notice? Review Requests carry no `kind`, so they read false.
 * @param {{ kind?: string }|null|undefined} request
 * @returns {boolean}
 */
export function isRefundNotice(request) {
    return !!request && request.kind === REFUND_NOTICE_KIND;
}

/**
 * Normalize a member-confirmation value to a known terminal state or null.
 * @param {string|null|undefined} value
 * @returns {('confirmed_by_member'|'not_received'|null)}
 */
export function normalizeRefundConfirmation(value) {
    return REFUND_CONFIRMATIONS.includes(value) ? value : null;
}

/**
 * An ACTIVE, UNRESOLVED `not_received` is the only refund-notice state that is
 * actionable for the administrator (ADR 0003). Once the admin resolves it
 * (re-send / cancel / dismiss-with-reason) it is no longer active.
 * @param {{ kind?: string, confirmation?: string, resolution?: Object|null }} notice
 * @returns {boolean}
 */
export function isActiveNotReceived(notice) {
    if (!isRefundNotice(notice)) return false;
    if (notice.confirmation !== 'not_received') return false;
    return !notice.resolution;
}

/**
 * The set of `creditAdjustmentId`s whose household credit is RE-OPENED by an
 * active, unresolved `not_received` report (ADR 0003). Recording a refund
 * optimistically cleared the credit (#318), but the member says the money never
 * arrived, so that disposition must stop counting and the credit is owed again
 * until the administrator resolves it (re-send / cancel / dismiss). The
 * settlement layer excludes these adjustments so Net Contribution rises back and
 * the credit reappears.
 *
 * This is the OPEN-year correction only. A closed year is corrected forward
 * (ADR 0007), so callers pass an empty set (or skip the re-open) for read-only
 * years rather than reanimating a frozen ledger.
 *
 * @param {Array} refundNotices
 * @returns {Set<string>}
 */
export function reopenedCreditAdjustmentIds(refundNotices) {
    const ids = new Set();
    (refundNotices || []).forEach(notice => {
        if (isActiveNotReceived(notice) && notice.creditAdjustmentId) {
            ids.add(notice.creditAdjustmentId);
        }
    });
    return ids;
}

/**
 * Build the Firestore document body for a Refund Notice.
 * Does NOT include createdAt — the caller stamps serverTimestamp().
 *
 * @param {Object} opts
 * @param {number} opts.memberId — the household PRIMARY member the refund was issued to
 * @param {string} opts.memberName
 * @param {number} opts.amount
 * @param {string} [opts.method]
 * @param {string} opts.reason
 * @param {string} opts.creditAdjustmentId — the authoritative financial record (#318)
 * @param {string|null} [opts.tokenHash] — share token used for the confirm link, if any
 * @returns {Object}
 */
export function buildRefundNoticeDoc({ memberId, memberName, amount, method, reason, creditAdjustmentId, tokenHash }) {
    if (!creditAdjustmentId) {
        throw new Error('A Refund Notice must reference its creditAdjustmentId.');
    }
    const doc = {
        kind: REFUND_NOTICE_KIND,
        memberId,
        memberName: memberName || '',
        amount: Math.round((parseFloat(amount) || 0) * 100) / 100,
        method: method || 'other',
        reason: (reason || '').trim(),
        creditAdjustmentId,
        // Advisory round-trip has not started; member has not responded yet.
        confirmation: null,
    };
    if (tokenHash) doc.tokenHash = tokenHash;
    return doc;
}

/** Short admin-facing label for a notice's confirmation state. */
export function refundNoticeConfirmationLabel(confirmation) {
    if (confirmation === 'confirmed_by_member') return 'Confirmed';
    if (confirmation === 'not_received') return 'Not Received';
    return 'Sent';
}

function formatCurrency(amount) {
    return '$' + Number(amount || 0).toFixed(2);
}

/**
 * Build the member-facing email announcing a Refund Notice.
 * Includes the reason, amount, method, and a confirm link (a refunds:read share URL).
 *
 * @param {{ amount: number, method?: string, reason: string }} notice
 * @param {string} memberName
 * @param {string} yearLabel
 * @param {string|null} shareUrl — refunds:read share page URL, or null if none could be issued
 * @returns {{ subject: string, body: string }}
 */
export function buildRefundNoticeEmail(notice, memberName, yearLabel, shareUrl) {
    const subject = 'Refund Sent—' + formatCurrency(notice.amount) + (yearLabel ? ' (' + yearLabel + ')' : '');
    let body = 'Hi ' + (memberName || 'there') + ',\n\n';
    body += 'A refund of **' + formatCurrency(notice.amount) + '** has been sent to your household';
    if (notice.method) body += ' via **' + notice.method + '**';
    body += '.\n\n';
    if (notice.reason) body += '**Reason:** ' + notice.reason + '\n\n';
    body += 'Once you have received it, please confirm below. If it has not arrived, you can report that too';
    if (shareUrl) {
        body += ':\n[Confirm your refund](' + shareUrl + ')\n\n';
    } else {
        body += '. Use your existing billing share link, or contact the account owner if you no longer have it.\n\n';
    }
    body += 'Thanks!';
    return { subject, body };
}
