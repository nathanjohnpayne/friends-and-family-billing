// Persistence helpers — save payload construction and data normalization.
// No DOM, no Firestore, no module-scoped state.

import { normalizeHouseholdName } from './household.js';

/**
 * Build the Firestore save payload from current state.
 * Does NOT include FieldValue.serverTimestamp() — caller adds createdAt fallback and updatedAt.
 * @param {{ label: string, status: string, createdAt: *, archivedAt: *, closedAt: * }} currentBillingYear
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {Array} billingEvents
 * @param {Object} settings
 * @param {Array} [creditAdjustments]  refunds + carried-forward credits (#316). Preserved
 *   verbatim so a full-document save never drops them (save uses setDoc without merge).
 * @param {Array} [owedAdjustments]  Usage Charges (#317) — signed owed-modifiers. Preserved
 *   verbatim for the same reason: a full-document save would otherwise erase them.
 * @returns {Object}
 */
export function buildSavePayload(currentBillingYear, familyMembers, bills, payments, billingEvents, settings, creditAdjustments = [], owedAdjustments = []) {
    const settingsForSave = Object.assign({}, settings);
    // Strip transient migration flag — not user data.
    // _templateDocVersion IS persisted so the re-migration only runs once.
    delete settingsForSave._templateMigrated;
    if (settingsForSave.paymentMethods) {
        settingsForSave.paymentMethods = settingsForSave.paymentMethods.map(m => {
            if (m.qrCode) {
                const copy = Object.assign({}, m);
                copy.hasQrCode = true;
                delete copy.qrCode;
                return copy;
            }
            return m;
        });
    }
    return {
        label: currentBillingYear.label,
        status: currentBillingYear.status,
        createdAt: currentBillingYear.createdAt || null,
        archivedAt: currentBillingYear.archivedAt || null,
        // closedAt is written by the status-transition merge path (setYearStatus →
        // setDoc merge). It MUST be threaded through this allowlist or the next
        // full-document save (setDoc without merge) silently erases it. See ADR 0008.
        closedAt: currentBillingYear.closedAt || null,
        // Member records are saved whole, so per-member fields — including the
        // optional householdName on a household contact's record (#528, ADR 0011) —
        // round-trip without a separate allowlist entry.
        familyMembers: familyMembers,
        bills: bills,
        payments: payments,
        creditAdjustments: creditAdjustments,
        owedAdjustments: owedAdjustments,
        billingEvents: billingEvents,
        settings: settingsForSave,
        // Version fields (#614, ADR 0009 § 3, ADR 0008 amended). The write primitive
        // (BillingYearService._commitYearWrite) sets both on every write; they are
        // carried here only when the year already has them, because Firestore rejects
        // undefined fields and an unversioned document has neither.
        ...(currentBillingYear.rev !== undefined ? { rev: currentBillingYear.rev } : {}),
        ...(currentBillingYear.lastWriteId !== undefined ? { lastWriteId: currentBillingYear.lastWriteId } : {})
    };
}

/**
 * Normalize a loaded billing year document, applying field defaults.
 * Mutates member and bill objects in place (matching existing behavior).
 * @param {Object} yearData - raw Firestore document data
 * @param {string} yearId
 * @returns {{ year: Object, members: Array, bills: Array, payments: Array, creditAdjustments: Array, owedAdjustments: Array, billingEvents: Array, settings: Object|null }}
 */
export function normalizeYearData(yearData, yearId) {
    const year = {
        id: yearId,
        label: yearData.label || yearId,
        status: yearData.status || 'open',
        createdAt: yearData.createdAt,
        archivedAt: yearData.archivedAt || null,
        closedAt: yearData.closedAt || null,
        // `undefined` for an unversioned document: a missing version is never zero.
        rev: yearData.rev,
        lastWriteId: yearData.lastWriteId
    };

    const members = (yearData.familyMembers || []).map(m => {
        if (!m.email) m.email = '';
        if (!m.phone) m.phone = '';
        if (!m.avatar) m.avatar = '';
        if (m.paymentReceived === undefined) m.paymentReceived = 0;
        if (!m.linkedMembers) m.linkedMembers = [];
        return m;
    });
    // Optional household name, kept only on a household contact's record (#528,
    // ADR 0011): a member with links who is not linked by anyone. Keep a trimmed
    // non-empty string; drop anything else, and drop a name on any other member.
    const linkedIds = new Set(members.flatMap(m => m.linkedMembers || []));
    members.forEach(m => {
        if (m.householdName === undefined) return;
        const isContact = m.linkedMembers.length > 0 && !linkedIds.has(m.id);
        const name = isContact ? normalizeHouseholdName(m.householdName) : '';
        if (name) m.householdName = name;
        else delete m.householdName;
    });

    const bills = (yearData.bills || []).map(b => {
        if (!b.logo) b.logo = '';
        if (!b.website) b.website = '';
        if (!b.members) b.members = [];
        if (!b.billingFrequency) b.billingFrequency = 'monthly';
        return b;
    });

    const payments = yearData.payments || [];
    const creditAdjustments = yearData.creditAdjustments || [];
    const owedAdjustments = yearData.owedAdjustments || [];
    const billingEvents = yearData.billingEvents || [];

    let settings = yearData.settings || null;
    if (settings) {
        if (!settings.paymentLinks) settings.paymentLinks = [];
        // paymentMethods migration is handled by caller (depends on migratePaymentLinksToMethods)
    }

    return { year, members, bills, payments, creditAdjustments, owedAdjustments, billingEvents, settings };
}

