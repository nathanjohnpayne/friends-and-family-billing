import { describe, it, expect } from 'vitest';
import {
    buildSavePayload,
    normalizeYearData,
    buildInitialYearData,
    computeDocumentFingerprint,
    fingerprintStoredYear,
    FINGERPRINT_EXCLUDED_FIELDS
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

    it('preserves owedAdjustments verbatim (the full-document save must not drop usage charges)', () => {
        const owedAdjustments = [{ id: 'oadj1', memberId: 1, kind: 'usage_charge', amount: 25, status: 'deferred' }];
        const payload = buildSavePayload(year, members, bills, payments, events, settings, [], owedAdjustments);
        expect(payload.owedAdjustments).toBe(owedAdjustments);
    });

    it('defaults owedAdjustments to an empty array when omitted', () => {
        const payload = buildSavePayload(year, members, bills, payments, events, settings);
        expect(payload.owedAdjustments).toEqual([]);
    });

    it('threads closedAt from the year (the full save must not drop it)', () => {
        const closedYear = { label: '2026', status: 'closed', createdAt: 'ts1', archivedAt: null, closedAt: 'ts-closed' };
        const payload = buildSavePayload(closedYear, members, bills, payments, events, settings);
        expect(payload.closedAt).toBe('ts-closed');
    });

    it('defaults closedAt to null when the year has none', () => {
        const payload = buildSavePayload(year, members, bills, payments, events, settings);
        expect(payload.closedAt).toBeNull();
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

    it('loads owedAdjustments from the document', () => {
        const owedAdjustments = [{ id: 'oadj1', memberId: 1, kind: 'usage_charge', amount: 25, status: 'deferred' }];
        const loaded = normalizeYearData({ owedAdjustments }, '2026');
        expect(loaded.owedAdjustments).toEqual(owedAdjustments);
    });

    it('defaults a missing owedAdjustments array to empty', () => {
        const { owedAdjustments } = normalizeYearData({}, '2026');
        expect(owedAdjustments).toEqual([]);
    });

    it('loads closedAt from the document', () => {
        const { year } = normalizeYearData({ closedAt: 'ts-closed' }, '2026');
        expect(year.closedAt).toBe('ts-closed');
    });

    it('defaults a missing closedAt to null', () => {
        const { year } = normalizeYearData({}, '2026');
        expect(year.closedAt).toBeNull();
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

describe('owedAdjustments round-trip', () => {
    it('survives a load → save cycle without being dropped (lossless serialization)', () => {
        // save() uses setDoc without merge, so an omitted field is erased from the
        // document. A doc carrying owedAdjustments (usage charges) must round-trip verbatim.
        const owedAdjustments = [
            { id: 'oadj1', memberId: 1, kind: 'usage_charge', amount: 12.5, status: 'deferred' },
            { id: 'oadj2', memberId: 2, kind: 'usage_charge', amount: 8, status: 'deferred' }
        ];
        const yearDoc = { label: '2026', status: 'open', familyMembers: [], bills: [], payments: [], owedAdjustments };
        const n = normalizeYearData(yearDoc, '2026');
        const payload = buildSavePayload(n.year, n.members, n.bills, n.payments, n.billingEvents, n.settings, n.creditAdjustments, n.owedAdjustments);
        expect(payload.owedAdjustments).toEqual(owedAdjustments);
    });
});

describe('closedAt round-trip (#326 regression)', () => {
    it('a closed year survives a load → save cycle without dropping closedAt', () => {
        // setYearStatus('closed') writes closedAt via a setDoc merge, but save() persists
        // the whole document with setDoc (no merge). Before #326, closedAt was absent from
        // buildSavePayload's allowlist, so the next full save silently erased it. The React
        // SPA is now the sole writer, so the allowlist IS the schema (ADR 0008): every
        // persisted field — including merge-path fields like closedAt — must round-trip.
        const yearDoc = {
            label: '2026', status: 'closed', archivedAt: null, closedAt: 'ts-closed-2026',
            familyMembers: [], bills: [], payments: []
        };
        const n = normalizeYearData(yearDoc, '2026');
        expect(n.year.closedAt).toBe('ts-closed-2026');
        const payload = buildSavePayload(n.year, n.members, n.bills, n.payments, n.billingEvents, n.settings, n.creditAdjustments, n.owedAdjustments);
        expect(payload.closedAt).toBe('ts-closed-2026');
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
        expect(data.owedAdjustments).toEqual([]);
        expect(data.settings).toBe(settings);
    });
});

// ── Versioned year-document writes (#667, #614, ADR 0009 § 3, ADR 0008 amended) ──

describe('rev and lastWriteId', () => {
    const doc = () => ({
        label: '2026', status: 'open', createdAt: 'ts-created', archivedAt: null, closedAt: null,
        rev: 7, lastWriteId: 'w-7',
        familyMembers: [{ id: 1, name: 'Ada', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] }],
        bills: [], payments: [], creditAdjustments: [], owedAdjustments: [], billingEvents: [],
        settings: { emailMessage: 'Hi', paymentLinks: [] }
    });

    it('round-trips rev and lastWriteId through normalizeYearData and buildSavePayload', () => {
        const n = normalizeYearData(doc(), '2026');
        expect(n.year.rev).toBe(7);
        expect(n.year.lastWriteId).toBe('w-7');
        const payload = buildSavePayload(n.year, n.members, n.bills, n.payments, n.billingEvents, n.settings, n.creditAdjustments, n.owedAdjustments);
        expect(payload.rev).toBe(7);
        expect(payload.lastWriteId).toBe('w-7');
    });

    it('normalizes a document without rev to rev: undefined (never zero) and omits it from the payload', () => {
        const raw = doc();
        delete raw.rev;
        delete raw.lastWriteId;
        const n = normalizeYearData(raw, '2026');
        expect(n.year.rev).toBeUndefined();
        expect(n.year.lastWriteId).toBeUndefined();
        const payload = buildSavePayload(n.year, n.members, n.bills, n.payments, n.billingEvents, n.settings);
        expect('rev' in payload).toBe(false);
        expect('lastWriteId' in payload).toBe(false);
    });

    it('starts a new year at rev 1', () => {
        expect(buildInitialYearData('2026', {}).rev).toBe(1);
    });
});

describe('computeDocumentFingerprint', () => {
    const base = () => ({
        label: '2026', status: 'open', createdAt: 'ts-created', updatedAt: 'ts-updated', archivedAt: null,
        closedAt: { toDate: () => new Date('2026-12-31T12:00:00.000Z') },
        rev: 3, lastWriteId: 'w-3',
        familyMembers: [{ id: 1, name: 'Ada', email: 'ada@example.com', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] }],
        bills: [{ id: 'b1', name: 'Internet', amount: 60, billingFrequency: 'monthly', members: [1], logo: '', website: '' }],
        payments: [{ id: 'p1', memberId: 1, amount: 10, type: 'payment' }],
        creditAdjustments: [{ id: 'c1', amount: 5 }],
        owedAdjustments: [{ id: 'o1', amount: 2 }],
        billingEvents: [{ id: 'e1', eventType: 'PAYMENT_RECORDED' }],
        settings: { emailMessage: 'Hi', paymentLinks: [], paymentMethods: [{ id: 'm1', type: 'venmo' }] }
    });
    const fp = raw => computeDocumentFingerprint(normalizeYearData(raw, '2026'));
    const reverseKeys = value => {
        if (Array.isArray(value)) return value.map(reverseKeys);
        if (value && typeof value === 'object' && typeof value.toDate !== 'function') {
            return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reverseKeys(value[key])]));
        }
        return value;
    };

    it('is identical for the same content in any key order', () => {
        expect(fp(reverseKeys(base()))).toBe(fp(base()));
        expect(fingerprintStoredYear(reverseKeys(base()), '2026')).toBe(fingerprintStoredYear(base(), '2026'));
    });

    it('treats a Timestamp and its ISO string as the same value', () => {
        const iso = { ...base(), closedAt: '2026-12-31T12:00:00.000Z' };
        expect(fp(iso)).toBe(fp(base()));
    });

    it('changes when any allowlisted field changes', () => {
        const original = fp(base());
        const mutations = [
            d => { d.label = '2026b'; },
            d => { d.status = 'settling'; },
            d => { d.archivedAt = '2027-01-01T00:00:00.000Z'; },
            d => { d.closedAt = { toDate: () => new Date('2026-12-30T12:00:00.000Z') }; },
            d => { d.familyMembers[0].phone = '+14155551212'; },
            d => { d.bills[0].amount = 61; },
            d => { d.payments.push({ id: 'p2', memberId: 1, amount: 1 }); },
            d => { d.creditAdjustments[0].amount = 6; },
            d => { d.owedAdjustments[0].amount = 3; },
            d => { d.billingEvents.push({ id: 'e2', eventType: 'BILL_CREATED' }); },
            d => { d.settings.emailMessage = 'Hello'; }
        ];
        for (const mutate of mutations) {
            const changed = base();
            mutate(changed);
            expect(fp(changed)).not.toBe(original);
        }
    });

    it('ignores createdAt, updatedAt, lastWriteId and rev', () => {
        expect(FINGERPRINT_EXCLUDED_FIELDS).toEqual(['createdAt', 'updatedAt', 'lastWriteId', 'rev']);
        const original = fp(base());
        const changed = { ...base(), createdAt: 'other', updatedAt: '__SERVER_TIMESTAMP__', lastWriteId: 'w-9', rev: 9 };
        expect(fp(changed)).toBe(original);
        const unversioned = base();
        delete unversioned.rev;
        delete unversioned.lastWriteId;
        delete unversioned.createdAt;
        delete unversioned.updatedAt;
        expect(fp(unversioned)).toBe(original);
    });

    it('does not mutate the stored document it fingerprints', () => {
        const raw = { label: '2026', status: 'open', familyMembers: [{ id: 1, name: 'Ada' }], bills: [] };
        const before = structuredClone(raw);
        fingerprintStoredYear(raw, '2026');
        expect(raw).toEqual(before);
    });
});
