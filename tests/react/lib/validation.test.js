import { describe, it, expect } from 'vitest';
import {
    PAYMENT_PROVIDER_PATTERN,
    detectDuplicatePaymentText,
    isValidE164,
    normalizeDisputeStatus,
    generateEventId,
    generateUniquePaymentId,
    generateUniqueId,
    generateUniqueBillId,
    isArchivedYear,
    isClosedYear,
    isSettlingYear,
    isYearReadOnly,
    yearReadOnlyMessage
} from '@/lib/validation.js';

describe('PAYMENT_PROVIDER_PATTERN', () => {
    it('matches known providers case-insensitively', () => {
        expect(PAYMENT_PROVIDER_PATTERN.test('Pay via Venmo')).toBe(true);
        expect(PAYMENT_PROVIDER_PATTERN.test('ZELLE transfer')).toBe(true);
        expect(PAYMENT_PROVIDER_PATTERN.test('use Cash App')).toBe(true);
    });

    it('does not match unrelated text', () => {
        expect(PAYMENT_PROVIDER_PATTERN.test('pay by mail')).toBe(false);
    });
});

describe('detectDuplicatePaymentText', () => {
    it('returns false if template has no %payment_methods% token', () => {
        expect(detectDuplicatePaymentText('Pay via Venmo')).toBe(false);
    });

    it('returns false if template has token but no hardcoded provider', () => {
        expect(detectDuplicatePaymentText('Here are the methods: %payment_methods%')).toBe(false);
    });

    it('returns true if template has both token and hardcoded provider', () => {
        expect(detectDuplicatePaymentText('Pay via Venmo. Methods: %payment_methods%')).toBe(true);
    });

    it('returns false for null/empty', () => {
        expect(detectDuplicatePaymentText(null)).toBe(false);
        expect(detectDuplicatePaymentText('')).toBe(false);
    });
});

describe('isValidE164', () => {
    it('accepts valid E.164 numbers', () => {
        expect(isValidE164('+14155551234')).toBe(true);
        expect(isValidE164('+442071234567')).toBe(true);
    });

    it('rejects invalid formats', () => {
        expect(isValidE164('14155551234')).toBe(false); // no +
        expect(isValidE164('+0123')).toBe(false); // starts with 0
        expect(isValidE164('')).toBe(false);
    });
});

describe('normalizeDisputeStatus', () => {
    it('maps legacy "pending" to "open"', () => {
        expect(normalizeDisputeStatus('pending')).toBe('open');
    });

    it('maps legacy "reviewed" to "in_review"', () => {
        expect(normalizeDisputeStatus('reviewed')).toBe('in_review');
    });

    it('passes through known statuses', () => {
        expect(normalizeDisputeStatus('resolved')).toBe('resolved');
    });

    it('defaults to "open" for falsy input', () => {
        expect(normalizeDisputeStatus(null)).toBe('open');
        expect(normalizeDisputeStatus('')).toBe('open');
    });
});

describe('generateEventId', () => {
    it('returns prefixed string', () => {
        expect(generateEventId()).toMatch(/^evt_\d+_\d+$/);
    });
});

describe('generateUniquePaymentId', () => {
    it('returns prefixed string', () => {
        expect(generateUniquePaymentId()).toMatch(/^pay_\d+_\d+$/);
    });
});

describe('generateUniqueId', () => {
    it('returns a number not in the existing list', () => {
        const existing = [100, 200, 300];
        const id = generateUniqueId(existing);
        expect(typeof id).toBe('number');
        expect(existing).not.toContain(id);
    });
});

describe('generateUniqueBillId', () => {
    it('returns a number not in the existing list', () => {
        const existing = [100, 200, 300];
        const id = generateUniqueBillId(existing);
        expect(typeof id).toBe('number');
        expect(existing).not.toContain(id);
    });
});

describe('year status predicates', () => {
    it('isArchivedYear', () => {
        expect(isArchivedYear({ status: 'archived' })).toBe(true);
        expect(isArchivedYear({ status: 'open' })).toBe(false);
        expect(isArchivedYear(null)).toBe(false);
    });

    it('isClosedYear', () => {
        expect(isClosedYear({ status: 'closed' })).toBe(true);
        expect(isClosedYear({ status: 'open' })).toBe(false);
        expect(isClosedYear(null)).toBe(false);
    });

    it('isSettlingYear', () => {
        expect(isSettlingYear({ status: 'settling' })).toBe(true);
        expect(isSettlingYear({ status: 'open' })).toBe(false);
        expect(isSettlingYear(null)).toBe(false);
    });

    it('isYearReadOnly is true for closed and archived', () => {
        expect(isYearReadOnly({ status: 'closed' })).toBe(true);
        expect(isYearReadOnly({ status: 'archived' })).toBe(true);
        expect(isYearReadOnly({ status: 'open' })).toBe(false);
        expect(isYearReadOnly({ status: 'settling' })).toBe(false);
    });

    it('yearReadOnlyMessage returns appropriate messages', () => {
        expect(yearReadOnlyMessage({ status: 'archived' })).toContain('archived');
        expect(yearReadOnlyMessage({ status: 'closed' })).toContain('closed');
        expect(yearReadOnlyMessage({ status: 'open' })).toBe('');
    });
});
