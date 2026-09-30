/**
 * Payment-method share sync — keeps member-facing share pages in step with the
 * owner's payment methods after they are edited. Shared by the Settings page
 * and the Invoicing tab's payment-methods "Configure" dialog so both entry
 * points write publicShares.paymentMethods AND publicQrCodes the same way.
 */
import { doc, setDoc, deleteDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';

/**
 * Sync QR codes to the publicQrCodes collection.
 * Called after payment method updates to keep share pages in sync.
 */
export async function syncPublicQrCodes(userId, methods) {
    if (!userId) return;
    const methodsWithQr = (methods || []).filter(m => m.qrCode);
    for (const m of methodsWithQr) {
        const docId = userId + '_' + m.id;
        try {
            await setDoc(doc(db, 'publicQrCodes', docId), {
                ownerId: userId,
                methodId: m.id,
                qrCode: m.qrCode,
                updatedAt: serverTimestamp()
            });
        } catch (err) {
            console.error('Error writing public QR code:', err);
        }
    }
    const allMethods = methods || [];
    const withoutQr = allMethods.filter(m => !m.qrCode && m.hasQrCode === false);
    for (const m of withoutQr) {
        const docId = userId + '_' + m.id;
        try { await deleteDoc(doc(db, 'publicQrCodes', docId)); } catch (_) {}
    }
}

/**
 * Sync payment methods to all publicShares docs for this owner.
 * Looks up active share token hashes via shareTokens collection,
 * then updates the corresponding publicShares docs by ID.
 */
export async function syncPublicSharesPaymentMethods(userId, methods) {
    if (!userId) return;
    try {
        const enabledMethods = (methods || []).filter(m => m.enabled).map(m => {
            const copy = { ...m };
            if (copy.qrCode) { copy.hasQrCode = true; delete copy.qrCode; }
            return copy;
        });
        // Find all active share token hashes for this user
        const tokensSnap = await getDocs(query(
            collection(db, 'shareTokens'),
            where('ownerId', '==', userId)
        ));
        const activeHashes = tokensSnap.docs
            .filter(d => !d.data().revoked)
            .map(d => d.id);
        // Update each corresponding publicShares doc
        const updates = activeHashes.map(hash =>
            updateDoc(doc(db, 'publicShares', hash), {
                paymentMethods: enabledMethods,
                updatedAt: serverTimestamp()
            }).catch(() => {}) // doc may not exist yet
        );
        await Promise.all(updates);
    } catch (err) {
        console.error('Error syncing publicShares payment methods:', err);
    }
}

/**
 * Run both share syncs for an owner after a payment-methods update.
 * @param {string|null} userId
 * @param {Array} methods
 */
export function syncPaymentMethodsToShares(userId, methods) {
    return Promise.all([
        syncPublicQrCodes(userId, methods),
        syncPublicSharesPaymentMethods(userId, methods),
    ]);
}
