/**
 * useDisputes — loads and manages disputes from the Firestore subcollection.
 * Disputes live at users/{uid}/billingYears/{yearId}/disputes,
 * separate from the main billing state managed by BillingYearService.
 */
import { useState, useEffect, useCallback } from 'react';
import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, deleteObject, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../lib/firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBillingData } from './useBillingData.js';
import { normalizeDisputeStatus } from '../../lib/validation.js';

/**
 * @returns {{ disputes: Array, loading: boolean, error: string|null, reload: function, updateDispute: function, removeEvidence: function }}
 */
export function useDisputes() {
    const { user } = useAuth();
    const { activeYear } = useBillingData();
    const [disputes, setDisputes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const canLoad = !!(user && activeYear);

    const load = useCallback(async () => {
        if (!canLoad) {
            setDisputes([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const col = collection(db, 'users', user.uid, 'billingYears', activeYear.id, 'disputes');
            const snap = await getDocs(col);
            const items = snap.docs.map(d => {
                const data = d.data();
                data.status = normalizeDisputeStatus(data.status);
                return { id: d.id, ...data };
            });
            // Sort by createdAt descending
            items.sort((a, b) => {
                const aTime = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
                const bTime = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
                return bTime - aTime;
            });
            setDisputes(items);
        } catch (err) {
            console.error('Failed to load disputes:', err);
            setError(err.message);
        }
        setLoading(false);
    }, [canLoad, user?.uid, activeYear?.id]);

    useEffect(() => { load(); }, [load]);

    const updateDispute = useCallback(async (disputeId, fields) => {
        if (!canLoad) return;
        const docRef = doc(db, 'users', user.uid, 'billingYears', activeYear.id, 'disputes', disputeId);
        await setDoc(docRef, { ...fields, updatedAt: serverTimestamp() }, { merge: true });
        // Optimistic update
        setDisputes(prev => prev.map(d =>
            d.id === disputeId ? { ...d, ...fields } : d
        ));
    }, [canLoad, user?.uid, activeYear?.id]);

    const uploadEvidence = useCallback(async (disputeId, file) => {
        if (!canLoad) return;
        const dispute = disputes.find(d => d.id === disputeId);
        if (!dispute) return;

        const EVIDENCE_MAX_SIZE = 20 * 1024 * 1024;
        const EVIDENCE_ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

        if (!EVIDENCE_ALLOWED_TYPES.includes(file.type)) {
            throw new Error('Only PDF, PNG, and JPEG files are allowed.');
        }
        if (file.size > EVIDENCE_MAX_SIZE) {
            throw new Error('File is too large. Maximum size is 20 MB.');
        }
        if ((dispute.evidence || []).length >= 10) {
            throw new Error('Maximum of 10 evidence files per dispute.');
        }

        const storagePath = 'users/' + user.uid + '/disputes/' + disputeId + '/' + Date.now() + '_' + file.name;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);

        let downloadUrl = '';
        try { downloadUrl = await getDownloadURL(storageRef); } catch (_) {}

        const entry = {
            name: file.name,
            storagePath,
            contentType: file.type,
            size: file.size,
            uploadedAt: new Date().toISOString(),
            downloadUrl
        };

        const newEvidence = [...(dispute.evidence || []), entry];
        await updateDispute(disputeId, { evidence: newEvidence });
    }, [canLoad, user?.uid, disputes, updateDispute]);

    const removeEvidence = useCallback(async (disputeId, evidenceIndex) => {
        if (!canLoad) return;
        const dispute = disputes.find(d => d.id === disputeId);
        if (!dispute || !dispute.evidence) return;

        const item = dispute.evidence[evidenceIndex];
        if (!item) return;

        // Remove from Storage using storagePath (the canonical reference, mirrors main.js:3740)
        if (item.storagePath) {
            try {
                const storageRef = ref(storage, item.storagePath);
                await deleteObject(storageRef);
            } catch (_) { /* file may not exist */ }
        }

        const newEvidence = dispute.evidence.filter((_, i) => i !== evidenceIndex);
        await updateDispute(disputeId, { evidence: newEvidence });
    }, [canLoad, disputes, updateDispute]);

    return { disputes, loading, error, reload: load, updateDispute, uploadEvidence, removeEvidence };
}
