// Validators, predicates, and ID generators — no DOM, no Firestore.

export const PAYMENT_PROVIDER_PATTERN = /\b(venmo|zelle|paypal|cash\s*app|apple\s*cash|bank\s*transfer)\b/i;

/**
 * Detect when a template contains both the %payment_methods% token AND
 * hardcoded payment provider text, which would cause payment info to render twice.
 * @param {string} template
 * @returns {boolean}
 */
export function detectDuplicatePaymentText(template) {
    if (!template) return false;
    const hasToken = template.indexOf('%payment_methods%') !== -1;
    if (!hasToken) return false;
    const withoutToken = template.replace(/%payment_methods%/g, '');
    return PAYMENT_PROVIDER_PATTERN.test(withoutToken);
}

/**
 * Validate E.164 phone format: + followed by 1-15 digits
 * @param {string} phone
 * @returns {boolean}
 */
export function isValidE164(phone) {
    return /^\+[1-9]\d{1,14}$/.test(phone);
}

/**
 * @param {string} status
 * @returns {string}
 */
export function normalizeDisputeStatus(status) {
    if (status === 'pending') return 'open';
    if (status === 'reviewed') return 'in_review';
    return status || 'open';
}

/**
 * @returns {string}
 */
export function generateEventId() {
    return 'evt_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}

/**
 * @returns {string}
 */
export function generateUniquePaymentId() {
    return 'pay_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}

/**
 * @returns {string}
 */
export function generateRawToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} rawToken
 * @returns {Promise<string>}
 */
export async function hashToken(rawToken) {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {Array<number>} existingIds
 * @returns {number}
 */
export function generateUniqueId(existingIds) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    let newId = timestamp + random;
    while (existingIds.includes(newId)) {
        newId++;
    }
    return newId;
}

/**
 * @param {Array<number>} existingIds
 * @returns {number}
 */
export function generateUniqueBillId(existingIds) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    let newId = timestamp + random;
    while (existingIds.includes(newId)) {
        newId++;
    }
    return newId;
}

// ──────────────── Billing Year Status Predicates ────────────────

/**
 * @param {{ status: string }|null} year
 * @returns {boolean}
 */
export function isArchivedYear(year) {
    return year != null && year.status === 'archived';
}

/**
 * @param {{ status: string }|null} year
 * @returns {boolean}
 */
export function isClosedYear(year) {
    return year != null && year.status === 'closed';
}

/**
 * @param {{ status: string }|null} year
 * @returns {boolean}
 */
export function isSettlingYear(year) {
    return year != null && year.status === 'settling';
}

/**
 * @param {{ status: string }|null} year
 * @returns {boolean}
 */
export function isYearReadOnly(year) {
    return isClosedYear(year) || isArchivedYear(year);
}

/**
 * @param {{ status: string }|null} year
 * @returns {string}
 */
export function yearReadOnlyMessage(year) {
    if (isArchivedYear(year)) return 'This billing year is archived and read-only.';
    if (isClosedYear(year)) return 'This billing year is closed. All balances are settled.';
    return '';
}
