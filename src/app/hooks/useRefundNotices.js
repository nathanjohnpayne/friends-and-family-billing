/**
 * useRefundNotices — loads the administrator-facing Refund Notices (#319) from the
 * shared `disputes` subcollection, returning ONLY the `refund_notice` kind (the
 * outbound Requests). Review Requests are handled by useDisputes; the two views
 * are deliberately disjoint (ADR 0002, AC: refund notices excluded from Open Reviews).
 *
 * Surfaces the active-not_received follow-up count and a resolveNotice mutation
 * (re-send / cancel / dismiss-with-reason, ADR 0003). Resolving never reopens a
 * closed year (ADR 0007) — it writes a resolution record forward on the notice.
 */
import { useState, useEffect, useCallback } from 'react';
import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBillingData } from './useBillingData.js';
import { isRefundNotice, isActiveNotReceived } from '../../lib/refundNotice.js';

/**
 * @returns {{ refundNotices: Array, loading: boolean, error: string|null, activeNotReceivedCount: number, reload: function, resolveNotice: function }}
 */
export function useRefundNotices() {
    const { user } = useAuth();
    const { activeYear } = useBillingData();
    const [refundNotices, setRefundNotices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const canLoad = !!(user && activeYear);

    const load = useCallback(async () => {
        if (!canLoad) {
            setRefundNotices([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const col = collection(db, 'users', user.uid, 'billingYears', activeYear.id, 'disputes');
            const snap = await getDocs(col);
            const items = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(isRefundNotice);
            items.sort((a, b) => {
                const aTime = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
                const bTime = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
                return bTime - aTime;
            });
            setRefundNotices(items);
        } catch (err) {
            console.error('Failed to load refund notices:', err);
            setError(err.message);
        }
        setLoading(false);
    }, [canLoad, user?.uid, activeYear?.id]);

    useEffect(() => { load(); }, [load]);

    /**
     * Record an admin resolution on an active not_received notice.
     * @param {string} noticeId
     * @param {{ type: 'resent'|'cancelled'|'dismissed', note?: string }} resolution
     */
    const resolveNotice = useCallback(async (noticeId, resolution) => {
        if (!canLoad) return;
        const docRef = doc(db, 'users', user.uid, 'billingYears', activeYear.id, 'disputes', noticeId);
        const resolutionRecord = { ...resolution, resolvedAt: serverTimestamp() };
        await setDoc(docRef, { resolution: resolutionRecord, updatedAt: serverTimestamp() }, { merge: true });
        setRefundNotices(prev => prev.map(n =>
            n.id === noticeId ? { ...n, resolution: resolutionRecord } : n
        ));
    }, [canLoad, user?.uid, activeYear?.id]);

    const activeNotReceivedCount = refundNotices.filter(isActiveNotReceived).length;

    return { refundNotices, loading, error, activeNotReceivedCount, reload: load, resolveNotice };
}
