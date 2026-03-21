import { describe, it, expect } from 'vitest';
import {
    BILLING_YEAR_STATUSES,
    DISPUTE_STATUS_LABELS,
    PAYMENT_METHOD_LABELS,
    getPaymentMethodLabel,
    getBillingYearStatusLabel,
    getBillFrequencyLabel,
    formatAnnualSummaryCurrency,
    formatFileSize,
    escapeHtml,
    sanitizeImageSrc,
    getInitials,
    getPaymentMethodDetail,
    disputeStatusClass
} from '@/lib/formatting.js';

describe('BILLING_YEAR_STATUSES', () => {
    it('has all four statuses with ordered labels', () => {
        expect(Object.keys(BILLING_YEAR_STATUSES)).toEqual(['open', 'settling', 'closed', 'archived']);
        expect(BILLING_YEAR_STATUSES.open.label).toBe('Open');
        expect(BILLING_YEAR_STATUSES.archived.order).toBe(3);
    });
});

describe('DISPUTE_STATUS_LABELS', () => {
    it('maps statuses to display labels', () => {
        expect(DISPUTE_STATUS_LABELS.in_review).toBe('In Review');
        expect(DISPUTE_STATUS_LABELS.resolved).toBe('Resolved');
    });
});

describe('getPaymentMethodLabel', () => {
    it('returns known labels', () => {
        expect(getPaymentMethodLabel('venmo')).toBe('Venmo');
        expect(getPaymentMethodLabel('apple_cash')).toBe('Apple Cash');
    });

    it('capitalizes unknown methods', () => {
        expect(getPaymentMethodLabel('bitcoin')).toBe('Bitcoin');
    });

    it('returns "Other" for null/undefined', () => {
        expect(getPaymentMethodLabel(null)).toBe('Other');
        expect(getPaymentMethodLabel(undefined)).toBe('Other');
    });
});

describe('getBillingYearStatusLabel', () => {
    it('returns the correct label for known statuses', () => {
        expect(getBillingYearStatusLabel('open')).toBe('Open');
        expect(getBillingYearStatusLabel('settling')).toBe('Settling');
    });

    it('falls back to "Open" for unknown status', () => {
        expect(getBillingYearStatusLabel('unknown')).toBe('Open');
    });
});

describe('getBillFrequencyLabel', () => {
    it('returns " / year" for annual', () => {
        expect(getBillFrequencyLabel({ billingFrequency: 'annual' })).toBe(' / year');
    });

    it('returns " / month" for monthly or default', () => {
        expect(getBillFrequencyLabel({ billingFrequency: 'monthly' })).toBe(' / month');
        expect(getBillFrequencyLabel({})).toBe(' / month');
    });
});

describe('formatAnnualSummaryCurrency', () => {
    it('formats with $ and two decimals', () => {
        expect(formatAnnualSummaryCurrency(1234.5)).toBe('$1234.50');
    });

    it('handles zero and falsy values', () => {
        expect(formatAnnualSummaryCurrency(0)).toBe('$0.00');
        expect(formatAnnualSummaryCurrency(null)).toBe('$0.00');
    });
});

describe('formatFileSize', () => {
    it('formats bytes', () => {
        expect(formatFileSize(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
        expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
        expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
    });
});

describe('escapeHtml', () => {
    it('escapes all dangerous characters', () => {
        expect(escapeHtml('<script>"alert&\'</script>')).toBe(
            '&lt;script&gt;&quot;alert&amp;&#039;&lt;/script&gt;'
        );
    });

    it('returns empty string for falsy input', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml('')).toBe('');
    });
});

describe('sanitizeImageSrc', () => {
    it('allows valid data URIs', () => {
        const src = 'data:image/png;base64,iVBORw0KGgo=';
        expect(sanitizeImageSrc(src)).toBe(src);
    });

    it('rejects non-data URIs', () => {
        expect(sanitizeImageSrc('https://evil.com/img.png')).toBe('');
        expect(sanitizeImageSrc('javascript:alert(1)')).toBe('');
    });

    it('returns empty string for falsy input', () => {
        expect(sanitizeImageSrc(null)).toBe('');
    });
});

describe('getInitials', () => {
    it('returns first letters of each word, max 2', () => {
        expect(getInitials('John Doe')).toBe('JD');
        expect(getInitials('Alice Bob Charlie')).toBe('AB');
    });

    it('handles single name', () => {
        expect(getInitials('Alice')).toBe('A');
    });
});

describe('getPaymentMethodDetail', () => {
    it('joins available fields with middle dot', () => {
        expect(getPaymentMethodDetail({ email: 'a@b.com', handle: '@user' })).toBe('a@b.com · @user');
    });

    it('returns empty string when no fields', () => {
        expect(getPaymentMethodDetail({})).toBe('');
    });
});

describe('disputeStatusClass', () => {
    it('converts status to CSS class', () => {
        expect(disputeStatusClass('in_review')).toBe('dispute-in-review');
        expect(disputeStatusClass('open')).toBe('dispute-open');
    });
});
