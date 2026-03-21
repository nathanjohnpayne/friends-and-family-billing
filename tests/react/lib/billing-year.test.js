import { describe, it, expect } from 'vitest';
import {
    calculateOutstandingBalance,
    buildCloseYearMessage,
    suggestNextYearLabel,
    isYearLabelDuplicate,
    buildNewYearData
} from '@/lib/billing-year.js';

describe('calculateOutstandingBalance', () => {
    const members = [
        { id: 1, name: 'Alice', linkedMembers: [] },
        { id: 2, name: 'Bob', linkedMembers: [] }
    ];
    const bills = [{ id: 'b1', amount: 100, billingFrequency: 'monthly', members: [1, 2] }];

    it('returns outstanding balance across all households', () => {
        const payments = [{ memberId: 1, amount: 300 }];
        const balance = calculateOutstandingBalance(members, bills, payments);
        // Alice owes 600, paid 300 → 300 outstanding
        // Bob owes 600, paid 0 → 600 outstanding
        expect(balance).toBe(900);
    });

    it('returns 0 when everyone is paid up', () => {
        const payments = [
            { memberId: 1, amount: 600 },
            { memberId: 2, amount: 600 }
        ];
        expect(calculateOutstandingBalance(members, bills, payments)).toBe(0);
    });
});

describe('buildCloseYearMessage', () => {
    it('includes outstanding amount when > 0', () => {
        const msg = buildCloseYearMessage('2026', 150);
        expect(msg).toContain('$150.00');
        expect(msg).toContain('still outstanding');
    });

    it('omits outstanding warning when 0', () => {
        const msg = buildCloseYearMessage('2026', 0);
        expect(msg).not.toContain('outstanding');
        expect(msg).toContain('Close billing year 2026');
    });
});

describe('suggestNextYearLabel', () => {
    it('increments the current year label', () => {
        expect(suggestNextYearLabel({ label: '2025' })).toBe('2026');
    });

    it('uses current calendar year when label is not a number', () => {
        const result = suggestNextYearLabel({ label: 'Q1' });
        expect(Number(result)).toBe(new Date().getFullYear());
    });

    it('uses current calendar year when null', () => {
        expect(Number(suggestNextYearLabel(null))).toBe(new Date().getFullYear());
    });
});

describe('isYearLabelDuplicate', () => {
    const years = [{ id: '2025' }, { id: '2026' }];

    it('returns true for existing label', () => {
        expect(isYearLabelDuplicate(years, '2025')).toBe(true);
    });

    it('returns false for new label', () => {
        expect(isYearLabelDuplicate(years, '2027')).toBe(false);
    });

    it('trims whitespace', () => {
        expect(isYearLabelDuplicate(years, ' 2025 ')).toBe(true);
    });
});

describe('buildNewYearData', () => {
    const members = [
        { id: 1, name: 'Alice', email: 'a@b.com', phone: '+1234', avatar: '', paymentReceived: 500, linkedMembers: [2] },
        { id: 2, name: 'Bob', email: 'b@c.com', phone: '', avatar: '', paymentReceived: 300, linkedMembers: [] }
    ];
    const bills = [
        { id: 'b1', name: 'Internet', amount: 100, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2] }
    ];
    const settings = {
        emailMessage: 'Hello',
        paymentLinks: [{ label: 'Venmo', url: 'http://venmo.com' }],
        paymentMethods: [{ type: 'venmo', enabled: true }]
    };

    it('resets paymentReceived to 0 for all members', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        data.familyMembers.forEach(m => {
            expect(m.paymentReceived).toBe(0);
        });
    });

    it('preserves bill structure', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        expect(data.bills).toHaveLength(1);
        expect(data.bills[0].name).toBe('Internet');
    });

    it('starts with empty payments and events', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        expect(data.payments).toEqual([]);
        expect(data.billingEvents).toEqual([]);
    });

    it('sets status to open', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        expect(data.status).toBe('open');
    });

    it('deep clones linked members (no reference sharing)', () => {
        const data = buildNewYearData(members, bills, settings, '2027');
        data.familyMembers[0].linkedMembers.push(99);
        expect(members[0].linkedMembers).not.toContain(99);
    });
});
