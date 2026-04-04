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
import { plainTextToDoc } from './invoice.js';
import { buildNewYearData, isYearLabelDuplicate } from './billing-year.js';
import { generateEventId, generateUniqueId, generateUniqueBillId, generateUniquePaymentId, isYearReadOnly, isValidE164 } from './validation.js';
import { isLinkedToAnyone, calculateAnnualSummary } from './calculations.js';
import { SaveQueue } from './SaveQueue.js';

/** Default settings matching the legacy app (main.js line 77). */
const DEFAULT_SETTINGS = {
    emailMessage: 'Hello %first_name%,\n\nYour annual billing summary for %billing_year% is ready. Your annual amount due is %household_total%. Thank you for your prompt payment via any of the payment methods below.',
    emailSubject: '',
    paymentLinks: [],
    paymentMethods: []
};

/** Token rename pairs for idempotent migration. */
const TOKEN_RENAMES = [
    ['%member_first%', '%first_name%'],
    ['%member_last%', '%last_name%'],
    ['%member_name%', '%full_name%'],
    ['%annual_total%', '%household_total%'],
];

/**
 * Current migration version for emailMessageDocument.
 * Bump this when plainTextToDoc is fixed and existing documents need re-deriving.
 *   v1: initial TipTap migration (no markdown mark parsing)
 *   v2: added bold/italic/link markdown parsing in plainTextToDoc
 */
const TEMPLATE_DOC_VERSION = 2;

/**
 * Idempotent migration: rename legacy token names in email templates.
 * Also re-derives emailMessageDocument from emailMessage when the document
 * was created by an older version of plainTextToDoc.
 * Mutates settings in place. Does not persist (caller saves).
 */
