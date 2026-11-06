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
    collection, doc, getDocs, getDoc, setDoc, serverTimestamp, writeBatch, runTransaction
} from 'firebase/firestore';
import { db } from './firebase.js';
import { normalizeYearData, buildSavePayload, buildInitialYearData } from './persistence.js';
import { plainTextToDoc } from './template-doc.js';
import { buildNewYearData, isYearLabelDuplicate, buildCarryForwardSummary, applyCarryForwardToPriorYear } from './billing-year.js';
import { generateEventId, generateUniqueId, generateUniqueBillId, generateUniquePaymentId, generateUniqueAdjustmentId, generateCreditAdjustmentId, generateChargeNoticeId, localDateString, isYearReadOnly, isValidE164 } from './validation.js';
import { isLinkedToAnyone, calculateAnnualSummary, getHouseholdFinancials, getHouseholdOpeningBalance, CREDIT_EPSILON } from './calculations.js';
import { selectBillableCharges } from './chargeNotice.js';
import { planHouseholdEdit, findHouseholdContactId, getHouseholdMemberIds, revertHouseholdFields } from './household.js';
import { rebuildMemberShareDocs } from './ShareLinkService.js';
import { SaveQueue } from './SaveQueue.js';
import { splitCents } from './year-end-review.js';

/** Default settings for a new billing year. */
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
            creditAdjustments: [],
            owedAdjustments: [],
            billingEvents: [],
            settings: null,
            loading: true,
            error: null
        };

        this._saveQueue = new SaveQueue();
        /** @private Serializes household operations (save + share rebuild), #528. */
        this._householdChain = Promise.resolve();
        /** @private Household operations requested and not yet settled. */
        this._householdPending = 0;
        this._yearOpPending = 0;
        /** @private Latest year-document snapshot enqueued, per year id, with a sequence number. */
        this._queuedYearSnapshots = new Map();
        this._yearSnapshotSeq = 0;

        /** @type {Set<() => void>} */
        this._listeners = new Set();
    }

    // ────────── E2E test support ──────────

    /**
     * Inject test state directly, bypassing Firestore.
     * Only used by E2E tests via window.__E2E_DATA__.
     */
    _injectTestState(data) {
        this._e2eMode = true;
        this._setState({ ...data, loading: false, error: null });
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
        // E2E mode: state is injected, skip Firestore loading
        if (this._e2eMode) return;
        // Skip reload if the same user is already bound
        if (user?.uid && user.uid === this._user?.uid) return;

        this._user = user;
        if (!user) {
            this._setState({
                billingYears: [], activeYear: null, familyMembers: [],
                bills: [], payments: [], creditAdjustments: [], owedAdjustments: [], billingEvents: [],
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
                creditAdjustments: normalized.creditAdjustments,
                owedAdjustments: normalized.owedAdjustments,
                billingEvents: normalized.billingEvents,
                settings: normalized.settings
            });
        } else {
            this._setState({
                activeYear: { id: yearId, label: yearId, status: 'open', createdAt: null, archivedAt: null },
                familyMembers: [], bills: [], payments: [],
                creditAdjustments: [], owedAdjustments: [], billingEvents: [], settings: null
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
        // E2E mode: no-op, don't write to Firestore
        if (this._e2eMode) return Promise.resolve();
        const { activeYear, familyMembers, bills, payments, creditAdjustments, owedAdjustments, billingEvents, settings } = this._state;
        if (!this._user || !activeYear) return Promise.resolve();
        if (activeYear.status === 'closed' || activeYear.status === 'archived') {
            console.warn('Cannot save: year is ' + activeYear.status);
            return Promise.resolve();
        }

        return this._saveQueue.enqueue(this._yearDocWrite(activeYear, familyMembers, bills, payments, billingEvents, settings, creditAdjustments, owedAdjustments));
    }

    /** @private The write function save() enqueues, over a snapshot of the state. */
    _yearDocWrite(activeYear, familyMembers, bills, payments, billingEvents, settings, creditAdjustments, owedAdjustments) {
        const uid = this._user.uid;
        this._yearSnapshotSeq += 1;
        this._queuedYearSnapshots.set(activeYear.id, {
            seq: this._yearSnapshotSeq,
            uid,
            args: [activeYear, familyMembers, bills, payments, billingEvents, settings, creditAdjustments, owedAdjustments]
        });
        return async () => {
            const yearDocRef = doc(db, 'users', uid, 'billingYears', activeYear.id);
            const payload = buildSavePayload(activeYear, familyMembers, bills, payments, billingEvents, settings, creditAdjustments, owedAdjustments);
            if (!payload.createdAt) payload.createdAt = serverTimestamp();
            payload.updatedAt = serverTimestamp();
            await setDoc(yearDocRef, payload);
        };
    }

    /**
     * @private Like save(), but rejects when this write fails. The SaveQueue keeps its
     * chain alive by swallowing write errors (after logging them and notifying
     * subscribers), so a caller that must not continue after a failed write — one
     * that then publishes share documents from the new state — observes the outcome
     * here. Resolves without writing in the same cases save() does (E2E, no user or
     * year, closed or archived year).
     */
    async _saveConfirmed() {
        const { activeYear, familyMembers, bills, payments, creditAdjustments, owedAdjustments, billingEvents, settings } = this._state;
        if (this._e2eMode || !this._user || !activeYear) return;
        if (activeYear.status === 'closed' || activeYear.status === 'archived') return;
        await this._enqueueConfirmed(this._yearDocWrite(activeYear, familyMembers, bills, payments, billingEvents, settings, creditAdjustments, owedAdjustments));
    }

    /** @private Enqueue a write and reject when that write fails (see _saveConfirmed). */
    async _enqueueConfirmed(write) {
        let failure = null;
        await this._saveQueue.enqueue(async () => {
            try {
                await write();
            } catch (err) {
                failure = err;
                throw err; // the queue still logs it and notifies save:error subscribers
            }
        });
        if (failure) throw failure;
    }

    /**
     * Transition the active year to a new status.
     * Port of setBillingYearStatus() from main.js.
     * @param {string} newStatus - 'open' | 'settling' | 'closed' | 'archived'
     */
    async setYearStatus(newStatus) {
        if (!this._user) return;
        // Its write carries the in-memory billing events, and closing the year would
        // stop a failed household change's compensating save (#528).
        this._guardHouseholdGraph();
        return this._runYearOperation(() => this._setYearStatusNow(newStatus));
    }

    /** @private setYearStatus's body; always called through _runYearOperation. */
    async _setYearStatusNow(newStatus) {
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
     *
     * Carry-forward seam (#322, ADR 0005/0006/0007). HIGH-RISK: new-year
     * construction + the append-only marking of the prior year. Before building
     * the new year, computes the prior (current) year's UNDISPOSED items —
     * household credits and still-deferred Usage Charges — nets them per
     * household, and:
     *   1. seeds the new year with one `carry_opening` opening-balance record per
     *      carrying household (via buildNewYearData), so the carried balance lands
     *      in the new year's owed/annual total and first invoice; and
     *   2. marks the prior year APPEND-ONLY — a `carry_forward` credit record per
     *      carried credit (disposing it, so the old year's gate no longer sees it)
     *      and an in-place `deferred` → `carried_forward` status transition on each
     *      carried Usage Charge (preserved, never deleted) — then persists the
     *      prior-year doc as a full document (round-trips through the full-document save).
     *
     * If nothing is undisposed, behaves exactly as before (no seeds, no prior-year
     * write). The prior-year credit is materialized lazily here (ADR 0004/0007):
     * if no next year ever existed, the credit stayed live; creating the next year
     * is what carries it.
     *
     * #319 reconciliation (ADR 0003/0006): a credit re-opened by an active
     * `not_received` is owed back THIS year and must not carry. Refund notices
     * live in the `disputes` subcollection the service does not load, so the
     * caller (which has `useRefundNotices`) passes the re-opened id set via
     * `options.reopenedAdjustmentIds`; it threads into the carry computation so a
     * resurfaced credit is held back. Defaults to empty.
     *
     * @param {string} yearId
     * @param {{ reopenedAdjustmentIds?: Set }} [options]
     */
    async createYear(yearId, options = {}) {
        if (!this._user) return;
        // The rollover snapshots the household into the new year and the prior year's
        // carry marking; a household change still being saved could be rolled back
        // after that snapshot (#528).
        this._guardHouseholdGraph();
        return this._runYearOperation(() => this._createYearNow(yearId, options));
    }

    /**
     * @private While a year-level operation (Start New Year including its switch into
     * the new year, or a status change) is running, household operations are refused
     * (#528): they would snapshot a year whose status, events or carry markings are
     * about to change, and their write could overwrite the operation's.
     */
    async _runYearOperation(operation) {
        this._yearOpPending += 1;
        try {
            return await operation();
        } finally {
            this._yearOpPending -= 1;
        }
    }

    /** @private createYear's body; always called through _runYearOperation. */
    async _createYearNow(yearId, options) {
        const { activeYear, billingYears, familyMembers, bills, payments, creditAdjustments, owedAdjustments, billingEvents, settings } = this._state;

        if (isYearLabelDuplicate(billingYears, yearId)) {
            throw new Error('Billing year "' + yearId + '" already exists.');
        }

        // Compute what carries from the prior (current) year. A credit re-opened by
        // an active not_received (#319, ADR 0003) is held back from the carry.
        const carry = buildCarryForwardSummary(
            familyMembers, bills, payments || [], creditAdjustments || [], owedAdjustments || [],
            { reopenedAdjustmentIds: options.reopenedAdjustmentIds || new Set() }
        );
        const priorLabel = activeYear ? (activeYear.label || activeYear.id) : null;

        // 1. Build the new-year seed (netted opening balances) — do NOT write inline.
        const newYearRef = doc(db, 'users', this._user.uid, 'billingYears', yearId);
        const newData = buildNewYearData(familyMembers, bills, settings || {}, yearId, carry, priorLabel);
        newData.createdAt = serverTimestamp();
        newData.updatedAt = serverTimestamp();

        // 2. Build the prior-year append-only marking payload (only if something carried
        //    and we have a prior year to write back to) — again, do NOT write inline.
        let priorWrite = null;
        if (activeYear && carry.memberCount > 0) {
            const marked = applyCarryForwardToPriorYear(
                creditAdjustments || [], owedAdjustments || [], carry,
                { nextYearLabel: yearId, userId: this._user.uid, idFactory: () => generateCreditAdjustmentId() }
            );
            const priorEvent = {
                id: generateEventId(),
                timestamp: new Date().toISOString(),
                actor: { type: 'admin', userId: this._user.uid },
                eventType: 'YEAR_CARRIED_FORWARD',
                payload: {
                    toYear: yearId,
                    memberCount: carry.memberCount,
                    totalOpeningBalance: carry.totalOpeningBalance
                },
                note: '',
                source: 'ui'
            };
            const priorEvents = [...(billingEvents || []), priorEvent];
            const priorRef = doc(db, 'users', this._user.uid, 'billingYears', activeYear.id);
            const priorPayload = buildSavePayload(
                activeYear, familyMembers, bills, payments || [], priorEvents, settings,
                marked.creditAdjustments, marked.owedAdjustments
            );
            if (!priorPayload.createdAt) priorPayload.createdAt = serverTimestamp();
            priorPayload.updatedAt = serverTimestamp();
            priorWrite = { ref: priorRef, payload: priorPayload };
        }

        // 3. Commit BOTH writes as a single Firestore writeBatch INSIDE the SaveQueue
        //    (#330 P1). The queue SERIALIZES the rollover behind any pending full-document
        //    save of the prior/active year (so a queued pre-carry save lands first and the
        //    carry-marked write then supersedes it — no lost carry_forward records), and
        //    the batch makes the new-year seed + prior-year marking ATOMIC (if the prior
        //    write fails, the new year is never created, so retrying the same label does
        //    not throw duplicate against a half-written rollover). The SaveQueue swallows
        //    write errors (it only notifies listeners), so capture any commit failure and
        //    re-throw after the enqueue settles to fail createYear loudly and skip the
        //    switch into a non-existent year.
        let rolloverError = null;
        await this._saveQueue.enqueue(async () => {
            try {
                const batch = writeBatch(db);
                batch.set(newYearRef, newData);
                if (priorWrite) batch.set(priorWrite.ref, priorWrite.payload);
                await batch.commit();
            } catch (err) {
                rolloverError = err;
            }
        });
        if (rolloverError) throw rolloverError;

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

        // One-household invariant (mirrors main.js:1028–1031): a member belongs to at
        // most one household, and only a household contact (the stored primary) lists
        // members. Copy is neutral — households are peers (#528, ADR 0011).
        if (fields.linkedMembers !== undefined) {
            this._guardHouseholdGraph();
            const member = familyMembers[idx];
            for (const otherId of fields.linkedMembers) {
                if (otherId === memberId) {
                    throw new Error('A member cannot be added to their own household twice.');
                }
                const other = familyMembers.find(m => m.id === otherId);
                if (!other) {
                    throw new Error('Household member not found.');
                }
                // The member must not be the contact of a household of their own
                if (other.linkedMembers && other.linkedMembers.length > 0) {
                    throw new Error(other.name + ' already has a household of their own.');
                }
                // The member must not already be in a DIFFERENT household
                const existingContact = familyMembers.find(m =>
                    m.id !== memberId && m.linkedMembers.includes(otherId)
                );
                if (existingContact) {
                    throw new Error(other.name + ' is already in ' + existingContact.name + '\u2019s household.');
                }
            }
            // The member being updated must not already be in someone else's household
            if (fields.linkedMembers.length > 0 && isLinkedToAnyone(familyMembers, memberId)) {
                throw new Error(member.name + ' is already in another household.');
            }
        }

        const updated = [...familyMembers];
        updated[idx] = { ...updated[idx], ...fields };
        // A dissolved household keeps no name (the name lives on the contact's record).
        if (fields.linkedMembers !== undefined && fields.linkedMembers.length === 0) {
            delete updated[idx].householdName;
        }
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
        this._guardHouseholdGraph();
        const { familyMembers, bills, payments } = this._state;

        // The household contact cannot leave a household without a replacement
        // (#528): choose a new contact first, then remove the member.
        const target = familyMembers.find(m => m.id === memberId);
        if (target && (target.linkedMembers || []).length > 0) {
            throw new Error('Choose a new household contact for ' + target.name + '\u2019s household before removing them.');
        }

        // Unlink from other members
        const updatedMembers = familyMembers
            .filter(m => m.id !== memberId)
            .map(m => {
                const linkedMembers = m.linkedMembers.filter(id => id !== memberId);
                const next = { ...m, linkedMembers };
                // A dissolved household keeps no name (ADR 0011).
                if (linkedMembers.length === 0) delete next.householdName;
                return next;
            });

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

    /**
     * Create, edit or dissolve a household, and choose its contact (#528, ADR 0011).
     *
     * The contact becomes the stored primary and every other member becomes its
     * linked member. Members may come from the household being edited or be
     * individuals; members left out become individuals. Every payment, charge and
     * credit stays on the member it was recorded for, and household figures sum the
     * whole member set, so the household's totals are unchanged by a contact change.
     * The optional household name is stored on the contact's record.
     *
     * After saving, the cached share documents of the previous and the new contact
     * are rebuilt so both members' links show their current shape.
     *
     * @param {{ contactId: *, memberIds: Array, householdName?: string }} edit
     *   memberIds: every member of the household, contact included.
     *   householdName: a string sets it ('' clears it); omit to keep the current name.
     * @returns {Promise<{ contactId: *, previousContactId: *, memberIds: Array,
     *   released: Array, householdName: string, shareDocsRebuilt: number|null }>}
     *   shareDocsRebuilt is null when the share rebuild failed (the household change
     *   itself is saved either way).
     * @throws when the billing-year write fails; the change is then rolled back and no
     *   share document is rebuilt.
     */
    saveHousehold(edit) {
        return this._serializeHousehold(() => this._saveHouseholdNow(edit));
    }

    /**
     * @private While a household operation is pending, other edits to the household
     * link graph are refused (#528): a failed operation rolls back its own links, and
     * that is only safe when nothing else changed the graph meanwhile. Mutations that
     * read the household to decide who a ledger row belongs to (a Refund, a payment
     * distributed across a household, billing a household's deferred charges) are refused too, so no row is built from a
     * household that is then rolled back, and so are year-level operations that
     * snapshot the year (Start New Year, a status change).
     */
    _guardHouseholdGraph() {
        if (this._householdPending > 0) {
            throw new Error('A household change is still being saved. Try again in a moment.');
        }
        // Start New Year snapshots the household and a status change rewrites the
        // year; a link edit landing meanwhile would be lost or would overwrite them.
        if (this._yearOpPending > 0) {
            throw new Error('The billing year is being updated. Try again in a moment.');
        }
    }

    /** @private The (user, year) a household operation was requested in. */
    _householdContext() {
        return {
            uid: this._user ? this._user.uid : null,
            yearId: this._state.activeYear ? this._state.activeYear.id : null
        };
    }

    /**
     * @private Run household operations one at a time. Each operation's save AND
     * share rebuild finish before the next one plans against the then-current state,
     * so an older rebuild can never overwrite the cache a newer edit wrote. A failed
     * operation does not block the next.
     */
    _serializeHousehold(operation) {
        if (this._yearOpPending > 0) {
            return Promise.reject(new Error('The billing year is being updated. Try the household change again in a moment.'));
        }
        // Bind the operation to the user and year it was requested in. If either has
        // changed by the time its turn comes (e.g. the administrator switched years
        // while an earlier operation was running), it is rejected rather than applied
        // to another year's household — member ids survive Start New Year.
        const requested = this._householdContext();
        const guarded = () => {
            const now = this._householdContext();
            if (now.uid !== requested.uid || now.yearId !== requested.yearId) {
                throw new Error('The billing year changed before the household change ran; it was not applied.');
            }
            return operation();
        };
        this._householdPending += 1;
        const run = this._householdChain.then(guarded, guarded);
        const settle = () => { this._householdPending -= 1; };
        run.then(settle, settle);
        this._householdChain = run.catch(() => {});
        return run;
    }

    /** @private saveHousehold's body; always called through _serializeHousehold. */
    async _saveHouseholdNow(edit) {
        this._guardReadOnly();
        const editedYearId = this._state.activeYear ? this._state.activeYear.id : null;
        const plan = planHouseholdEdit(this._state.familyMembers, edit || {});

        let billingEvents = this._state.billingEvents || [];
        let addedEventId = null;
        if (plan.previousContactId !== plan.contactId) {
            const byId = new Map(this._state.familyMembers.map(m => [m.id, m]));
            billingEvents = this._emitEvent('HOUSEHOLD_CONTACT_CHANGED', {
                previousContactId: plan.previousContactId,
                previousContactName: byId.get(plan.previousContactId)?.name || '',
                contactId: plan.contactId,
                contactName: byId.get(plan.contactId)?.name || '',
                memberIds: plan.memberIds
            });
            addedEventId = billingEvents[billingEvents.length - 1].id;
        }

        const previousMembers = this._state.familyMembers;
        this._setState({ familyMembers: plan.familyMembers, billingEvents });
        // Bind the share rebuild to the year being edited: capture its inputs now,
        // before awaiting persistence, so a year switch while the write is pending
        // cannot point the rebuild at another year's links.
        const shareInputs = this._shareRebuildInputs();
        // _saveConfirmed builds its write synchronously, so the snapshot sequence read
        // right after the call is this edit's own write.
        const confirmed = this._saveConfirmed();
        const ownSeq = this._yearSnapshotSeq;
        try {
            await confirmed;
        } catch (err) {
            // Do not publish share documents for a household that was not persisted.
            // Undo only this edit, in two places, then report the failure:
            //
            // 1. Local state, if it is still the edited year: put back the household
            //    fields this edit changed (all of them or none, see
            //    revertHouseholdFields) and remove only the event it appended. A
            //    mutation that landed meanwhile — a member's name or email edit, a
            //    payment and its PAYMENT_RECORDED event — is kept. After a year switch
            //    the state belongs to another year (member ids survive Start New Year)
            //    and is left alone; after a reload it no longer holds the edit.
            //
            // 2. The stored year document: a write enqueued behind ours (e.g.
            //    recordPayment's save) holds the rejected household and will persist
            //    it. _compensateQueuedYearWrite waits for it and then reverts only the
            //    household fields and the event in the stored document, leaving
            //    everything else (including another client's changes) as stored.
            const message = 'The household change could not be saved: ' + (err && err.message ? err.message : 'unknown error');
            const currentYearId = this._state.activeYear ? this._state.activeYear.id : null;
            let localConflict = false;
            if (currentYearId === editedYearId) {
                const rollback = {};
                try {
                    const restoredMembers = revertHouseholdFields(this._state.familyMembers, plan.familyMembers, previousMembers);
                    if (restoredMembers) rollback.familyMembers = restoredMembers;
                } catch (revertErr) {
                    if (revertErr.code !== 'household-revert-conflict') throw revertErr;
                    localConflict = true;
                }
                const events = this._state.billingEvents || [];
                if (addedEventId && events.some(e => e.id === addedEventId)) {
                    rollback.billingEvents = events.filter(e => e.id !== addedEventId);
                }
                if (rollback.familyMembers || rollback.billingEvents) this._setState(rollback);
            }
            await this._compensateOrReport(message, () =>
                this._compensateQueuedYearWrite(editedYearId, ownSeq, plan.familyMembers, previousMembers, addedEventId));
            if (localConflict) {
                throw new Error(message + '. The household could not be restored here because it changed meanwhile; reload before making further changes.');
            }
            throw new Error(message);
        }
        const shareDocsRebuilt = await this._rebuildShareDocs(plan.affectedContactIds, shareInputs);

        return {
            contactId: plan.contactId,
            previousContactId: plan.previousContactId,
            memberIds: plan.memberIds,
            released: plan.released,
            householdName: plan.householdName,
            shareDocsRebuilt
        };
    }

    /**
     * @private Run a failed household change's compensating write and wait for it.
     * If it fails too, a write queued meanwhile may have persisted the rejected
     * household, so the reported error says so and asks for a reload.
     */
    async _compensateOrReport(message, compensate) {
        try {
            await compensate();
        } catch (err) {
            throw new Error(message + '. Restoring the saved household also failed ('
                + (err && err.message ? err.message : 'unknown error')
                + '); reload before making further changes.');
        }
    }

    /**
     * @private After a failed household write that the local state can no longer
     * undo (the year was switched or reloaded meanwhile, or is now read-only): if a
     * later write for the edited year was enqueued behind it, that write holds the
     * rejected household. Once it has landed (this runs in the SaveQueue behind it),
     * read the stored year document in a transaction and revert only this edit's
     * household fields and event there. Every other field — status, lifecycle
     * events, ledger rows, including changes another client made meanwhile — is left
     * exactly as stored, and the current (other) year's state is never written.
     */
    async _compensateQueuedYearWrite(yearId, ownSeq, plannedMembers, previousMembers, addedEventId) {
        const latest = this._queuedYearSnapshots.get(yearId);
        if (!latest || latest.seq <= ownSeq || !this._user || latest.uid !== this._user.uid) return;
        const yearDocRef = doc(db, 'users', latest.uid, 'billingYears', yearId);
        await this._enqueueConfirmed(() => runTransaction(db, async (tx) => {
            const snap = await tx.get(yearDocRef);
            if (!snap.exists()) return;
            const stored = snap.data() || {};
            const restoredMembers = revertHouseholdFields(stored.familyMembers || [], plannedMembers, previousMembers);
            const events = stored.billingEvents || [];
            const restoredEvents = addedEventId && events.some(e => e.id === addedEventId)
                ? events.filter(e => e.id !== addedEventId)
                : null;
            if (!restoredMembers && !restoredEvents) return;
            const patch = { updatedAt: serverTimestamp() };
            if (restoredMembers) patch.familyMembers = restoredMembers;
            if (restoredEvents) patch.billingEvents = restoredEvents;
            tx.update(yearDocRef, patch);
        }));
    }

    /**
     * Make a member the contact of the household they are in (#528). Membership and
     * the household name are unchanged.
     * @param {*} memberId  the new household contact
     * @returns {Promise<Object>} saveHousehold's result
     */
    changeHouseholdContact(memberId) {
        // The household is read when the operation runs (after any pending household
        // operation), not when it is requested.
        return this._serializeHousehold(() => {
            this._guardReadOnly();
            const { familyMembers } = this._state;
            const currentContactId = findHouseholdContactId(familyMembers, memberId);
            if (currentContactId === null) throw new Error('Member not found.');
            const currentContact = familyMembers.find(m => m.id === currentContactId);
            if ((currentContact.linkedMembers || []).length === 0) {
                throw new Error(currentContact.name + ' is not in a household.');
            }
            return this._saveHouseholdNow({
                contactId: memberId,
                memberIds: getHouseholdMemberIds(currentContact)
            });
        });
    }

    /** @private Snapshot of the active year's state that a share rebuild reads. */
    _shareRebuildInputs() {
        const { activeYear, familyMembers, bills, payments, owedAdjustments, settings } = this._state;
        return {
            userId: this._user ? this._user.uid : null,
            activeYear,
            familyMembers,
            bills,
            payments,
            owedAdjustments: owedAdjustments || [],
            settings: settings || {}
        };
    }

    /**
     * @private Rebuild the cached share documents for these members' active links,
     * from the given snapshot (see _shareRebuildInputs). Returns the number
     * rewritten, or null when the rebuild failed.
     */
    async _rebuildShareDocs(memberIds, inputs) {
        if (this._e2eMode || !inputs || !inputs.userId || !inputs.activeYear) return 0;
        try {
            return await rebuildMemberShareDocs({
                userId: inputs.userId,
                billingYearId: inputs.activeYear.id,
                memberIds,
                familyMembers: inputs.familyMembers,
                bills: inputs.bills,
                payments: inputs.payments,
                owedAdjustments: inputs.owedAdjustments,
                activeYear: inputs.activeYear,
                settings: inputs.settings
            });
        } catch (err) {
            console.error('Error rebuilding share documents after a household change:', err);
            return null;
        }
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

        // Guard every distribution request: a pending contact change may have cleared
        // this member's links, which would record the payment unsplit.
        if (data.distribute) this._guardHouseholdGraph();
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

    // ── Usage Charges (owedAdjustments, #317) ──

    /**
     * Record a per-member Usage Charge — a `+owed` ad-hoc debit (e.g. a roaming
     * overage). Appends to owedAdjustments[] defaulting to status `deferred`:
     * recorded and visible to the member, but NOT yet billed, so it does NOT
     * affect current-year settlement (it is not added to owed). The financial
     * source of truth lives on the adjustment record.
     *
     * Append-only: a charge is voided via a later status change, NEVER deleted
     * (mirrors the payments-ledger immutability discipline). Emits a
     * USAGE_CHARGE_RECORDED billing event following the PAYMENT_RECORDED pattern.
     *
     * This is a NEW mutation; it deliberately does not touch recordPayment /
     * reversePayment or the payments[] ledger.
     *
     * @param {{ memberId: *, amount: number, description: string, incurredDate?: string }} data
     * @returns {Object} the new owedAdjustments[] record
     */
    recordUsageCharge(data) {
        this._guardReadOnly();
        const { owedAdjustments, familyMembers } = this._state;

        const member = familyMembers.find(m => m.id === data.memberId);
        if (!member) throw new Error('Member not found.');

        const parsedAmount = Number.parseFloat(data.amount);
        const cents = Number.isFinite(parsedAmount)
            ? Math.round((parsedAmount + Number.EPSILON) * 100)
            : 0;
        if (cents <= 0) throw new Error('Amount must be greater than zero.');
        const amount = cents / 100;

        const description = (data.description || '').trim();
        if (!description) throw new Error('A description is required.');

        const charge = {
            id: generateUniqueAdjustmentId(),
            memberId: data.memberId,
            kind: 'usage_charge',
            amount,
            description,
            incurredDate: data.incurredDate || localDateString(),
            status: 'deferred',
            createdAt: new Date().toISOString()
        };

        const events = this._emitEvent('USAGE_CHARGE_RECORDED', {
            adjustmentId: charge.id,
            memberId: charge.memberId,
            memberName: member.name,
            amount: charge.amount,
            description: charge.description,
            incurredDate: charge.incurredDate,
            status: charge.status
        });

        this._setState({
            owedAdjustments: [...(owedAdjustments || []), charge],
            billingEvents: events
        });
        this.save();
        return charge;
    }

    // ── Service Credits (owedAdjustments, #321) ──

    /**
     * Record a Service Credit — a `−owed`, bill-level reduction for a service that
     * was canceled, reduced, discounted, or had an issue (#321, ADR 0005). It is
     * the negative mirror of a Usage Charge: appended to owedAdjustments[] with
     * `kind: 'service_credit'` and `status: 'active'`, the financial source of truth
     * on the record. It does NOT edit the bill (Option B): the bill's `amount` and
     * history are untouched, so the bill's record stays honest.
     *
     * Bill-level by default: the amount is split among the bill's current members
     * (last member absorbs the rounding remainder so the per-member records sum
     * exactly to the gross amount, mirroring distributed payments). Pass a
     * `memberId` for the per-member variant (a one-person issue); that member must
     * be assigned to the bill.
     *
     * The reduction LOWERS the affected members' owed (getHouseholdFinancials, #321).
     * When a member has already paid, the surplus surfaces as a household Credit on
     * the EXISTING refund/carry pipeline (#316) — no new disposition path.
     *
     * Append-only: a credit is voided via a later status change, NEVER deleted
     * (mirrors recordUsageCharge / the payments-ledger discipline). Emits a
     * SERVICE_CREDIT_RECORDED billing event. Does not touch recordPayment /
     * reversePayment, the payments[] ledger, or the bill.
     *
     * @param {{ billId: *, amount: number, reason: string, memberId?: *, incurredDate?: string }} data
     * @returns {Array<Object>} the new owedAdjustments[] records (one per affected member)
     */
    recordServiceCredit(data) {
        this._guardReadOnly();
        const { owedAdjustments, bills } = this._state;

        const bill = bills.find(b => b.id === data.billId);
        if (!bill) throw new Error('Bill not found.');

        const billMembers = bill.members || [];
        if (billMembers.length === 0) {
            throw new Error('This bill has no members to credit.');
        }

        const parsedAmount = Number.parseFloat(data.amount);
        const totalCents = Number.isFinite(parsedAmount)
            ? Math.round((parsedAmount + Number.EPSILON) * 100)
            : 0;
        if (totalCents <= 0) throw new Error('Amount must be greater than zero.');

        const reason = (data.reason || '').trim();
        if (!reason) throw new Error('A reason is required.');

        // Determine the target members and each one's share in cents.
        let targetIds;
        if (data.memberId !== undefined && data.memberId !== null) {
            // Per-member variant: the whole amount lands on one member, who must be on the bill.
            if (!billMembers.includes(data.memberId)) {
                throw new Error('That member is not on this bill.');
            }
            targetIds = [data.memberId];
        } else {
            // Bill-level: split evenly across the bill's members.
            targetIds = billMembers.slice();
        }

        const incurredDate = data.incurredDate || localDateString();
        const createdAt = new Date().toISOString();

        const records = [];
        splitCents(totalCents, targetIds).forEach(({ memberId, cents: shareCents }) => {
            records.push({
                id: generateUniqueAdjustmentId(),
                memberId,
                billId: bill.id,
                kind: 'service_credit',
                amount: shareCents / 100,
                reason,
                incurredDate,
                status: 'active',
                createdAt
            });
        });

        const events = this._emitEvent('SERVICE_CREDIT_RECORDED', {
            billId: bill.id,
            billName: bill.name,
            amount: totalCents / 100,
            reason,
            incurredDate,
            memberId: data.memberId !== undefined && data.memberId !== null ? data.memberId : null,
            memberCount: records.length
        });

        this._setState({
            owedAdjustments: [...(owedAdjustments || []), ...records],
            billingEvents: events
        });
        this.save();
        return records;
    }

    // ── Off-cycle billing: Charge Notice (owedAdjustments, #320) ──

    /**
     * Off-cycle-bill a member's deferred Usage Charges via a Charge Notice (#320).
     * Flips the selected `owedAdjustments[]` records from `deferred` to `billed`
     * (append-only: status change, NEVER deleted — mirrors the payments-ledger
     * immutability discipline) and stamps each with the new `chargeNoticeId` and a
     * `billedAt` timestamp. A billed charge is present-tense money: it raises the
     * household's owed (via getBilledUsageChargeTotalForMember in calculations.js),
     * so unpaid → Outstanding → blocks close (ADR 0006). Settlement is through the
     * existing payments ledger; this mutation does NOT touch recordPayment /
     * reversePayment / recordUsageCharge or the payments[] array.
     *
     * Selection defaults to ALL of the member's deferred charges; an optional
     * incurred-date range (the "this month" preset) or an explicit chargeIds list
     * narrows it. The outbound Charge Notice document + member email are created by
     * ChargeNoticeService.issueChargeNotice using this mutation's result.
     *
     * HIGH-RISK: settlement/owed boundary. Emits a CHARGES_BILLED billing event
     * (mirroring USAGE_CHARGE_RECORDED / REFUND_ISSUED).
     *
     * @param {{ memberId: *, range?: { from?: string, to?: string }, chargeIds?: Array }} data
     * @returns {{ chargeNoticeId: string, memberId: *, amount: number, chargeIds: Array, charges: Array }}
     */
    billDeferredCharges(data) {
        this._guardReadOnly();
        // Selects charges at the household grain from the contact's links (#528).
        this._guardHouseholdGraph();
        const { owedAdjustments, familyMembers } = this._state;

        const member = familyMembers.find(m => m.id === data.memberId);
        if (!member) throw new Error('Member not found.');

        // Select the deferred charges to bill at the household grain (ADR 0001):
        // the primary plus their linked members. Default: all of the household's.
        const householdIds = [member.id, ...(member.linkedMembers || [])];
        let selected = selectBillableCharges(owedAdjustments, householdIds, data.range || {});
        if (Array.isArray(data.chargeIds)) {
            const wanted = new Set(data.chargeIds);
            selected = selected.filter(c => wanted.has(c.id));
        }
        if (selected.length === 0) {
            throw new Error('No deferred charges to bill for this member in the selected period.');
        }

        const chargeNoticeId = generateChargeNoticeId();
        const billedAt = new Date().toISOString();
        const billedIds = new Set(selected.map(c => c.id));
        const amount = Math.round(selected.reduce((sum, c) => sum + (c.amount || 0), 0) * 100) / 100;

        // Append-only flip: replace each selected record with a billed copy; all
        // other records pass through untouched.
        const updatedAdjustments = (owedAdjustments || []).map(a =>
            billedIds.has(a.id)
                ? { ...a, status: 'billed', chargeNoticeId, billedAt }
                : a
        );

        const events = this._emitEvent('CHARGES_BILLED', {
            chargeNoticeId,
            memberId: member.id,
            memberName: member.name,
            amount,
            chargeIds: Array.from(billedIds),
            count: selected.length
        });

        this._setState({ owedAdjustments: updatedAdjustments, billingEvents: events });
        this.save();

        return {
            chargeNoticeId,
            memberId: member.id,
            amount,
            chargeIds: selected.map(c => c.id),
            charges: selected
        };
    }

    // ── Credit dispositions (#318) ──

    /**
     * Issue a Refund for a household that carries a Credit. Recording the refund
     * (Model B, ADR 0003) clears the credit immediately — no member confirmation
     * required — by appending to creditAdjustments[] (append-only; void via status,
     * never deleted). The refund lives OUTSIDE the payments ledger and reduces the
     * household's Net Contribution so it reads Settled. The amount is capped at the
     * household's current credit. HIGH-RISK: settlement/ledger boundary.
     * @param {{ memberId: number, amount: number, method?: string, reason: string }} data
     * @returns {Object} the recorded creditAdjustment
     */
    issueRefund(data) {
        this._guardReadOnly();
        this._guardHouseholdGraph();
        const { familyMembers, bills, payments, creditAdjustments, owedAdjustments } = this._state;
        const member = familyMembers.find(m => m.id === data.memberId);
        if (!member) throw new Error('Member not found.');
        // A Refund is a household disposition (ADR 0001) — issued to the primary member.
        if (isLinkedToAnyone(familyMembers, member.id)) {
            throw new Error('Refunds are issued to the household contact.');
        }

        const amount = Math.round((parseFloat(data.amount) || 0) * 100) / 100;
        if (amount <= 0) throw new Error('Refund amount must be greater than zero.');

        const reason = (data.reason || '').trim();
        if (!reason) throw new Error('A reason is required.');

        // Cap at the household's current credit (Net Contribution − owed). The reopen
        // set is null (5th arg): the cap must NOT re-open a not_received refund (#319),
        // because doing so would inflate the credit and permit a double-refund. owedAdjustments
        // is passed as the 6th arg so a credit produced by a Service Credit (#321, reduced
        // owed) is still refundable through this same pipeline — no separate disposition path.
        // openingBalance is the 7th arg so a household that carried in a credit (#322) has
        // its refundable credit computed exactly as the board shows (the carry lowered owed).
        const summary = calculateAnnualSummary(familyMembers, bills);
        const openingBalance = getHouseholdOpeningBalance(member, owedAdjustments);
        const { credit } = getHouseholdFinancials(member, summary, payments, creditAdjustments, null, owedAdjustments, openingBalance);
        if (credit <= CREDIT_EPSILON) throw new Error('This household has no credit to refund.');
        if (amount > credit + CREDIT_EPSILON) {
            throw new Error('Refund cannot exceed the household credit of ' + credit.toFixed(2) + '.');
        }

        const entry = {
            id: generateCreditAdjustmentId(),
            memberId: member.id,
            type: 'refund',
            amount,
            method: data.method || 'other',
            reason,
            status: 'recorded',
            createdAt: new Date().toISOString()
        };
        const event = {
            id: generateEventId(),
            timestamp: new Date().toISOString(),
            actor: { type: 'admin', userId: this._user ? this._user.uid : null },
            eventType: 'REFUND_ISSUED',
            payload: {
                adjustmentId: entry.id,
                memberId: member.id,
                memberName: member.name,
                amount,
                method: entry.method
            },
            note: '',
            source: 'ui'
        };

        this._setState({
            creditAdjustments: [...(creditAdjustments || []), entry],
            billingEvents: [...(this._state.billingEvents || []), event]
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