/**
 * Build an empty year document for a brand-new user.
 * Does NOT include FieldValue.serverTimestamp() — caller adds createdAt and updatedAt.
 * @param {string} yearId
 * @param {Object} settings
 * @returns {Object}
 */
export function buildInitialYearData(yearId, settings) {
    return {
        label: yearId,
        status: 'open',
        rev: 1,
        archivedAt: null,
        familyMembers: [],
        bills: [],
        payments: [],
        creditAdjustments: [],
        owedAdjustments: [],
        settings: settings
    };
}

/** Fields every fingerprint leaves out: server timestamps resolve on the server and
 *  the version fields are what the fingerprint stands in for (#614 Addendum 3). */
export const FINGERPRINT_EXCLUDED_FIELDS = Object.freeze(['createdAt', 'updatedAt', 'lastWriteId', 'rev']);

/** @private A JSON-safe, key-sorted copy; Timestamps and Dates become ISO strings. */
function canonicalValue(value) {
    if (value === null || value === undefined) return value === null ? null : undefined;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object' && typeof value.toDate === 'function') {
        try { return value.toDate().toISOString(); } catch (_) { /* fall through */ }
    }
    if (Array.isArray(value)) return value.map(item => { const c = canonicalValue(item); return c === undefined ? null : c; });
    if (typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            const c = canonicalValue(value[key]);
            if (c !== undefined) out[key] = c;
        }
        return out;
    }
    if (typeof value === 'number' && Object.is(value, -0)) return 0;
    return value;
}

/** @private cyrb53, a fast non-cryptographic 53-bit string hash. */
function hash53(str, seed) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Fingerprint of a normalized year document (#614, spec § Versioned year-document
 * writes): a key-order-independent hash over every field the full-document save
 * writes (label, status, archivedAt, closedAt, members, bills, payments, credit and
 * owed adjustments, billing events and settings as buildSavePayload stores them),
 * with timestamps as ISO strings. `createdAt`, `updatedAt`, `lastWriteId` and `rev`
 * are excluded. Used for the first versioned write of an unversioned document: it may
 * proceed only while the stored document still matches the loaded snapshot.
 *
 * @param {ReturnType<typeof normalizeYearData>} normalized
 * @returns {string}
 */
export function computeDocumentFingerprint(normalized) {
    const year = normalized.year || {};
    const payload = buildSavePayload(year, normalized.members || [], normalized.bills || [], normalized.payments || [],
        normalized.billingEvents || [], normalized.settings || null, normalized.creditAdjustments || [], normalized.owedAdjustments || []);
    // buildSavePayload turns a null settings object into {}; keep the two distinct.
    if (!normalized.settings) payload.settings = null;
    for (const field of FINGERPRINT_EXCLUDED_FIELDS) delete payload[field];
    const canonical = JSON.stringify(canonicalValue(payload));
    return 'ydf1:' + hash53(canonical, 1) + hash53(canonical, 2);
}

/**
 * Fingerprint of a raw stored year document without mutating it (normalizeYearData
 * fills defaults in place, so it runs on a canonical copy).
 * @param {Object} rawData  Firestore document data
 * @param {string} yearId
 * @returns {string}
 */
export function fingerprintStoredYear(rawData, yearId) {
    return computeDocumentFingerprint(normalizeYearData(canonicalValue(rawData || {}) || {}, yearId));
}

/**
 * A JSON-safe snapshot of a save payload (timestamps as ISO strings, sentinels and
 * undefined dropped), used as the last-committed baseline and for Copy details.
 * @param {Object} payload
 * @returns {Object}
 */
export function plainYearPayload(payload) {
    const copy = { ...(payload || {}) };
    // Server-timestamp sentinels are not data; neither timestamp is compared.
    for (const field of ['createdAt', 'updatedAt']) delete copy[field];
    return canonicalValue(copy) || {};
}

/**
 * The JSON-safe save payload a stored year document normalizes to (defaults filled
 * as the app loads it), without mutating it: the first last-committed baseline, so
 * a field default the load adds is never listed as an unsaved change.
 * @param {Object} rawData  Firestore document data
 * @param {string} yearId
 * @returns {Object}
 */
export function loadedYearPayload(rawData, yearId) {
    const n = normalizeYearData(canonicalValue(rawData || {}) || {}, yearId);
    return plainYearPayload(buildSavePayload(n.year, n.members, n.bills, n.payments, n.billingEvents, n.settings,
        n.creditAdjustments, n.owedAdjustments));
}
