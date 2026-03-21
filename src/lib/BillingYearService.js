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
import { buildNewYearData, isYearLabelDuplicate } from './billing-year.js';
import { generateEventId, generateUniqueId, generateUniqueBillId, generateUniquePaymentId, isYearReadOnly } from './validation.js';
import { SaveQueue } from './SaveQueue.js';

/** Default settings matching the legacy app (main.js line 77). */
const DEFAULT_SETTINGS = {
    emailMessage: 'Your annual billing summary for %billing_year% is ready. Your annual amount due is %annual_total%. Thank you for your prompt payment via any of the payment methods below.',
    paymentLinks: [],
    paymentMethods: []
};

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
                const initialData = buildInitialYearData(activeYearId, DEFAULT_SETTINGS);
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
     * Transition the active year to a new status.
     * Port of setBillingYearStatus() from main.js.
     * @param {string} newStatus - 'open' | 'settling' | 'closed' | 'archived'
     */
    async setYearStatus(newStatus) {
        if (!this._user) return;
        const { activeYear, billingYears, billingEvents } = this._state;
        if (!activeYear || activeYear.status === newStatus) return;

        // Emit YEAR_STATUS_CHANGED event (mirrors legacy main.js:386)
        const previousStatus = activeYear.status;
        const event = {
            id: generateEventId(),
            timestamp: new Date().toISOString(),
            actor: { type: 'admin', userId: this._user.uid },
            eventType: 'YEAR_STATUS_CHANGED',
            payload: { previousStatus, newStatus, yearLabel: activeYear.label },
            note: '',
            source: 'ui'
        };
        const updatedEvents = [...(billingEvents || []), event];

        const updates = { status: newStatus, billingEvents: updatedEvents };
        if (newStatus === 'closed') updates.closedAt = serverTimestamp();
        if (newStatus === 'archived') updates.archivedAt = serverTimestamp();

        try {
            const yearDocRef = doc(db, 'users', this._user.uid, 'billingYears', activeYear.id);
            await setDoc(yearDocRef, updates, { merge: true });

            // Update local state
            const updatedYear = { ...activeYear, status: newStatus };
            if (newStatus === 'closed') updatedYear.closedAt = new Date();
            if (newStatus === 'archived') updatedYear.archivedAt = new Date();

            const updatedYears = billingYears.map(y =>
                y.id === activeYear.id ? { ...y, status: newStatus } : y
            );

            this._setState({
                activeYear: updatedYear,
                billingYears: updatedYears,
                billingEvents: updatedEvents
            });
        } catch (error) {
            console.error('setYearStatus failed:', error);
            throw error;
        }
    }

    /**
     * Create a new billing year cloned from the current one.
     * @param {string} yearId
     */
    async createYear(yearId) {
        if (!this._user) return;
        const { billingYears, familyMembers, bills, settings } = this._state;

        if (isYearLabelDuplicate(billingYears, yearId)) {
            throw new Error('Billing year "' + yearId + '" already exists.');
        }

        const yearDocRef = doc(db, 'users', this._user.uid, 'billingYears', yearId);
        const newData = buildNewYearData(familyMembers, bills, settings || {}, yearId);
        newData.createdAt = serverTimestamp();
        newData.updatedAt = serverTimestamp();
        await setDoc(yearDocRef, newData);

        await this._loadYearsList();
        await this.switchYear(yearId);
    }

    // ────────── Entity CRUD ──────────

    /** @private Guard: throws if year is read-only. */
    _guardReadOnly() {
        const { activeYear } = this._state;
        if (!activeYear || isYearReadOnly(activeYear)) {
            throw new Error(
                activeYear
                    ? 'This billing year is ' + activeYear.status + ' and read-only.'
                    : 'No active billing year.'
            );
        }
    }

    /** @private Emit a billing event and return the updated events array. */
    _emitEvent(eventType, payload) {
        const event = {
            id: generateEventId(),
            timestamp: new Date().toISOString(),
            actor: { type: 'admin', userId: this._user ? this._user.uid : null },
            eventType,
            payload: payload || {},
            note: '',
            source: 'ui'
        };
        const events = [...(this._state.billingEvents || []), event];
        return events;
    }

    // ── Members ──

    /**
     * Add a family member.
     * @param {{ name: string, email?: string, phone?: string }} data
     * @returns {Object} the new member
     */
    addMember(data) {
        this._guardReadOnly();
        const { familyMembers } = this._state;

        if (!data.name || !data.name.trim()) throw new Error('Name is required.');
        const trimmed = data.name.trim();
        if (familyMembers.some(m => m.name === trimmed)) {
            throw new Error('A member named "' + trimmed + '" already exists.');
        }

        const member = {
            id: generateUniqueId(familyMembers.map(m => m.id)),
            name: trimmed,
            email: (data.email || '').trim(),
            phone: (data.phone || '').trim(),
            avatar: '',
            paymentReceived: 0,
            linkedMembers: []
        };

        this._setState({ familyMembers: [...familyMembers, member] });
        this.save();
        return member;
    }

    /**
     * Update fields on an existing member.
     * @param {number} memberId
     * @param {Object} fields — partial update (name, email, phone, avatar, linkedMembers)
     */
    updateMember(memberId, fields) {
        this._guardReadOnly();
        const { familyMembers } = this._state;
        const idx = familyMembers.findIndex(m => m.id === memberId);
        if (idx === -1) throw new Error('Member not found.');

        // Duplicate name check
        if (fields.name !== undefined) {
            const trimmed = fields.name.trim();
            if (!trimmed) throw new Error('Name is required.');
            if (familyMembers.some(m => m.name === trimmed && m.id !== memberId)) {
                throw new Error('A member named "' + trimmed + '" already exists.');
            }
            fields = { ...fields, name: trimmed };
        }

        const updated = [...familyMembers];
        updated[idx] = { ...updated[idx], ...fields };
        this._setState({ familyMembers: updated });
        this.save();
    }

    /**
     * Remove a family member and clean up references.
     * Port of removeFamilyMember() from main.js:1067.
     * @param {number} memberId
     */
    removeMember(memberId) {
        this._guardReadOnly();
        const { familyMembers, bills, payments } = this._state;

        // Unlink from other members
        const updatedMembers = familyMembers
            .filter(m => m.id !== memberId)
            .map(m => ({
                ...m,
                linkedMembers: m.linkedMembers.filter(id => id !== memberId)
            }));

        // Remove from all bills
        const updatedBills = bills.map(b => ({
            ...b,
            members: b.members.filter(id => id !== memberId)
        }));

        // Remove payments for this member
        const updatedPayments = payments.filter(p => p.memberId !== memberId);

        this._setState({
            familyMembers: updatedMembers,
            bills: updatedBills,
            payments: updatedPayments
        });
        this.save();
    }

    // ── Bills ──

    /**
     * Add a new bill.
     * @param {{ name: string, amount: number, billingFrequency?: string, website?: string }} data
     * @returns {Object} the new bill
     */
    addBill(data) {
        this._guardReadOnly();
        const { bills } = this._state;

        if (!data.name || !data.name.trim()) throw new Error('Bill name is required.');
        const amount = parseFloat(data.amount);
        if (!amount || amount <= 0) throw new Error('Amount must be greater than zero.');

        const bill = {
            id: generateUniqueBillId(bills.map(b => b.id)),
            name: data.name.trim(),
            amount,
            billingFrequency: data.billingFrequency || 'monthly',
            logo: '',
            website: (data.website || '').trim(),
            members: []
        };

        const events = this._emitEvent('BILL_CREATED', {
            billId: bill.id, billName: bill.name, amount: bill.amount,
            billingFrequency: bill.billingFrequency, website: bill.website
        });

        this._setState({ bills: [...bills, bill], billingEvents: events });
        this.save();
        return bill;
    }

    /**
     * Update fields on an existing bill.
     * @param {number} billId
     * @param {Object} fields
     */
    updateBill(billId, fields) {
        this._guardReadOnly();
        const { bills } = this._state;
        const idx = bills.findIndex(b => b.id === billId);
        if (idx === -1) throw new Error('Bill not found.');

        const prev = bills[idx];
        const updated = [...bills];
        updated[idx] = { ...prev, ...fields };

        // Emit update events for tracked fields
        let events = this._state.billingEvents;
        for (const field of ['name', 'amount', 'billingFrequency', 'website']) {
            if (fields[field] !== undefined && fields[field] !== prev[field]) {
                events = [...events, {
                    id: generateEventId(),
                    timestamp: new Date().toISOString(),
                    actor: { type: 'admin', userId: this._user ? this._user.uid : null },
                    eventType: 'BILL_UPDATED',
                    payload: {
                        billId, billName: updated[idx].name, field,
                        previousValue: prev[field], newValue: fields[field]
                    },
                    note: '', source: 'ui'
                }];
            }
        }

        this._setState({ bills: updated, billingEvents: events });
        this.save();
    }

    /**
     * Remove a bill.
     * @param {number} billId
     */
    removeBill(billId) {
        this._guardReadOnly();
        const { bills } = this._state;
        const bill = bills.find(b => b.id === billId);

        const events = this._emitEvent('BILL_DELETED', {
            billId,
            billName: bill ? bill.name : '',
            amount: bill ? bill.amount : 0,
            billingFrequency: bill ? bill.billingFrequency : 'monthly',
            memberCount: bill ? bill.members.length : 0
        });

        this._setState({
            bills: bills.filter(b => b.id !== billId),
            billingEvents: events
        });
        this.save();
    }

    /**
     * Toggle a member's assignment to a bill.
     * Port of toggleMember() from main.js:1578.
     * @param {number} billId
     * @param {number} memberId
     */
    toggleBillMember(billId, memberId) {
        this._guardReadOnly();
        const { bills, familyMembers } = this._state;
        const idx = bills.findIndex(b => b.id === billId);
        if (idx === -1) throw new Error('Bill not found.');

        const bill = bills[idx];
        const memberObj = familyMembers.find(m => m.id === memberId);
        const isMember = bill.members.includes(memberId);

        const newMembers = isMember
            ? bill.members.filter(id => id !== memberId)
            : [...bill.members, memberId];

        const events = this._emitEvent(
            isMember ? 'MEMBER_REMOVED_FROM_BILL' : 'MEMBER_ADDED_TO_BILL',
            {
                billId, billName: bill.name,
                memberId, memberName: memberObj ? memberObj.name : '',
                newMemberCount: newMembers.length
            }
        );

        const updated = [...bills];
        updated[idx] = { ...bill, members: newMembers };
        this._setState({ bills: updated, billingEvents: events });
        this.save();
    }

    // ── Payments ──

    /**
     * Record a payment for a member.
     * Simplified single-member payment — distributed payments will be added in Phase 2b.
     * @param {{ memberId: number, amount: number, method?: string, note?: string }} data
     */
    recordPayment(data) {
        this._guardReadOnly();
        const { payments, familyMembers } = this._state;
        const member = familyMembers.find(m => m.id === data.memberId);
        if (!member) throw new Error('Member not found.');

        const amount = Math.max(0, parseFloat(data.amount) || 0);
        if (amount <= 0) throw new Error('Amount must be greater than zero.');

        const entry = {
            id: generateUniquePaymentId(),
            memberId: data.memberId,
            amount,
            receivedAt: new Date().toISOString(),
            note: data.note || '',
            method: data.method || 'other'
        };

        const events = this._emitEvent('PAYMENT_RECORDED', {
            paymentId: entry.id,
            memberId: data.memberId,
            memberName: member.name,
            amount,
            method: entry.method,
            distributed: false
        });

        this._setState({
            payments: [...payments, entry],
            billingEvents: events
        });
        this.save();
        return entry;
    }

    // ── Settings ──

    /**
     * Update billing year settings (email template, payment methods, payment links).
     * @param {Object} fields — partial settings update
     */
    updateSettings(fields) {
        this._guardReadOnly();
        const { settings } = this._state;
        this._setState({ settings: { ...(settings || {}), ...fields } });
        this.save();
    }
}
