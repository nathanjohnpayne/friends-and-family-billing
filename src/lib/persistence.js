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
        settings: settingsForSave
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
        closedAt: yearData.closedAt || null
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
        archivedAt: null,
        familyMembers: [],
        bills: [],
        payments: [],
        creditAdjustments: [],
        owedAdjustments: [],
        settings: settings
    };
}
