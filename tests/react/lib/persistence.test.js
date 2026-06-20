import { describe, it, expect } from 'vitest';
import {
    buildSavePayload,
    normalizeYearData,
    buildInitialYearData
} from '@/lib/persistence.js';

describe('buildSavePayload', () => {
    const year = { label: '2026', status: 'open', createdAt: 'ts1', archivedAt: null };
    const members = [{ id: 1, name: 'Alice' }];
    const bills = [{ id: 'b1', name: 'Internet' }];
    const payments = [{ id: 'p1', amount: 100 }];
    const events = [{ type: 'BILL_CREATED' }];
    const settings = { emailMessage: 'Hi' };

    it('includes all top-level fields', () => {
        const payload = buildSavePayload(year, members, bills, payments, events, settings);
        expect(payload.label).toBe('2026');
        expect(payload.status).toBe('open');
        expect(payload.familyMembers).toBe(members);
        expect(payload.bills).toBe(bills);
        expect(payload.payments).toBe(payments);
        expect(payload.billingEvents).toBe(events);
    });

    it('strips qrCode from payment methods and sets hasQrCode flag', () => {
        const settingsWithQr = {
            emailMessage: 'Hi',
            paymentMethods: [
                { type: 'venmo', qrCode: 'data:image/png;base64,abc' },
                { type: 'zelle' }
            ]
        };
        const payload = buildSavePayload(year, members, bills, payments, events, settingsWithQr);
        expect(payload.settings.paymentMethods[0].hasQrCode).toBe(true);
        expect(payload.settings.paymentMethods[0].qrCode).toBeUndefined();
        expect(payload.settings.paymentMethods[1].hasQrCode).toBeUndefined();
    });

    it('preserves original settings object (no mutation)', () => {
        const settingsWithQr = {
            emailMessage: 'Hi',
            paymentMethods: [{ type: 'venmo', qrCode: 'data:abc' }]
        };
        buildSavePayload(year, members, bills, payments, events, settingsWithQr);
        expect(settingsWithQr.paymentMethods[0].qrCode).toBe('data:abc');
    });

    it('preserves creditAdjustments verbatim (the full-document save must not drop them)', () => {
        const creditAdjustments = [{ id: 'cadj1', memberId: 1, type: 'refund', amount: 50, status: 'recorded' }];
        const payload = buildSavePayload(year, members, bills, payments, events, settings, creditAdjustments);
        expect(payload.creditAdjustments).toBe(creditAdjustments);
    });

    it('defaults creditAdjustments to an empty array when omitted', () => {
        const payload = buildSavePayload(year, members, bills, payments, events, settings);
        expect(payload.creditAdjustments).toEqual([]);
    });
});

describe('normalizeYearData', () => {
    it('applies defaults to members missing fields', () => {
        const data = { familyMembers: [{ id: 1, name: 'Alice' }], bills: [] };
        const { members } = normalizeYearData(data, '2026');
        expect(members[0].email).toBe('');
        expect(members[0].phone).toBe('');
        expect(members[0].avatar).toBe('');
        expect(members[0].paymentReceived).toBe(0);
        expect(members[0].linkedMembers).toEqual([]);
    });

    it('applies defaults to bills missing fields', () => {
        const data = { familyMembers: [], bills: [{ id: 'b1', name: 'Internet', amount: 100 }] };
        const { bills } = normalizeYearData(data, '2026');
        expect(bills[0].logo).toBe('');
        expect(bills[0].website).toBe('');
        expect(bills[0].members).toEqual([]);
        expect(bills[0].billingFrequency).toBe('monthly');
    });

    it('builds year object with fallbacks', () => {
        const { year } = normalizeYearData({}, '2026');
        expect(year.id).toBe('2026');
        expect(year.label).toBe('2026');
        expect(year.status).toBe('open');
        expect(year.archivedAt).toBeNull();
    });

    it('initializes empty arrays for missing payments and events', () => {
        const { payments, billingEvents } = normalizeYearData({}, '2026');
        expect(payments).toEqual([]);
        expect(billingEvents).toEqual([]);
    });

    it('loads creditAdjustments from the document', () => {
        const creditAdjustments = [{ id: 'cadj1', memberId: 1, type: 'refund', amount: 50, status: 'recorded' }];
        const loaded = normalizeYearData({ creditAdjustments }, '2026');
        expect(loaded.creditAdjustments).toEqual(creditAdjustments);
    });

    it('defaults a missing creditAdjustments array to empty', () => {
        const { creditAdjustments } = normalizeYearData({}, '2026');
        expect(creditAdjustments).toEqual([]);
    });
});

describe('creditAdjustments round-trip', () => {
    it('survives a load → save cycle without being dropped (lossless serialization)', () => {
        // save() uses setDoc without merge, so an omitted field is erased from the
        // document. A doc carrying creditAdjustments must round-trip verbatim.
        const creditAdjustments = [
            { id: 'cadj1', memberId: 1, type: 'refund', amount: 68.98, status: 'recorded' },
            { id: 'cadj2', memberId: 2, type: 'carry_forward', amount: 20, status: 'recorded' }
        ];
        const yearDoc = { label: '2026', status: 'open', familyMembers: [], bills: [], payments: [], creditAdjustments };
        const n = normalizeYearData(yearDoc, '2026');
        const payload = buildSavePayload(n.year, n.members, n.bills, n.payments, n.billingEvents, n.settings, n.creditAdjustments);
        expect(payload.creditAdjustments).toEqual(creditAdjustments);
    });
});

describe('buildInitialYearData', () => {
    it('creates an empty year with provided settings', () => {
        const settings = { emailMessage: 'Welcome' };
        const data = buildInitialYearData('2026', settings);
        expect(data.label).toBe('2026');
        expect(data.status).toBe('open');
        expect(data.familyMembers).toEqual([]);
        expect(data.bills).toEqual([]);
        expect(data.payments).toEqual([]);
        expect(data.creditAdjustments).toEqual([]);
        expect(data.settings).toBe(settings);
    });
});
