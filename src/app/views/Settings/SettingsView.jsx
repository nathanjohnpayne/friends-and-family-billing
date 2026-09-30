import { doc, setDoc, deleteDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../lib/firebase.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { isYearReadOnly } from '../../../lib/validation.js';
import BillingYearSelector from '../../components/BillingYearSelector.jsx';
import PaymentMethodsManager from '../../components/PaymentMethodsManager.jsx';

/**
 * Sync QR codes to the publicQrCodes collection (mirrors InvoicingTab).
 * Called after payment method updates to keep share pages in sync.
 */
async function syncPublicQrCodes(userId, methods) {
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
async function syncPublicSharesPaymentMethods(userId, methods) {
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
 * SettingsView — billing year controls + payment methods management.
 */
export default function SettingsView() {
    const { activeYear, loading, service } = useBillingData();
    const { user } = useAuth();
    const { showToast } = useToast();
    const readOnly = isYearReadOnly(activeYear);
    const settings = service.getState().settings || {};

    return (
        <div>
            <BillingYearSelector />

            {!loading && (<div className="settings-section-divider" />)}
            {!loading && (
                <PaymentMethodsManager
                    settings={settings}
                    readOnly={readOnly}
                    onUpdate={paymentMethods => {
                        service.updateSettings({ paymentMethods });
                        syncPublicQrCodes(user ? user.uid : null, paymentMethods);
                        syncPublicSharesPaymentMethods(user ? user.uid : null, paymentMethods);
                        showToast('Payment methods updated');
                    }}
                />
            )}
        </div>
    );
}
