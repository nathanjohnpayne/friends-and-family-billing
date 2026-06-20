/**
 * RefundNoticeService — side-effectful Refund Notice issuance (#319).
 * Keeps refundNotice.js pure; this is the one place that touches Firestore + email.
 *
 * Issuing a refund (the financial creditAdjustment, #318) is recorded by
 * BillingYearService.issueRefund and stays the source of truth. THIS module then
 * notifies the member: it mints a refunds:read share link, writes the outbound
 * refund_notice Request into the `disputes` subcollection (ADR 0002), and emails
 * the member the reason, amount, and a confirm link.
 *
 * The notice persists even if the share-link or email step fails — the member's
 * record of the refund is primary; the confirm round-trip is advisory (ADR 0003).
 */
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { createAndPruneShareLink } from './ShareLinkService.js';
import { queueEmail } from './mail.js';
import { buildShareScopes } from './share.js';
import { buildRefundNoticeDoc, buildRefundNoticeEmail } from './refundNotice.js';

/**
 * Issue a Refund Notice: mint a confirm link, write the notice, email the member.
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {number} opts.memberId — the household PRIMARY the refund was issued to
 * @param {string} opts.memberName
 * @param {string} [opts.memberEmail]
 * @param {string} opts.billingYearId
 * @param {string} [opts.yearLabel]
 * @param {number} opts.amount
 * @param {string} [opts.method]
 * @param {string} opts.reason
 * @param {string} opts.creditAdjustmentId — the authoritative financial record (#318)
 * @param {Array}  opts.familyMembers
 * @param {Array}  opts.bills
 * @param {Array}  opts.payments
 * @param {Object} opts.activeYear
 * @param {Object} opts.settings
 * @returns {Promise<{ noticeId: string, shareUrl: string|null }>}
 */
export async function issueRefundNotice({
    userId,
    memberId,
    memberName,
    memberEmail,
    billingYearId,
    yearLabel,
    amount,
    method,
    reason,
    creditAdjustmentId,
    familyMembers,
    bills,
    payments,
    activeYear,
    settings,
}) {
    // 1. Mint a refunds:read share link for the confirm CTA. The recipient also
    //    keeps summary:read so the link is a usable billing page. Best-effort —
    //    if it fails we still record the notice and email without the link.
    let shareUrl = null;
    let tokenHash = null;
    try {
        const scopes = buildShareScopes(false, false, true);
        const link = await createAndPruneShareLink({
            userId,
            memberId,
            memberName,
            billingYearId,
            scopes,
            familyMembers,
            bills,
            payments,
            activeYear,
            settings,
        });
        shareUrl = link.url;
        tokenHash = link.tokenHash;
    } catch (err) {
        console.error('issueRefundNotice: share link mint failed:', err);
    }

    // 2. Write the outbound refund_notice Request (snapshot + creditAdjustment id).
    const noticeBody = buildRefundNoticeDoc({
        memberId,
        memberName,
        amount,
        method,
        reason,
        creditAdjustmentId,
        tokenHash,
    });
    const ref = await addDoc(
        collection(db, 'users', userId, 'billingYears', billingYearId, 'disputes'),
        { ...noticeBody, createdAt: serverTimestamp() }
    );

    // 3. Email the member the reason, amount, method, and confirm link (advisory).
    if (memberEmail) {
        try {
            const { subject, body } = buildRefundNoticeEmail(
                { amount, method, reason },
                memberName,
                yearLabel || (activeYear ? activeYear.label || activeYear.id : ''),
                shareUrl
            );
            await queueEmail({ to: memberEmail, subject, body, uid: userId });
        } catch (err) {
            console.error('issueRefundNotice: member email failed:', err);
        }
    }

    return { noticeId: ref.id, shareUrl };
}
