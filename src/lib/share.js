// Share link helpers — no DOM, no Firestore, no module-scoped state.

/**
 * Build the default scopes array for a share link.
 * @param {boolean} allowDisputeCreate
 * @param {boolean} allowDisputeRead
 * @returns {string[]}
 */
export function buildShareScopes(allowDisputeCreate, allowDisputeRead) {
    const scopes = ['summary:read', 'paymentMethods:read'];
    if (allowDisputeCreate) scopes.push('disputes:create');
    if (allowDisputeRead) scopes.push('disputes:read');
    return scopes;
}

/**
 * Build the share token document for Firestore.
 * Does NOT include FieldValue.serverTimestamp() or Timestamp.fromDate() —
 * caller wraps expiresAt and adds createdAt.
 * @param {string} userId
 * @param {number} memberId
 * @param {string} memberName
 * @param {string} billingYearId
 * @param {string} rawToken
 * @param {Date|null} expiresAt
 * @param {string[]} scopes
 * @returns {Object}
 */
export function buildShareTokenDoc(userId, memberId, memberName, billingYearId, rawToken, expiresAt, scopes) {
    return {
        ownerId: userId,
        memberId: memberId,
        billingYearId: billingYearId,
        scopes: scopes,
        revoked: false,
        expiresAt: expiresAt || null,
        memberName: memberName,
        rawToken: rawToken,
        lastAccessedAt: null,
        accessCount: 0
    };
}

/**
 * Build the share URL from an origin and raw token.
 * @param {string} origin - e.g. window.location.origin
 * @param {string} rawToken
 * @returns {string}
 */
export function buildShareUrl(origin, rawToken) {
    return origin + '/share.html?token=' + rawToken;
}

/**
 * Compute an expiry Date from a number of days, or null for no expiry.
 * @param {number} expiryDays - 0 or falsy means no expiry
 * @returns {Date|null}
 */
export function computeExpiryDate(expiryDays) {
    if (!expiryDays || expiryDays <= 0) return null;
    const d = new Date();
    d.setDate(d.getDate() + expiryDays);
    return d;
}

/**
 * Check if a share token is stale (revoked or expired).
 * @param {{ revoked: boolean, expiresAt: *|null }} tokenData
 * @param {Date} now
 * @returns {boolean}
 */
export function isShareTokenStale(tokenData, now) {
    if (tokenData.revoked) return true;
    if (!tokenData.expiresAt) return false;
    const expiryDate = tokenData.expiresAt.toDate
        ? tokenData.expiresAt.toDate()
        : new Date(tokenData.expiresAt);
    return expiryDate < now;
}
