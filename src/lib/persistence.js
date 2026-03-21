// Persistence helpers — save payload construction and data normalization.
// No DOM, no Firestore, no module-scoped state.

/**
 * Build the Firestore save payload from current state.
 * Does NOT include FieldValue.serverTimestamp() — caller adds createdAt fallback and updatedAt.
 * @param {{ label: string, status: string, createdAt: *, archivedAt: * }} currentBillingYear
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {Array} billingEvents
 * @param {Object} settings
 * @returns {Object}
 */
export function buildSavePayload(currentBillingYear, familyMembers, bills, payments, billingEvents, settings) {
    const settingsForSave = Object.assign({}, settings);
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
        familyMembers: familyMembers,
        bills: bills,
        payments: payments,
        billingEvents: billingEvents,
        settings: settingsForSave
    };
}

/**
 * Normalize a loaded billing year document, applying field defaults.
 * Mutates member and bill objects in place (matching existing behavior).
 * @param {Object} yearData - raw Firestore document data
 * @param {string} yearId
 * @returns {{ year: Object, members: Array, bills: Array, payments: Array, billingEvents: Array, settings: Object|null }}
 */
export function normalizeYearData(yearData, yearId) {
    const year = {
        id: yearId,
        label: yearData.label || yearId,
        status: yearData.status || 'open',
        createdAt: yearData.createdAt,
        archivedAt: yearData.archivedAt || null
    };

    const members = (yearData.familyMembers || []).map(m => {
        if (!m.email) m.email = '';
        if (!m.phone) m.phone = '';
        if (!m.avatar) m.avatar = '';
        if (m.paymentReceived === undefined) m.paymentReceived = 0;
        if (!m.linkedMembers) m.linkedMembers = [];
        return m;
    });

    const bills = (yearData.bills || []).map(b => {
        if (!b.logo) b.logo = '';
        if (!b.website) b.website = '';
        if (!b.members) b.members = [];
        if (!b.billingFrequency) b.billingFrequency = 'monthly';
        return b;
    });

    const payments = yearData.payments || [];
    const billingEvents = yearData.billingEvents || [];

    let settings = yearData.settings || null;
    if (settings) {
        if (!settings.paymentLinks) settings.paymentLinks = [];
        // paymentMethods migration is handled by caller (depends on migratePaymentLinksToMethods)
    }

    return { year, members, bills, payments, billingEvents, settings };
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
        settings: settings
    };
}
