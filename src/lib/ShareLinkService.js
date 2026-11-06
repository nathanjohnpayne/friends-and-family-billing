/**
 * ShareLinkService — side-effectful share link operations.
 * Imports Firestore; keeps share.js pure.
 *
 * Exports createAndPruneShareLink() and rebuildMemberShareDocs().
 * Used by EmailInvoiceDialog, TextInvoiceDialog, and ShareLinkDialog.
 */
import { doc, getDocs, collection, query, where, writeBatch, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { generateRawToken, hashToken } from './validation.js';
import { buildShareTokenDoc, buildShareUrl, buildPublicShareData, computeExpiryDate, buildShareScopes } from './share.js';

const DEFAULT_EXPIRY_DAYS = 365;
// Derive the default full-scope set from buildShareScopes (the single source of truth)
// rather than duplicating the list — otherwise a new always-on scope (payments:read #356,
// usageCharges:read #317) silently misses invoice/text links that fall back to this default.
const DEFAULT_SCOPES = buildShareScopes(true, true);
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
 * @param {Array}    [opts.owedAdjustments]  deferred Usage Charges (#317), so the
 *   generated publicShares doc carries the member's pendingCharges
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
    owedAdjustments,
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
    const publicData = buildPublicShareData(familyMembers, bills, payments, memberId, resolvedScopes, userId, activeYear, settings, owedAdjustments);

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

    // 2. Create new publicShares doc (include expiresAt for client-side validation)
    if (publicData) {
        batch.set(doc(db, 'publicShares', tokenHash), {
            ...publicData,
            expiresAt: expiresAt || null,
            revoked: false,
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

/**
 * Rebuild the cached publicShares documents for some members' active share links
 * from the current billing-year state (#528).
 *
 * Share tokens and their cached documents are keyed by member id, so a link always
 * belongs to the member it was minted for. When a household's contact changes, the
 * old contact's link stops showing the household (it becomes that member's own
 * link) and the new contact's link starts showing it; this rewrites both cached
 * documents in one transaction so neither serves the old household shape. Each
 * document is rebuilt exactly as createAndPruneShareLink would build it for that
 * token's scopes, keeping the token's expiry and the link's view metrics.
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.billingYearId
 * @param {Array}  opts.memberIds  members whose active links to rebuild
 * @param {Array}  opts.familyMembers
 * @param {Array}  opts.bills
 * @param {Array}  opts.payments
 * @param {Array}  [opts.owedAdjustments]
 * @param {Object} opts.activeYear
 * @param {Object} opts.settings
 * @returns {Promise<number>} how many cached documents were rewritten
 */
export async function rebuildMemberShareDocs({
    userId,
    billingYearId,
    memberIds,
    familyMembers,
    bills,
    payments,
    owedAdjustments,
    activeYear,
    settings,
}) {
    if (!userId || !billingYearId) return 0;
    const ids = Array.from(new Set(memberIds || []));
    if (ids.length === 0) return 0;

    // Candidate links: one query per member, on the same (ownerId, memberId,
    // billingYearId, revoked) shape createAndPruneShareLink already uses, so no new
    // composite index is needed. Queries cannot run inside a client transaction, so
    // the transaction below re-checks each token before writing.
    const snaps = await Promise.all(ids.map(memberId => getDocs(query(
        collection(db, 'shareTokens'),
        where('ownerId', '==', userId),
        where('memberId', '==', memberId),
        where('billingYearId', '==', billingYearId),
        where('revoked', '==', false)
    ))));
    const hashes = snaps.flatMap(snap => snap.docs.map(d => d.id));
    if (hashes.length === 0) return 0;

    // Read each token and its cached document inside one transaction, and write only
    // for tokens that are still active. A revocation that lands first is seen here; one
    // that lands after the reads changes a document this transaction read, so Firestore
    // retries it and the retry sees the token revoked. Either way a revoked link's cache
    // is never recreated. The view metrics on the existing cached document
    // (accessCount, lastAccessedAt — written by ShareView, read by ShareLinkDialog) are
    // carried over; every billing field is rebuilt, so a stale optional field is dropped.
    return runTransaction(db, async tx => {
        const reads = [];
        for (const hash of hashes) {
            const tokenSnap = await tx.get(doc(db, 'shareTokens', hash));
            const cacheSnap = await tx.get(doc(db, 'publicShares', hash));
            reads.push({ hash, tokenSnap, cacheSnap });
        }
        let written = 0;
        for (const { hash, tokenSnap, cacheSnap } of reads) {
            if (!tokenSnap.exists()) continue;
            const token = tokenSnap.data();
            if (token.revoked || token.ownerId !== userId || token.billingYearId !== billingYearId) continue;
            const scopes = Array.isArray(token.scopes) ? token.scopes : DEFAULT_SCOPES;
            const publicData = buildPublicShareData(
                familyMembers, bills, payments, token.memberId, scopes, userId, activeYear, settings, owedAdjustments
            );
            if (!publicData) continue;
            const cached = cacheSnap.exists() ? cacheSnap.data() : {};
            const metrics = {};
            if (cached.accessCount !== undefined) metrics.accessCount = cached.accessCount;
            if (cached.lastAccessedAt !== undefined) metrics.lastAccessedAt = cached.lastAccessedAt;
            tx.set(doc(db, 'publicShares', hash), {
                ...publicData,
                ...metrics,
                expiresAt: token.expiresAt || null,
                revoked: false,
                updatedAt: serverTimestamp(),
            });
            written += 1;
        }
        return written;
    });
}
