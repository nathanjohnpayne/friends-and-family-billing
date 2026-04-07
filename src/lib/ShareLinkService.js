/**
 * ShareLinkService — side-effectful share link operations.
 * Imports Firestore; keeps share.js pure.
 *
 * Exports a single function: createAndPruneShareLink()
 * Used by EmailInvoiceDialog, TextInvoiceDialog, and ShareLinkDialog.
 */
import { doc, setDoc, getDocs, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { generateRawToken, hashToken } from './validation.js';
import { buildShareScopes, buildShareTokenDoc, buildShareUrl, buildPublicShareData, computeExpiryDate } from './share.js';

const DEFAULT_EXPIRY_DAYS = 365;
const DEFAULT_SCOPES = ['summary:read', 'paymentMethods:read', 'disputes:create', 'disputes:read'];
const MAX_ACTIVE_LINKS = 5;

/**
 * Create a new share link and prune old ones in a single atomic batch.
 *
 * @param {Object} opts
 * @param {string}   opts.userId
 * @param {number}   opts.memberId
 * @param {string}   opts.memberName
 * @param {string}   opts.billingYearId
 * @param {string[]} [opts.scopes]      — defaults to full scopes
 * @param {number}   [opts.expiryDays]  — defaults to 365
 * @param {Array}    opts.familyMembers
 * @param {Array}    opts.bills
 * @param {Array}    opts.payments
 * @param {Object}   opts.activeYear
 * @param {Object}   opts.settings
 * @returns {Promise<{ url: string, tokenHash: string, rawToken: string }>}
 */
export async function createAndPruneShareLink({
    userId,
    memberId,
    memberName,
    billingYearId,
    scopes,
    expiryDays,
    familyMembers,
    bills,
    payments,
    activeYear,
    settings,
}) {
    const resolvedScopes = scopes || DEFAULT_SCOPES;
    const resolvedExpiryDays = expiryDays !== undefined ? expiryDays : DEFAULT_EXPIRY_DAYS;

    // Generate token
    const rawToken = generateRawToken();
    const tokenHash = await hashToken(rawToken);

    // Build documents
    const expiresAt = computeExpiryDate(resolvedExpiryDays);
    const tokenDocData = buildShareTokenDoc(userId, memberId, memberName, billingYearId, rawToken, expiresAt, resolvedScopes);
    const publicData = buildPublicShareData(familyMembers, bills, payments, memberId, resolvedScopes, userId, activeYear, settings);

    // Query existing active links for this member+year
    const q = query(
        collection(db, 'shareTokens'),
        where('ownerId', '==', userId),
        where('memberId', '==', memberId),
        where('billingYearId', '==', billingYearId),
        where('revoked', '==', false)
    );
    const existingSnap = await getDocs(q);

    // Sort existing by createdAt descending
    const existing = existingSnap.docs
        .map(d => ({ id: d.id, createdAt: d.data().createdAt }))
        .sort((a, b) => {
            const aTime = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
            const bTime = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
            return bTime - aTime;
        });

    // Build atomic batch: create new link + prune old ones
    const batch = writeBatch(db);

    // 1. Create new shareTokens doc
    batch.set(doc(db, 'shareTokens', tokenHash), {
        ...tokenDocData,
        createdAt: serverTimestamp(),
    });

    // 2. Create new publicShares doc
    if (publicData) {
        batch.set(doc(db, 'publicShares', tokenHash), {
            ...publicData,
            updatedAt: serverTimestamp(),
        });
    }

    // 3. Prune: keep the most recent (MAX_ACTIVE_LINKS - 1) existing + the new one = MAX_ACTIVE_LINKS
    const keepCount = MAX_ACTIVE_LINKS - 1;
    const toPrune = existing.slice(keepCount);
    for (const old of toPrune) {
        batch.update(doc(db, 'shareTokens', old.id), {
            revoked: true,
            revokedAt: serverTimestamp(),
        });
        batch.delete(doc(db, 'publicShares', old.id));
    }

    await batch.commit();

    const url = buildShareUrl(window.location.origin, rawToken);
    return { url, tokenHash, rawToken };
}
