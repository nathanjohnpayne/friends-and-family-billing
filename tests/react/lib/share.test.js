import { describe, it, expect } from 'vitest';
import {
    buildShareScopes,
    buildShareTokenDoc,
    buildShareUrl,
    computeExpiryDate,
    isShareTokenStale
} from '@/lib/share.js';

describe('buildShareScopes', () => {
    it('always includes summary:read and paymentMethods:read', () => {
        const scopes = buildShareScopes(false, false);
        expect(scopes).toContain('summary:read');
        expect(scopes).toContain('paymentMethods:read');
        expect(scopes).toHaveLength(2);
    });

    it('adds disputes:create when allowed', () => {
        const scopes = buildShareScopes(true, false);
        expect(scopes).toContain('disputes:create');
        expect(scopes).not.toContain('disputes:read');
    });

    it('adds disputes:read when allowed', () => {
        const scopes = buildShareScopes(false, true);
        expect(scopes).toContain('disputes:read');
    });

    it('adds both dispute scopes', () => {
        const scopes = buildShareScopes(true, true);
        expect(scopes).toHaveLength(4);
    });
});

describe('buildShareTokenDoc', () => {
    const scopes = ['summary:read'];

    it('includes rawToken when truthy', () => {
        const doc = buildShareTokenDoc('uid1', 1, 'Alice', '2026', 'tok123', null, scopes);
        expect(doc.rawToken).toBe('tok123');
        expect(doc.ownerId).toBe('uid1');
        expect(doc.memberId).toBe(1);
        expect(doc.memberName).toBe('Alice');
    });

    it('omits rawToken when null (invoice flow)', () => {
        const doc = buildShareTokenDoc('uid1', 1, 'Alice', '2026', null, null, scopes);
        expect(doc).not.toHaveProperty('rawToken');
    });

    it('sets defaults for revoked, lastAccessedAt, accessCount', () => {
        const doc = buildShareTokenDoc('uid1', 1, 'Alice', '2026', 'tok', null, scopes);
        expect(doc.revoked).toBe(false);
        expect(doc.lastAccessedAt).toBeNull();
        expect(doc.accessCount).toBe(0);
    });
});

describe('buildShareUrl', () => {
    it('constructs the share URL', () => {
        expect(buildShareUrl('https://example.com', 'abc123')).toBe(
            'https://example.com/share?token=abc123'
        );
    });
});

describe('computeExpiryDate', () => {
    it('returns null for 0 or falsy days', () => {
        expect(computeExpiryDate(0)).toBeNull();
        expect(computeExpiryDate(null)).toBeNull();
        expect(computeExpiryDate(-1)).toBeNull();
    });

    it('returns a future date for positive days', () => {
        const result = computeExpiryDate(7);
        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBeGreaterThan(Date.now());
    });
});

describe('isShareTokenStale', () => {
    const now = new Date('2026-03-20T00:00:00Z');

    it('returns true for revoked tokens', () => {
        expect(isShareTokenStale({ revoked: true, expiresAt: null }, now)).toBe(true);
    });

    it('returns false for non-expired, non-revoked tokens', () => {
        expect(isShareTokenStale({
            revoked: false,
            expiresAt: new Date('2026-12-31')
        }, now)).toBe(false);
    });

    it('returns true for expired tokens', () => {
        expect(isShareTokenStale({
            revoked: false,
            expiresAt: new Date('2025-01-01')
        }, now)).toBe(true);
    });

    it('returns false when no expiry set', () => {
        expect(isShareTokenStale({ revoked: false, expiresAt: null }, now)).toBe(false);
    });

    it('handles Firestore Timestamp-like objects with .toDate()', () => {
        const firestoreTimestamp = {
            toDate: () => new Date('2025-01-01')
        };
        expect(isShareTokenStale({
            revoked: false,
            expiresAt: firestoreTimestamp
        }, now)).toBe(true);
    });
});