function migrateTemplateTokens(settings) {
    if (!settings) return;

    // Phase 1: rename legacy token names in plaintext fields
    if (!settings._templateMigrated) {
        for (const [oldToken, newToken] of TOKEN_RENAMES) {
            if (settings.emailMessage) {
                settings.emailMessage = settings.emailMessage.split(oldToken).join(newToken);
            }
            if (settings.emailSubject) {
                settings.emailSubject = settings.emailSubject.split(oldToken).join(newToken);
            }
        }
        settings._templateMigrated = true;
    }

    // Phase 2: re-derive TipTap document if it was created by an older migration.
    // This re-runs plainTextToDoc (now with markdown parsing) on the plaintext
    // fallback, replacing documents that have raw **bold** or [link](url) text.
    if (settings.emailMessageDocument && (settings._templateDocVersion || 0) < TEMPLATE_DOC_VERSION) {
        if (settings.emailMessage) {
            settings.emailMessageDocument = plainTextToDoc(settings.emailMessage);
        }
        settings._templateDocVersion = TEMPLATE_DOC_VERSION;
    }
}

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
        // Skip reload if the same user is already bound
        if (user?.uid && user.uid === this._user?.uid) return;

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

            // Migrate legacy token names in email templates
            migrateTemplateTokens(normalized.settings);

            // Restore QR codes from publicQrCodes for methods that have hasQrCode flag
            if (normalized.settings && normalized.settings.paymentMethods) {
                const methodsWithQrFlag = normalized.settings.paymentMethods.filter(m => m.hasQrCode && !m.qrCode);
                if (methodsWithQrFlag.length > 0) {
                    await Promise.all(methodsWithQrFlag.map(async m => {
                        const qrDocId = this._user.uid + '_' + m.id;
                        try {
                            const qrDoc = await getDoc(doc(db, 'publicQrCodes', qrDocId));
                            if (qrDoc.exists() && qrDoc.data().qrCode) {
                                m.qrCode = qrDoc.data().qrCode;
                            }
                        } catch (_) { /* QR doc may not exist */ }
                    }));
                }
            }

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

        const phone = (data.phone || '').trim();
        if (phone && !isValidE164(phone)) {
            throw new Error('Invalid phone number. Use E.164 format (e.g. +14155551212) or leave blank.');
        }

        const member = {
            id: generateUniqueId(familyMembers.map(m => m.id)),
            name: trimmed,
            email: (data.email || '').trim(),
            phone,
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

        // E.164 phone validation (mirrors main.js:986)
        if (fields.phone !== undefined) {
            const phone = fields.phone.trim();
            if (phone && !isValidE164(phone)) {
                throw new Error('Invalid phone number. Use E.164 format (e.g. +14155551212) or leave blank.');
            }
            fields = { ...fields, phone };
        }

        // One-parent household invariant (mirrors main.js:1028–1031)
        // A member can only be linked to ONE parent, and parents can't be children.
        if (fields.linkedMembers !== undefined) {
            const member = familyMembers[idx];
            for (const childId of fields.linkedMembers) {
                if (childId === memberId) {
                    throw new Error('A member cannot be linked to themselves.');
                }
                const child = familyMembers.find(m => m.id === childId);
                if (!child) {
                    throw new Error('Linked member not found.');
                }
                // Child must not be a parent (has its own linked members)
                if (child.linkedMembers && child.linkedMembers.length > 0) {
                    throw new Error(child.name + ' is a parent and cannot be linked as a child.');
                }
                // Child must not already be linked to a DIFFERENT parent
                const existingParent = familyMembers.find(m =>
                    m.id !== memberId && m.linkedMembers.includes(childId)
                );
                if (existingParent) {
                    throw new Error(child.name + ' is already linked to ' + existingParent.name + '.');
                }
            }
            // The parent being updated must not themselves be a child of someone else
            if (fields.linkedMembers.length > 0 && isLinkedToAnyone(familyMembers, memberId)) {
                throw new Error(member.name + ' is linked as a child and cannot have their own linked members.');
            }
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

        const website = (data.website || '').trim();
        if (website && !/^https?:\/\//i.test(website)) {
            throw new Error('Website URL must start with http:// or https://.');
        }

        const bill = {
            id: generateUniqueBillId(bills.map(b => b.id)),
            name: data.name.trim(),
            amount,
            billingFrequency: data.billingFrequency || 'monthly',
            logo: '',
            website,
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

        // Amount validation (mirrors main.js:1387)
        if (fields.amount !== undefined) {
            const amount = parseFloat(fields.amount);
            if (isNaN(amount) || amount <= 0) {
                throw new Error('Amount must be greater than zero.');
            }
            fields = { ...fields, amount };
        }

        // Website validation (mirrors main.js:1456)
        if (fields.website !== undefined) {
            const website = fields.website.trim();
            if (website && !/^https?:\/\//i.test(website)) {
                throw new Error('Website URL must start with http:// or https://.');
            }
            fields = { ...fields, website };
        }

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
     * When `distribute` is true and the member has linked household members,
     * the payment is split proportionally across the household based on each
     * member's share of the combined annual total (mirrors main.js:2282).
     * @param {{ memberId: number, amount: number, method?: string, note?: string, distribute?: boolean }} data
     */
    recordPayment(data) {
        this._guardReadOnly();
        const { payments, familyMembers, bills } = this._state;
        const member = familyMembers.find(m => m.id === data.memberId);
        if (!member) throw new Error('Member not found.');

        const amount = Math.max(0, parseFloat(data.amount) || 0);
        if (amount <= 0) throw new Error('Amount must be greater than zero.');

        const now = new Date().toISOString();
        const method = data.method || 'other';
        const note = data.note || '';
        const newPayments = [];
        const newEvents = [];

        function makeEvent(user, eventType, payload) {
            return {
                id: generateEventId(),
                timestamp: new Date().toISOString(),
                actor: { type: 'admin', userId: user ? user.uid : null },
                eventType,
                payload: payload || {},
                note: '',
                source: 'ui'
            };
        }

        if (data.distribute && member.linkedMembers && member.linkedMembers.length > 0) {
            const summary = calculateAnnualSummary(familyMembers, bills);
            let combinedTotal = summary[data.memberId] ? summary[data.memberId].total : 0;
            member.linkedMembers.forEach(id => {
                if (summary[id]) combinedTotal += summary[id].total;
            });

            // Parent share
            const parentTotal = summary[data.memberId] ? summary[data.memberId].total : 0;
            const parentShare = combinedTotal > 0
                ? Math.round(amount * parentTotal / combinedTotal * 100) / 100
                : amount;

            const parentEntry = {
                id: generateUniquePaymentId(),
                memberId: data.memberId,
                amount: parentShare,
                receivedAt: now,
                note: note || 'Distributed payment',
                method
            };
            newPayments.push(parentEntry);
            newEvents.push(makeEvent(this._user, 'PAYMENT_RECORDED', {
                paymentId: parentEntry.id,
                memberId: data.memberId,
                memberName: member.name,
                amount: parentShare,
                method,
                distributed: true
            }));

            // Linked member shares
            let distributed = parentShare;
            const linked = member.linkedMembers.slice();
            linked.forEach((linkedId, i) => {
                const linkedTotal = summary[linkedId] ? summary[linkedId].total : 0;
                let childShare;
                if (i === linked.length - 1) {
                    // Last child gets remainder to avoid rounding drift
                    childShare = Math.round((amount - distributed) * 100) / 100;
                } else {
                    childShare = combinedTotal > 0
                        ? Math.round(amount * linkedTotal / combinedTotal * 100) / 100
                        : 0;
                    distributed += childShare;
                }
                if (childShare > 0) {
                    const childMember = familyMembers.find(m => m.id === linkedId);
                    const childEntry = {
                        id: generateUniquePaymentId(),
                        memberId: linkedId,
                        amount: childShare,
                        receivedAt: now,
                        note: note || 'Distributed from ' + member.name,
                        method
                    };
                    newPayments.push(childEntry);
                    newEvents.push(makeEvent(this._user, 'PAYMENT_RECORDED', {
                        paymentId: childEntry.id,
                        memberId: linkedId,
                        memberName: childMember ? childMember.name : '',
                        amount: childShare,
                        method,
                        distributed: true,
                        distributedFrom: data.memberId
                    }));
                }
            });
        } else {
            const entry = {
                id: generateUniquePaymentId(),
                memberId: data.memberId,
                amount,
                receivedAt: now,
                note,
                method
            };
            newPayments.push(entry);
            newEvents.push(makeEvent(this._user, 'PAYMENT_RECORDED', {
                paymentId: entry.id,
                memberId: data.memberId,
                memberName: member.name,
                amount,
                method,
                distributed: false
            }));
        }

        this._setState({
            payments: [...payments, ...newPayments],
            billingEvents: [...(this._state.billingEvents || []), ...newEvents]
        });
        this.save();
        return newPayments.length === 1 ? newPayments[0] : newPayments;
    }

    /**
     * Reverse a payment by creating a reversal entry (mirrors main.js:5374).
     * Does not delete the original — marks it reversed and creates an audit trail entry.
     * @param {string} paymentId — ID of the payment to reverse
     * @returns {{ original: Object, reversal: Object }}
     */
    reversePayment(paymentId) {
        this._guardReadOnly();
        const { payments, familyMembers } = this._state;
        const original = payments.find(p => p.id === paymentId);
        if (!original) throw new Error('Payment not found.');
        if (original.reversed) throw new Error('Payment already reversed.');
        if (original.type === 'reversal') throw new Error('Cannot reverse a reversal entry.');

        const member = familyMembers.find(m => m.id === original.memberId);
        const now = new Date().toISOString();

        const reversalEntry = {
            id: generateUniquePaymentId(),
            memberId: original.memberId,
            amount: -Math.abs(original.amount),
            receivedAt: now,
            note: 'Reversal of payment ' + paymentId,
            method: original.method,
            type: 'reversal',
            reversesPaymentId: paymentId
        };

        const updatedPayments = payments.map(p =>
            p.id === paymentId ? { ...p, reversed: true } : p
        );
        updatedPayments.push(reversalEntry);

        const events = this._emitEvent('PAYMENT_REVERSED', {
            paymentId: reversalEntry.id,
            reversedPaymentId: paymentId,
            memberId: original.memberId,
            memberName: member ? member.name : '',
            amount: original.amount
        });

        this._setState({ payments: updatedPayments, billingEvents: events });
        this.save();
        return { original: { ...original, reversed: true }, reversal: reversalEntry };
    }

    /**
     * Update a payment's editable fields (method, note).
     * Preserves append-only integrity — the original payment is updated in place
     * but a PAYMENT_UPDATED audit event records the before/after values.
     * @param {string} paymentId
     * @param {{ method?: string, note?: string }} fields
     */
    updatePayment(paymentId, fields) {
        this._guardReadOnly();
        const { payments, familyMembers } = this._state;
        const original = payments.find(p => p.id === paymentId);
        if (!original) throw new Error('Payment not found.');
        if (original.reversed) throw new Error('Cannot edit a reversed payment.');
        if (original.type === 'reversal') throw new Error('Cannot edit a reversal entry.');

        // Normalize stored values to match dialog defaults so legacy payments
        // without explicit method/note don't produce bogus diffs on no-op saves.
        const currentMethod = original.method || 'other';
        const currentNote = original.note || '';

        const changes = {};
        if (fields.method !== undefined && fields.method !== currentMethod) {
            changes.previousMethod = currentMethod;
            changes.newMethod = fields.method;
        }
        if (fields.note !== undefined && fields.note !== currentNote) {
            changes.previousNote = currentNote;
            changes.newNote = fields.note;
        }

        if (Object.keys(changes).length === 0) return original;

        const updated = { ...original };
        if (changes.newMethod !== undefined) updated.method = changes.newMethod;
        if (changes.newNote !== undefined) updated.note = changes.newNote;

        const updatedPayments = payments.map(p =>
            p.id === paymentId ? updated : p
        );

        const member = familyMembers.find(m => m.id === original.memberId);
        const events = this._emitEvent('PAYMENT_UPDATED', {
            paymentId,
            memberId: original.memberId,
            memberName: member ? member.name : '',
            amount: original.amount,
            ...changes
        });

        this._setState({ payments: updatedPayments, billingEvents: events });
        this.save();
        return updated;
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
