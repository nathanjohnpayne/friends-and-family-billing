/**
 * BillingYearService — manages billing year lifecycle (list, load, switch,
 * create, archive) against Firestore.
 *
 * Owns the canonical mutable billing state. React subscribes to state changes
 * via the subscribe() API rather than owning state in components.
 *
 * Depends on: Firestore (modular SDK), SaveQueue, extracted pure helpers.
 */
import {
    collection, doc, getDocs, getDoc, setDoc, serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase.js';
import { normalizeYearData, buildSavePayload, buildInitialYearData } from './persistence.js';
import { buildNewYearData } from './billing-year.js';
import { SaveQueue } from './SaveQueue.js';

export class BillingYearService {
    constructor() {
        /** @type {import('firebase/auth').User|null} */
        this._user = null;

        /** Current state — the service owns this, React reads it. */
        this._state = {
            billingYears: [],
            activeYear: null,
            familyMembers: [],
            bills: [],
            payments: [],
            billingEvents: [],
            settings: null,
            loading: true,
            error: null
        };

        this._saveQueue = new SaveQueue();

        /** @type {Set<() => void>} */
        this._listeners = new Set();
    }

    // ────────── Public read API ──────────

    /** Get a snapshot of current state (immutable from the consumer's perspective). */
    getState() {
        return this._state;
    }

    /** Get the save queue instance (for save status subscriptions). */
    getSaveQueue() {
        return this._saveQueue;
    }

    // ────────── Subscription API ──────────

    /**
     * Subscribe to state changes. Compatible with React's useSyncExternalStore
     * or a simple useEffect pattern.
     * @param {() => void} fn - called whenever state changes
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    /** @private Notify all subscribers and replace state reference for React compat. */
    _setState(partial) {
        this._state = { ...this._state, ...partial };
        this._listeners.forEach(fn => {
            try { fn(); } catch (e) { console.error('BillingYearService listener error:', e); }
        });
    }

    // ────────── Auth binding ──────────

    /** Call when auth state changes. Loads data for the user or resets. */
    async setUser(user) {
        this._user = user;
        if (!user) {
            this._setState({
                billingYears: [], activeYear: null, familyMembers: [],
                bills: [], payments: [], billingEvents: [],
                settings: null, loading: false, error: null
            });
            return;
        }
        await this._loadData();
    }

    // ────────── Data loading ──────────

    /** @private */
    async _loadData() {
        if (!this._user) return;
        this._setState({ loading: true, error: null });

        try {
            const userDocRef = doc(db, 'users', this._user.uid);
            const userDoc = await getDoc(userDocRef);
            let activeYearId;

            if (userDoc.exists()) {
                const userData = userDoc.data();
                activeYearId = userData.activeBillingYear || String(new Date().getFullYear());
            } else {
                // Brand-new user — create default year
                activeYearId = String(new Date().getFullYear());
                await setDoc(userDocRef, { activeBillingYear: activeYearId });
                const yearDocRef = doc(db, 'users', this._user.uid, 'billingYears', activeYearId);
                const initialData = buildInitialYearData(activeYearId, { emailMessage: '', paymentLinks: [], paymentMethods: [] });
                initialData.createdAt = serverTimestamp();
                initialData.updatedAt = serverTimestamp();
                await setDoc(yearDocRef, initialData);
            }

            await this._loadYearsList();
            await this._loadYearData(activeYearId);
            this._setState({ loading: false });
        } catch (error) {
            console.error('BillingYearService: loadData failed', error);
            this._setState({ loading: false, error: error.message });
        }
    }

    /** @private */
    async _loadYearsList() {
        if (!this._user) return;
        const yearsRef = collection(db, 'users', this._user.uid, 'billingYears');
        const snapshot = await getDocs(yearsRef);
        const years = [];
        snapshot.docs.forEach(d => {
            const data = d.data();
            years.push({ id: d.id, label: data.label || d.id, status: data.status || 'open' });
        });
        years.sort((a, b) => b.label.localeCompare(a.label));
        this._setState({ billingYears: years });
    }

    /** @private */
    async _loadYearData(yearId) {
        if (!this._user) return;
        const yearDocRef = doc(db, 'users', this._user.uid, 'billingYears', yearId);
        const yearDoc = await getDoc(yearDocRef);

        if (yearDoc.exists()) {
            const normalized = normalizeYearData(yearDoc.data(), yearId);
            this._setState({
                activeYear: normalized.year,
                familyMembers: normalized.members,
                bills: normalized.bills,
                payments: normalized.payments,
                billingEvents: normalized.billingEvents,
                settings: normalized.settings
            });
        } else {
            this._setState({
                activeYear: { id: yearId, label: yearId, status: 'open', createdAt: null, archivedAt: null },
                familyMembers: [], bills: [], payments: [],
                billingEvents: [], settings: null
            });
        }
    }

    // ────────── Mutations ──────────

    /** Switch to a different billing year. */
    async switchYear(yearId) {
        if (!this._user) return;
        this._setState({ loading: true });
        try {
            const userDocRef = doc(db, 'users', this._user.uid);
            await setDoc(userDocRef, { activeBillingYear: yearId }, { merge: true });
            await this._loadYearData(yearId);
            this._setState({ loading: false });
        } catch (error) {
            console.error('switchYear failed:', error);
            this._setState({ loading: false, error: error.message });
        }
    }

    /**
     * Save the current state to Firestore via the SaveQueue.
     * Callers mutate state through the service, then call save().
     */
    save() {
        const { activeYear, familyMembers, bills, payments, billingEvents, settings } = this._state;
        if (!this._user || !activeYear) return Promise.resolve();
        if (activeYear.status === 'closed' || activeYear.status === 'archived') {
            console.warn('Cannot save: year is ' + activeYear.status);
            return Promise.resolve();
        }

        return this._saveQueue.enqueue(async () => {
            const yearDocRef = doc(db, 'users', this._user.uid, 'billingYears', activeYear.id);
            const payload = buildSavePayload(activeYear, familyMembers, bills, payments, billingEvents, settings);
            if (!payload.createdAt) payload.createdAt = serverTimestamp();
            payload.updatedAt = serverTimestamp();
            await setDoc(yearDocRef, payload);
        });
    }

    /**
     * Create a new billing year cloned from the current one.
     * @param {string} yearId
     */
    async createYear(yearId) {
        if (!this._user) return;
        const { familyMembers, bills, settings } = this._state;
        const yearDocRef = doc(db, 'users', this._user.uid, 'billingYears', yearId);
        const newData = buildNewYearData(familyMembers, bills, settings || {}, yearId);
        newData.createdAt = serverTimestamp();
        newData.updatedAt = serverTimestamp();
        await setDoc(yearDocRef, newData);

        await this._loadYearsList();
        await this.switchYear(yearId);
    }
}
