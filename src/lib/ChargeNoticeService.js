/**
 * ChargeNoticeService — side-effectful Charge Notice issuance (#320).
 *
 * The non-blocking follow-up to BillingYearService.billDeferredCharges(): that
 * mutation is the authoritative state change (deferred → billed, raising owed); this
 * service mints a member share link, writes the outbound Charge Notice document to
 * the shared `disputes` subcollection (ADR 0002), and emails the member. The notice
 * is presentational — the financial source of truth lives on the owedAdjustments[]
 * records. The member pays via the normal payments ledger or contests via a Review
 * Request; there is no acknowledgment Cloud Function (ADR 0005).
 *
 * Collaborators (share-link creation, email queue) are injectable so the
 * orchestration is testable without Firestore; they default to the real impls.
 */
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { createAndPruneShareLink } from './ShareLinkService.js';
import { queueEmail } from './mail.js';
import { buildShareScopes } from './share.js';
import { buildChargeNoticeDoc, buildChargeNoticeEmail } from './chargeNotice.js';

/**
 * Issue a Charge Notice for a set of just-billed charges.
 *
 * @param {Object} opts
 * @param {string}   opts.userId
 * @param {string}   opts.billingYearId
 * @param {string}   [opts.yearLabel]
 * @param {*}        opts.memberId         the household primary that was billed
 * @param {string}   opts.memberName
 * @param {string}   [opts.memberEmail]
 * @param {string}   opts.chargeNoticeId   from billDeferredCharges()
 * @param {Array}    opts.charges          the billed charges (line items)
 * @param {Array}    opts.familyMembers
 * @param {Array}    opts.bills
 * @param {Array}    opts.payments
 * @param {Array}    [opts.owedAdjustments]
 * @param {Object}   opts.activeYear
 * @param {Object}   opts.settings
 * @param {Object}   [deps]  injectable collaborators (tests)
 * @param {Function} [deps.createShareLink]
 * @param {Function} [deps.queueEmailFn]
 * @returns {Promise<{ tokenHash: string|null, shareUrl: string|null }>}
 */
export async function issueChargeNotice(opts, deps = {}) {
    const createShareLink = deps.createShareLink || createAndPruneShareLink;
    const queueEmailFn = deps.queueEmailFn || queueEmail;

    const {
        userId, billingYearId, yearLabel, memberId, memberName, memberEmail,
        chargeNoticeId, charges, familyMembers, bills, payments, owedAdjustments,
        activeYear, settings,
    } = opts;

    // 1. Best-effort: mint a member share link carrying usageCharges:read so the
    //    member can review the charge on their share page. If it fails, the notice
    //    is still recorded and emailed (the member can use an existing link).
    let tokenHash = null;
    let shareUrl = null;
    try {
        const scopes = buildShareScopes(true, false); // include disputes:create so they can request a review
        const link = await createShareLink({
            userId,
            memberId,
            memberName,
            billingYearId,
            scopes,
            familyMembers,
            bills,
            payments,
            owedAdjustments: owedAdjustments || [],
            activeYear,
            settings,
        });
        if (link) {
            tokenHash = link.tokenHash || null;
            shareUrl = link.url || null;
        }
    } catch (err) {
        console.error('issueChargeNotice: share link creation failed:', err);
    }

    // 2. Write the outbound Charge Notice document to the disputes subcollection.
    const noticeDoc = buildChargeNoticeDoc({
        memberId,
        memberName,
        chargeNoticeId,
        charges,
        ...(tokenHash ? { tokenHash } : {}),
    });
    // Deterministic id keyed to the chargeNoticeId so a retry overwrites the same
    // dispute doc instead of appending a duplicate (and re-triggering the member
    // notification) — PR #328 review r3447513514. billDeferredCharges() stamps a
    // unique chargeNoticeId per Charge Notice, so one notice maps to exactly one doc.
    // Guard the id first: an absent/blank chargeNoticeId would otherwise stringify to
    // a shared key like "undefined" and silently overwrite an unrelated dispute doc
    // (CodeRabbit #369). Fail loudly instead of corrupting the subcollection.
    const noticeId = String(chargeNoticeId ?? '').trim();
    if (!noticeId || noticeId === 'undefined' || noticeId === 'null') {
        throw new Error('issueChargeNotice requires a valid chargeNoticeId to key the notice doc.');
    }
    const col = collection(db, 'users', userId, 'billingYears', billingYearId, 'disputes');
    await setDoc(doc(col, noticeId), { ...noticeDoc, createdAt: serverTimestamp() });

    // 3. Email the member (fire-and-forget — never block the primary action).
    if (memberEmail) {
        try {
            const { subject, body } = buildChargeNoticeEmail({
                memberName,
                amount: noticeDoc.amount,
                charges,
                yearLabel: yearLabel || (activeYear ? activeYear.label || activeYear.id : ''),
                shareUrl,
            });
            await queueEmailFn({ to: memberEmail, subject, body, uid: userId });
        } catch (err) {
            console.error('issueChargeNotice: member email failed:', err);
        }
    }

    return { tokenHash, shareUrl };
}
