import { beforeEach, describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({ held: false, calls: [] }));
vi.mock('@/lib/calculations.js', async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, getHouseholdFinancials: (...args) => {
        control.calls.push(args);
        return control.held && !args[2]?.reopenedAdjustmentIds?.has('refund') ? { ok: false, householdId: args[0].id,
            holds: [{ component: 'R', recordId: 'private-record', field: 'amount' }],
            rows: { secret: 'must not escape' }, owed: 999 } : actual.getHouseholdFinancials(...args);
    } };
});
vi.mock('@/lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(), collection: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
    setDoc: vi.fn(), writeBatch: vi.fn(), serverTimestamp: vi.fn()
}));

import { getHouseholdFinancialAvailability, getYearFinancialAvailability } from '@/lib/financial-availability.js';
import { BillingYearService } from '@/lib/BillingYearService.js';
import { setDoc, writeBatch } from 'firebase/firestore';

const source = {
    familyMembers: [{ id: 1, linkedMembers: [2] }, { id: 2, linkedMembers: [] }],
    bills: [{ id: 'bill', amount: 100, billingFrequency: 'annual', members: [1, 2] }],
    payments: [], creditAdjustments: [], owedAdjustments: []
};

beforeEach(() => { control.held = false; control.calls = []; vi.clearAllMocks(); });

describe('private financial availability bridge', () => {
    it('recognizes only an explicit hold and strips money and private evidence', () => {
        expect(getHouseholdFinancialAvailability(source, 2)).toEqual({ householdId: 1, available: true, holdCount: 0 });
        control.held = true;
        expect(getHouseholdFinancialAvailability(source, 2)).toEqual({ householdId: 1, available: false, holdCount: 1 });
        expect(getYearFinancialAvailability(source)).toEqual({ available: false, yearHoldCount: 0, households: [{ householdId: 1, available: false, holdCount: 1 }], needsCorrectionCount: 1 });
    });

    it('preserves the caller reopening context and defaults to null', () => {
        const reopenedAdjustmentIds = new Set(['refund']);
        control.held = true;
        expect(getYearFinancialAvailability(source, { reopenedAdjustmentIds }).needsCorrectionCount).toBe(0);
        expect(control.calls.at(-1)[2]?.reopenedAdjustmentIds ?? null).toBe(reopenedAdjustmentIds);
        expect(getHouseholdFinancialAvailability(source, 2).available).toBe(false);
        expect(control.calls.at(-1)[2]?.reopenedAdjustmentIds ?? null).toBeNull();
    });

    it.each(['close', 'rollover'])('refuses %s before state, queue or persistence side effects', async operation => {
        const service = new BillingYearService();
        service._user = { uid: 'test-user' };
        service._state = { ...service._state, ...structuredClone(source),
            activeYear: { id: '2026', label: '2026', status: 'settling' } };
        const before = structuredClone(service.getState());
        const enqueue = vi.spyOn(service._saveQueue, 'enqueue');
        control.held = true;
        const action = operation === 'close' ? service.setYearStatus('closed') : service.createYear('2027');
        await expect(action).rejects.toThrow('Financial data unavailable. Correct the affected record before settling this household.');
        expect(service.getState()).toEqual(before);
        expect(service._yearOpPending).toBe(0);
        expect(enqueue).not.toHaveBeenCalled();
        expect(setDoc).not.toHaveBeenCalled();
        expect(writeBatch).not.toHaveBeenCalled();
        expect(control.calls.at(-1)[2]?.reopenedAdjustmentIds ?? null).toBeNull();
    });
});


describe('activated service integrity refusal', () => {
    it.each(['close', 'rollover'])('refuses %s with real malformed source and aggregate overflow before effects', async operation => {
        for (const overflow of [false, true]) {
            const service = new BillingYearService();
            service._user = { uid: 'test-user' };
            const raw = overflow ? { ...source, familyMembers: [{ id: 1, linkedMembers: [] }, { id: 2, linkedMembers: [] }], bills: [],
                payments: [{ id: 'a', memberId: 1, amount: 60000000000000 }, { id: 'b', memberId: 2, amount: 60000000000000 }] }
                : { ...source, payments: [{ id: 'bad', memberId: 1, amount: '100' }] };
            service._state = { ...service._state, ...structuredClone(raw), activeYear: { id: '2026', label: '2026', status: 'settling' } };
            const before = structuredClone(service.getState());
            const enqueue = vi.spyOn(service._saveQueue, 'enqueue');
            await expect(operation === 'close' ? service.setYearStatus('closed') : service.createYear('2027')).rejects.toThrow('Financial data unavailable');
            expect(service.getState()).toEqual(before);
            expect(enqueue).not.toHaveBeenCalled();
            expect(setDoc).not.toHaveBeenCalled();
            expect(writeBatch).not.toHaveBeenCalled();
        }
    });
});
