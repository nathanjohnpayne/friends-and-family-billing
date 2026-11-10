import { describe, it, expect } from 'vitest';
import {
    summarizeUnsavedChanges, formatUnsavedDetails, persistUnsavedRecord, readUnsavedRecords,
    clearUnsavedRecord, unsavedStorageKey
} from '@/lib/unsaved-changes.js';

// The unsaved list of the Reload required state (#669, RD-34).

const baseline = () => ({
    label: '2026', status: 'open',
    familyMembers: [
        { id: 1, name: 'Ada Okafor', phone: '', email: '' },
        { id: 2, name: 'Kenji Nakamura', phone: '', email: '' }
    ],
    bills: [{ id: 'mm', name: 'Meridian Music', amount: 12, members: [1, 2] }],
    payments: [{ id: 'p0', memberId: 1, amount: 20 }],
    creditAdjustments: [], owedAdjustments: [],
    billingEvents: [{ id: 'e0', eventType: 'PAYMENT_RECORDED', payload: { paymentId: 'p0', memberId: 1, amount: 20 } }],
    settings: { emailMessage: 'Hi', paymentMethods: [] }
});

describe('summarizeUnsavedChanges', () => {
    it('lists events appended since the baseline and edits that emit no event (the RD-34 sample)', () => {
        const unsaved = baseline();
        unsaved.payments.push({ id: 'p1', memberId: 1, amount: 50, method: 'venmo' });
        unsaved.owedAdjustments.push({ id: 'sc1', memberId: 1, kind: 'service_credit', amount: 4 });
        unsaved.billingEvents.push(
            { id: 'e1', eventType: 'PAYMENT_RECORDED', timestamp: '2026-11-10T15:10:00Z', payload: { paymentId: 'p1', memberId: 1, memberName: 'Ada Okafor', amount: 50, method: 'venmo' } },
            { id: 'e2', eventType: 'SERVICE_CREDIT_RECORDED', timestamp: '2026-11-10T15:11:00Z', payload: { billId: 'mm', billName: 'Meridian Music', amount: 12, reason: 'Outage, March', recordIds: ['sc1'] } }
        );
        unsaved.familyMembers[1] = { ...unsaved.familyMembers[1], phone: '+14155551212' };
        const changes = summarizeUnsavedChanges(baseline(), unsaved);
        expect(changes).toEqual([
            { kind: 'event', label: 'Payment recorded', detail: 'Ada Okafor', amount: 50, at: '2026-11-10T15:10:00Z' },
            { kind: 'event', label: 'Service credit recorded', detail: 'Meridian Music · “Outage, March”', amount: 12, at: '2026-11-10T15:11:00Z' },
            { kind: 'member', label: 'Member edited', detail: 'Kenji Nakamura · phone number', amount: null, at: null }
        ]);
    });

    it('never lists what the baseline already holds', () => {
        expect(summarizeUnsavedChanges(baseline(), baseline())).toEqual([]);
    });

    it('lists members added and removed, bill edits, settings and an unrecorded status change', () => {
        const unsaved = baseline();
        unsaved.familyMembers = [unsaved.familyMembers[0], { id: 3, name: 'Priya Natarajan' }];
        unsaved.bills[0] = { ...unsaved.bills[0], amount: 14 };
        unsaved.settings = { emailMessage: 'Hello', paymentMethods: [{ id: 'v' }] };
        unsaved.status = 'settling';
        const labels = summarizeUnsavedChanges(baseline(), unsaved).map(c => c.label + (c.detail ? ': ' + c.detail : ''));
        expect(labels).toEqual([
            'Member added: Priya Natarajan',
            'Member removed: Kenji Nakamura',
            'Bill edited: Meridian Music · price',
            'Invoice template changed',
            'Payment methods changed',
            'Status changed: open → settling'
        ]);
    });

    it('counts ledger rows no event mentions', () => {
        const unsaved = baseline();
        unsaved.payments[0] = { ...unsaved.payments[0], note: 'fixed' };
        expect(summarizeUnsavedChanges(baseline(), unsaved)).toEqual([
            { kind: 'ledger', label: 'Payments changed', detail: '1 changed', amount: null, at: null }
        ]);
    });

    it('treats a missing baseline as empty', () => {
        const labels = summarizeUnsavedChanges(null, baseline()).map(c => c.label);
        expect(labels).toContain('Member added');
        expect(labels).toContain('Payment recorded');
    });
});

describe('the on-device record', () => {
    const record = { version: 1, uid: 'u1', yearId: '2026', yearLabel: '2026', reason: 'stale', detectedAt: '2026-11-10T15:12:00Z', baselineAt: '2026-11-10T15:09:00Z', baselineKind: 'saved', changes: [{ kind: 'member', label: 'Member added', detail: 'Bea', amount: null, at: null }], payload: { label: '2026' } };
    const memoryStorage = () => {
        const map = new Map();
        return {
            get length() { return map.size; },
            key: i => [...map.keys()][i] ?? null,
            getItem: k => (map.has(k) ? map.get(k) : null),
            setItem: (k, v) => map.set(k, String(v)),
            removeItem: k => map.delete(k)
        };
    };

    it('is kept under ffb.unsaved.v1.<uid>.<yearId>, read back, and removed on dismiss', () => {
        const storage = memoryStorage();
        expect(persistUnsavedRecord(record, storage)).toEqual({ kept: true });
        expect(storage.getItem(unsavedStorageKey('u1', '2026'))).not.toBeNull();
        expect(unsavedStorageKey('u1', '2026')).toBe('ffb.unsaved.v1.u1.2026');
        expect(readUnsavedRecords('u1', storage)).toEqual([record]);
        expect(readUnsavedRecords('u2', storage)).toEqual([]);
        clearUnsavedRecord('u1', '2026', storage);
        expect(readUnsavedRecords('u1', storage)).toEqual([]);
    });

    it('reports unavailable and quota-exceeded storage instead of throwing', () => {
        expect(persistUnsavedRecord(record, null)).toEqual({ kept: false, error: 'Storage is unavailable on this device.' });
        const blocked = { setItem: () => { throw new Error('SecurityError'); } };
        expect(persistUnsavedRecord(record, blocked)).toEqual({ kept: false, error: 'SecurityError' });
        const full = { setItem: () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); } };
        expect(persistUnsavedRecord(record, full)).toEqual({ kept: false, error: 'This device is out of storage space.' });
        const throwing = { get length() { throw new Error('denied'); } };
        expect(readUnsavedRecords('u1', throwing)).toEqual([]);
        expect(() => clearUnsavedRecord('u1', '2026', { removeItem: () => { throw new Error('denied'); } })).not.toThrow();
    });

    it('skips corrupt entries', () => {
        const storage = memoryStorage();
        storage.setItem('ffb.unsaved.v1.u1.2025', '{not json');
        persistUnsavedRecord(record, storage);
        expect(readUnsavedRecords('u1', storage)).toEqual([record]);
    });

    it('formats Copy details as the summary followed by the full payload JSON', () => {
        const text = formatUnsavedDetails(record);
        expect(text).toContain('Unsaved changes — billing year 2026');
        expect(text).toContain('- Member added: Bea');
        expect(text).toContain('Unsaved data (JSON):\n{\n  "label": "2026"\n}');
    });
});
