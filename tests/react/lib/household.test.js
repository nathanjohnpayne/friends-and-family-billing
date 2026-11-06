/**
 * Household contact and household name (#528, ADR 0011).
 *
 * Pure planning (src/lib/household.js), the service mutation
 * (BillingYearService.saveHousehold / changeHouseholdContact), the ledger
 * invariants a contact change must preserve, persistence round trips, Start New
 * Year, and the share-document rebuild.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock with query/where/writeBatch, enough for the share rebuild ──
const mockStore = {};

vi.mock('@/lib/firebase.js', () => ({ db: {} }));

vi.mock('firebase/firestore', () => {
    const matches = (data, wheres) => wheres.every(w => w.op === '==' && data[w.field] === w.value);
    return {
        doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
        collection: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
        where: vi.fn((field, op, value) => ({ field, op, value })),
        query: vi.fn((ref, ...wheres) => ({ path: ref.path, wheres })),
        getDoc: vi.fn(async (ref) => {
            const data = mockStore[ref.path];
            return { exists: () => !!data, data: () => data || null };
        }),
        getDocs: vi.fn(async (ref) => {
            const prefix = ref.path + '/';
            const docs = [];
            for (const [key, val] of Object.entries(mockStore)) {
                if (!key.startsWith(prefix) || key.slice(prefix.length).includes('/')) continue;
                if (ref.wheres && !matches(val, ref.wheres)) continue;
                docs.push({ id: key.slice(prefix.length), data: () => val });
            }
            return { docs };
        }),
        setDoc: vi.fn(async (ref, data, options) => {
            mockStore[ref.path] = options?.merge ? { ...(mockStore[ref.path] || {}), ...data } : data;
        }),
        writeBatch: vi.fn(() => {
            const ops = [];
            return {
                set: (ref, data) => ops.push({ path: ref.path, data }),
                update: (ref, data) => ops.push({ path: ref.path, data, merge: true }),
                delete: (ref) => ops.push({ path: ref.path, del: true }),
                commit: async () => {
                    for (const op of ops) {
                        if (op.del) delete mockStore[op.path];
                        else mockStore[op.path] = op.merge ? { ...(mockStore[op.path] || {}), ...op.data } : op.data;
                    }
                }
            };
        }),
        runTransaction: vi.fn(async (_db, fn) => {
            const writes = [];
            const tx = {
                get: async (ref) => {
                    const data = mockStore[ref.path];
                    return { exists: () => !!data, data: () => data || null };
                },
                set: (ref, data) => { writes.push({ path: ref.path, data }); return tx; },
                update: (ref, data) => { writes.push({ path: ref.path, data, merge: true }); return tx; }
            };
            const result = await fn(tx);
            for (const w of writes) mockStore[w.path] = w.merge ? { ...(mockStore[w.path] || {}), ...w.data } : w.data;
            return result;
        }),
        serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__')
    };
});

import {
    planHouseholdEdit, findHouseholdContactId, getHouseholdMemberIds, revertHouseholdFields, isValidHouseholdGraph,
    defaultHouseholdName, getHouseholdName, normalizeHouseholdName, HOUSEHOLD_NAME_MAX_LENGTH
} from '@/lib/household.js';
import { BillingYearService } from '@/lib/BillingYearService.js';
import {
    calculateAnnualSummary, getHouseholdFinancials, getHouseholdOpeningBalance,
    calculateSettlementMetrics, buildCarryForward, isLinkedToAnyone
} from '@/lib/calculations.js';
import { buildSavePayload, normalizeYearData } from '@/lib/persistence.js';
import { buildNewYearData } from '@/lib/billing-year.js';
import { buildPublicShareData } from '@/lib/share.js';

function clearStore() {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
}

const m = (id, name, linkedMembers = [], extra = {}) => ({
    id, name, email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers, ...extra
});

// ── Pure helpers ───────────────────────────────────────────────────────────

describe('household helpers', () => {
    const members = [
        m(1, 'Erik Lindqvist', [2, 3]),
        m(2, 'Anna Lindqvist'),
        m(3, 'Maja Lindqvist'),
        m(4, 'Kwame Osei')
    ];

    it('finds the household contact for a contact, a member and an individual', () => {
        expect(findHouseholdContactId(members, 1)).toBe(1);
        expect(findHouseholdContactId(members, 3)).toBe(1);
        expect(findHouseholdContactId(members, 4)).toBe(4);
        expect(findHouseholdContactId(members, 99)).toBeNull();
    });

    it('lists household member ids contact first', () => {
        expect(getHouseholdMemberIds(members[0])).toEqual([1, 2, 3]);
        expect(getHouseholdMemberIds(members[3])).toEqual([4]);
    });

    it('defaults the name to the shared surname, else the contact surname', () => {
        expect(defaultHouseholdName([members[0], members[1]])).toBe('Lindqvist');
        expect(defaultHouseholdName([members[3], members[0]])).toBe('Osei');
        expect(defaultHouseholdName([m(9, 'Cher')])).toBe('');
        expect(defaultHouseholdName([])).toBe('');
    });

    it('prefers a stored household name over the default', () => {
        expect(getHouseholdName(members[0], members)).toBe('Lindqvist');
        expect(getHouseholdName({ ...members[0], householdName: '  Lake   House ' }, members)).toBe('Lake House');
    });

    it('normalizes names and rejects non-strings', () => {
        expect(normalizeHouseholdName('  a  b ')).toBe('a b');
        expect(normalizeHouseholdName(42)).toBe('');
        expect(normalizeHouseholdName(null)).toBe('');
    });
});

describe('planHouseholdEdit', () => {
    it('promotes a member in a two-member household', () => {
        const members = [m(1, 'Erik', [2]), m(2, 'Anna')];
        const plan = planHouseholdEdit(members, { contactId: 2, memberIds: [1, 2] });
        expect(plan.previousContactId).toBe(1);
        expect(plan.familyMembers.find(x => x.id === 2).linkedMembers).toEqual([1]);
        expect(plan.familyMembers.find(x => x.id === 1).linkedMembers).toEqual([]);
        expect(plan.affectedContactIds).toEqual([1, 2]);
    });

    it('promotes a member in a three-member household and keeps everyone', () => {
        const members = [m(1, 'Erik', [2, 3]), m(2, 'Anna'), m(3, 'Maja')];
        const plan = planHouseholdEdit(members, { contactId: 3, memberIds: [1, 2, 3] });
        expect(plan.familyMembers.find(x => x.id === 3).linkedMembers).toEqual([1, 2]);
        expect(plan.familyMembers.filter(x => x.id !== 3).every(x => x.linkedMembers.length === 0)).toBe(true);
        expect(plan.released).toEqual([]);
    });

    it('combines individuals into a household with the chosen contact as primary', () => {
        const members = [m(1, 'Erik'), m(2, 'Anna'), m(3, 'Maja')];
        const plan = planHouseholdEdit(members, { contactId: 2, memberIds: [1, 2, 3], householdName: 'Lindqvist' });
        const contact = plan.familyMembers.find(x => x.id === 2);
        expect(contact.linkedMembers).toEqual([1, 3]);
        expect(contact.householdName).toBe('Lindqvist');
        expect(plan.affectedContactIds).toEqual([2]);
    });

    it('releases members left out and adds individuals', () => {
        const members = [m(1, 'Erik', [2, 3]), m(2, 'Anna'), m(3, 'Maja'), m(4, 'Kwame')];
        const plan = planHouseholdEdit(members, { contactId: 1, memberIds: [1, 2, 4] });
        expect(plan.familyMembers.find(x => x.id === 1).linkedMembers).toEqual([2, 4]);
        expect(plan.released).toEqual([3]);
    });

    it('refuses to take a member from another household', () => {
        const members = [m(1, 'Erik', [2]), m(2, 'Anna'), m(3, 'Kwame', [4]), m(4, 'Ama')];
        expect(() => planHouseholdEdit(members, { contactId: 1, memberIds: [1, 2, 4] }))
            .toThrow('Ama is already in Kwame’s household.');
        expect(() => planHouseholdEdit(members, { contactId: 1, memberIds: [1, 2, 3] }))
            .toThrow('Kwame is already in Kwame’s household.');
    });

    it('requires the contact to be one of the members', () => {
        const members = [m(1, 'Erik', [2]), m(2, 'Anna')];
        expect(() => planHouseholdEdit(members, { contactId: 1, memberIds: [2] })).toThrow(/household contact/);
        expect(() => planHouseholdEdit(members, { contactId: 9, memberIds: [9] })).toThrow('Household contact not found.');
        expect(() => planHouseholdEdit(members, { contactId: 1, memberIds: [1, 9] })).toThrow('Household member not found.');
    });

    it('moves the stored name to the new contact and keeps it when not given', () => {
        const members = [m(1, 'Erik', [2], { householdName: 'Lake House' }), m(2, 'Anna')];
        const plan = planHouseholdEdit(members, { contactId: 2, memberIds: [1, 2] });
        expect(plan.familyMembers.find(x => x.id === 2).householdName).toBe('Lake House');
        expect('householdName' in plan.familyMembers.find(x => x.id === 1)).toBe(false);
    });

    it('clears the name with an empty string and on dissolve', () => {
        const members = [m(1, 'Erik', [2], { householdName: 'Lake House' }), m(2, 'Anna')];
        const cleared = planHouseholdEdit(members, { contactId: 1, memberIds: [1, 2], householdName: '' });
        expect('householdName' in cleared.familyMembers.find(x => x.id === 1)).toBe(false);
        const dissolved = planHouseholdEdit(members, { contactId: 1, memberIds: [1] });
        expect(dissolved.familyMembers.find(x => x.id === 1)).toMatchObject({ linkedMembers: [] });
        expect('householdName' in dissolved.familyMembers.find(x => x.id === 1)).toBe(false);
        expect(dissolved.released).toEqual([2]);
    });

    it('rejects an over-long name', () => {
        const members = [m(1, 'Erik', [2]), m(2, 'Anna')];
        expect(() => planHouseholdEdit(members, {
            contactId: 1, memberIds: [1, 2], householdName: 'x'.repeat(HOUSEHOLD_NAME_MAX_LENGTH + 1)
        })).toThrow(/characters or fewer/);
    });

    it('reverts only household fields, and not over a later household edit', () => {
        const previous = [m(1, 'Erik', [2], { householdName: 'Lake' }), m(2, 'Anna'), m(3, 'Kwame')];
        const plan = planHouseholdEdit(previous, { contactId: 2, memberIds: [1, 2] });
        const current = plan.familyMembers.map(x => x.id === 1 ? { ...x, email: 'e@x.com' } : x);
        const restored = revertHouseholdFields(current, plan.familyMembers, previous);
        expect(restored.find(x => x.id === 1)).toMatchObject({ linkedMembers: [2], householdName: 'Lake', email: 'e@x.com' });
        expect(restored.find(x => x.id === 2).linkedMembers).toEqual([]);
        expect(restored.find(x => x.id === 3)).toBe(current.find(x => x.id === 3));
        // Nothing to restore returns null.
        expect(revertHouseholdFields(previous, plan.familyMembers, previous)).toBeNull();
    });

    it('reverts all changed members or none, so a concurrent edit cannot leave a cycle', () => {
        // A links B; the edit promotes B (A=[], B=[A]); another client then adds C
        // to B's household (B=[A, C]). Reverting only A would make A and B link
        // each other, so nothing is reverted and a conflict is reported.
        const previous = [m(1, 'A', [2]), m(2, 'B'), m(3, 'C')];
        const plan = planHouseholdEdit(previous, { contactId: 2, memberIds: [1, 2] });
        const concurrent = plan.familyMembers.map(x => x.id === 2 ? { ...x, linkedMembers: [1, 3] } : x);
        let thrown = null;
        try { revertHouseholdFields(concurrent, plan.familyMembers, previous); } catch (err) { thrown = err; }
        expect(thrown && thrown.code).toBe('household-revert-conflict');
        // A member the edit released, linked into another household meanwhile: the
        // revert would put them in two households, so it is a conflict too.
        const three = [m(1, 'A', [2, 3]), m(2, 'B'), m(3, 'C'), m(4, 'D')];
        const release = planHouseholdEdit(three, { contactId: 1, memberIds: [1, 2] }); // releases C
        const relinked = release.familyMembers.map(x => x.id === 4 ? { ...x, linkedMembers: [3] } : x);
        let conflict = null;
        try { revertHouseholdFields(relinked, release.familyMembers, three); } catch (err) { conflict = err; }
        expect(conflict && conflict.code).toBe('household-revert-conflict');
        expect(isValidHouseholdGraph(three)).toBe(true);
        expect(isValidHouseholdGraph([m(1, 'A', [2]), m(2, 'B', [1])])).toBe(false);
        expect(isValidHouseholdGraph([m(1, 'A', [3]), m(2, 'B', [3]), m(3, 'C')])).toBe(false);
        // A problem already in the data (a duplicate link) does not block the revert.
        const dirty = [m(1, 'A', [2]), m(2, 'B'), m(3, 'C'), m(4, 'D', [5, 5]), m(5, 'E')];
        const dirtyPlan = planHouseholdEdit(dirty, { contactId: 2, memberIds: [1, 2] });
        const dirtyRestored = revertHouseholdFields(dirtyPlan.familyMembers, dirtyPlan.familyMembers, dirty);
        expect(dirtyRestored.find(x => x.id === 1).linkedMembers).toEqual([2]);
        expect(dirtyRestored.find(x => x.id === 2).linkedMembers).toEqual([]);
        expect(dirtyRestored.find(x => x.id === 4).linkedMembers).toEqual([5, 5]);
        // A member that already holds its previous fields is fine; the rest revert.
        const partial = plan.familyMembers.map(x => x.id === 1 ? { ...x, linkedMembers: [2] } : x);
        const restored = revertHouseholdFields(partial, plan.familyMembers, previous);
        expect(restored.find(x => x.id === 1).linkedMembers).toEqual([2]);
        expect(restored.find(x => x.id === 2).linkedMembers).toEqual([]);
    });

    it('does not mutate its input', () => {
        const members = [m(1, 'Erik', [2]), m(2, 'Anna')];
        const snapshot = structuredClone(members);
        planHouseholdEdit(members, { contactId: 2, memberIds: [1, 2] });
        expect(members).toEqual(snapshot);
    });
});

// ── Service: ledger invariants ────────────────────────────────────────────

const TEST_USER = { uid: 'user-1' };

/** A household with every kind of ledger row a contact change must leave alone. */
function richState() {
    return {
        activeYear: { id: '2026', label: '2026', status: 'open' },
        billingYears: [{ id: '2026', label: '2026', status: 'open' }],
        familyMembers: [
            m(1, 'Erik Lindqvist', [2, 3], { householdName: 'Lake House' }),
            m(2, 'Anna Lindqvist'),
            m(3, 'Maja Lindqvist'),
            m(4, 'Kwame Osei')
        ],
        bills: [
            { id: 101, name: 'Internet', amount: 120, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2, 3, 4] },
            { id: 102, name: 'Streaming', amount: 20, billingFrequency: 'monthly', logo: '', website: '', members: [2, 3] }
        ],
        payments: [
            { id: 'pay_1', memberId: 1, amount: 300, method: 'venmo', receivedAt: '2026-02-01T00:00:00Z', note: '' },
            { id: 'pay_2', memberId: 3, amount: 900, method: 'zelle', receivedAt: '2026-03-01T00:00:00Z', note: '' },
            { id: 'pay_3', memberId: 2, amount: 50, method: 'cash', receivedAt: '2026-03-02T00:00:00Z', note: '', reversed: true },
            { id: 'pay_3r', memberId: 2, amount: -50, type: 'reversal', reversesPaymentId: 'pay_3', method: 'cash', receivedAt: '2026-03-03T00:00:00Z', note: '' }
        ],
        creditAdjustments: [
            { id: 'cadj_1', memberId: 1, type: 'refund', amount: 25, method: 'venmo', reason: 'over', status: 'recorded', createdAt: '2026-04-01T00:00:00Z' }
        ],
        owedAdjustments: [
            { id: 'coadj_2025_1', memberId: 1, kind: 'carry_opening', amount: -12.34, status: 'carried_in', fromYear: '2025', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'oadj_sc', memberId: 2, kind: 'service_credit', billId: 101, amount: 15, status: 'active', reason: 'outage', incurredDate: '2026-05-01', createdAt: '2026-05-02T00:00:00Z' },
            { id: 'oadj_def', memberId: 3, kind: 'usage_charge', amount: 18, status: 'deferred', description: 'Roaming', incurredDate: '2026-06-01', createdAt: '2026-06-02T00:00:00Z' }
        ],
        billingEvents: [],
        settings: { paymentMethods: [{ id: 'pm1', type: 'venmo', label: 'Venmo', handle: '@x', enabled: true }] }
    };
}

function createService(state = richState()) {
    const svc = new BillingYearService();
    svc._user = TEST_USER;
    svc._setState(state);
    return svc;
}

/** Every household-level figure the app derives, keyed by member-set (order-free). */
function householdFigures(state) {
    const { familyMembers, bills, payments, creditAdjustments, owedAdjustments } = state;
    const summary = calculateAnnualSummary(familyMembers, bills);
    const out = {};
    familyMembers.filter(x => !isLinkedToAnyone(familyMembers, x.id)).forEach(contact => {
        const key = getHouseholdMemberIds(contact).slice().sort().join(',');
        const openingBalance = getHouseholdOpeningBalance(contact, owedAdjustments);
        out[key] = getHouseholdFinancials(contact, summary, payments, creditAdjustments, null, owedAdjustments, openingBalance);
    });
    return out;
}

describe('BillingYearService.saveHousehold — contact change', () => {
    beforeEach(() => clearStore());

    it('preserves every ledger row and the household figures exactly', async () => {
        const svc = createService();
        const before = structuredClone(svc.getState());
        const figuresBefore = householdFigures(before);
        const metricsBefore = calculateSettlementMetrics(before.familyMembers, before.bills, before.payments, before.creditAdjustments, null, before.owedAdjustments);
        const carryBefore = buildCarryForward(before.familyMembers, before.bills, before.payments, before.creditAdjustments, before.owedAdjustments);

        const result = await svc.changeHouseholdContact(3);
        const after = svc.getState();

        expect(result).toMatchObject({ contactId: 3, previousContactId: 1, memberIds: [1, 2, 3], released: [] });
        expect(after.payments).toEqual(before.payments);
        expect(after.creditAdjustments).toEqual(before.creditAdjustments);
        expect(after.owedAdjustments).toEqual(before.owedAdjustments);
        expect(after.bills).toEqual(before.bills);
        expect(householdFigures(after)).toEqual(figuresBefore);
        expect(calculateSettlementMetrics(after.familyMembers, after.bills, after.payments, after.creditAdjustments, null, after.owedAdjustments))
            .toEqual(metricsBefore);
        const carryAfter = buildCarryForward(after.familyMembers, after.bills, after.payments, after.creditAdjustments, after.owedAdjustments);
        const byMembers = c => Object.fromEntries(c.households.map(h => {
            const contact = (h.primaryMemberId === 3 || h.primaryMemberId === 1) ? 'lindqvist' : String(h.primaryMemberId);
            return [contact, h.openingBalance];
        }));
        expect(byMembers(carryAfter)).toEqual(byMembers(carryBefore));
    });

    it('makes the new contact the stored primary and moves the household name', async () => {
        const svc = createService();
        await svc.changeHouseholdContact(2);
        const members = svc.getState().familyMembers;
        expect(members.find(x => x.id === 2)).toMatchObject({ linkedMembers: [1, 3], householdName: 'Lake House' });
        expect(members.find(x => x.id === 1).linkedMembers).toEqual([]);
        expect('householdName' in members.find(x => x.id === 1)).toBe(false);
    });

    it('records a HOUSEHOLD_CONTACT_CHANGED event, and none for an unchanged contact', async () => {
        const svc = createService();
        await svc.changeHouseholdContact(2);
        const events = svc.getState().billingEvents;
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            eventType: 'HOUSEHOLD_CONTACT_CHANGED',
            payload: { previousContactId: 1, contactId: 2, previousContactName: 'Erik Lindqvist', contactName: 'Anna Lindqvist' }
        });
        await svc.saveHousehold({ contactId: 2, memberIds: [1, 2, 3], householdName: 'Renamed' });
        expect(svc.getState().billingEvents).toHaveLength(1);
    });

    it('routes Refunds to the new contact afterwards', async () => {
        const svc = createService();
        // Make the household hold a credit, then change the contact.
        svc._setState({ payments: [...svc.getState().payments, { id: 'pay_big', memberId: 2, amount: 2000, method: 'cash', receivedAt: '2026-07-01T00:00:00Z', note: '' }] });
        await svc.changeHouseholdContact(3);
        expect(() => svc.issueRefund({ memberId: 1, amount: 5, reason: 'r' })).toThrow('Refunds are issued to the household contact.');
        const entry = svc.issueRefund({ memberId: 3, amount: 5, reason: 'r' });
        expect(entry.memberId).toBe(3);
    });

    it('cannot remove the contact from a household without a replacement', () => {
        const svc = createService();
        expect(() => svc.removeMember(1)).toThrow(/Choose a new household contact/);
        expect(svc.getState().familyMembers).toHaveLength(4);
        // A household member (not the contact) can still be removed.
        svc.removeMember(2);
        expect(svc.getState().familyMembers.find(x => x.id === 1).linkedMembers).toEqual([3]);
    });

    it('drops the household name when removing the last other member dissolves it', () => {
        const svc = createService();
        svc.removeMember(2);
        expect(svc.getState().familyMembers.find(x => x.id === 1).householdName).toBe('Lake House');
        svc.removeMember(3);
        const contact = svc.getState().familyMembers.find(x => x.id === 1);
        expect(contact.linkedMembers).toEqual([]);
        expect(contact).not.toHaveProperty('householdName');
    });

    it('rejects a member who is not in a household', async () => {
        const svc = createService();
        await expect(svc.changeHouseholdContact(4)).rejects.toThrow('Kwame Osei is not in a household.');
    });

    it('is blocked on a read-only year', async () => {
        const svc = createService({ ...richState(), activeYear: { id: '2026', label: '2026', status: 'closed' } });
        await expect(async () => svc.saveHousehold({ contactId: 2, memberIds: [1, 2, 3] })).rejects.toThrow();
    });
});

describe('BillingYearService.saveHousehold — forming and editing', () => {
    beforeEach(() => clearStore());

    it('forms a household from individuals with the chosen contact as primary', async () => {
        const svc = createService();
        svc._setState({ familyMembers: [m(1, 'Erik'), m(2, 'Anna'), m(3, 'Maja')] });
        await svc.saveHousehold({ contactId: 3, memberIds: [1, 2, 3], householdName: 'Lindqvist' });
        const contact = svc.getState().familyMembers.find(x => x.id === 3);
        expect(contact).toMatchObject({ linkedMembers: [1, 2], householdName: 'Lindqvist' });
    });

    it('dissolves a household when only the contact is left', async () => {
        const svc = createService();
        const result = await svc.saveHousehold({ contactId: 1, memberIds: [1] });
        expect(result.released).toEqual([2, 3]);
        expect(svc.getState().familyMembers.every(x => x.linkedMembers.length === 0)).toBe(true);
    });
});

// ── Persistence ──────────────────────────────────────────────────────────

describe('household name persistence', () => {
    beforeEach(() => clearStore());

    it('survives a full save/load round trip', async () => {
        const svc = createService();
        await svc.changeHouseholdContact(2);
        const saved = mockStore['users/user-1/billingYears/2026'];
        expect(saved.familyMembers.find(x => x.id === 2).householdName).toBe('Lake House');
        const loaded = normalizeYearData(structuredClone(saved), '2026');
        expect(loaded.members.find(x => x.id === 2)).toMatchObject({ householdName: 'Lake House', linkedMembers: [1, 3] });
    });

    it('round-trips through buildSavePayload and normalizeYearData, dropping invalid names', () => {
        const state = richState();
        state.familyMembers[3] = { ...state.familyMembers[3], householdName: '   ' };
        state.familyMembers[2] = { ...state.familyMembers[2], householdName: 7 };
        const payload = buildSavePayload(state.activeYear, state.familyMembers, state.bills, state.payments,
            state.billingEvents, state.settings, state.creditAdjustments, state.owedAdjustments);
        const loaded = normalizeYearData(structuredClone(payload), '2026');
        expect(loaded.members.find(x => x.id === 1).householdName).toBe('Lake House');
        expect('householdName' in loaded.members.find(x => x.id === 4)).toBe(false);
        expect('householdName' in loaded.members.find(x => x.id === 3)).toBe(false);
    });

    it('drops a non-empty household name stored on a member who is not a contact', () => {
        const state = richState();
        state.familyMembers[1] = { ...state.familyMembers[1], householdName: 'Stray' };   // Anna, a household member
        state.familyMembers[3] = { ...state.familyMembers[3], householdName: 'Alone' };   // Kwame, an individual
        const payload = buildSavePayload(state.activeYear, state.familyMembers, state.bills, state.payments,
            state.billingEvents, state.settings, state.creditAdjustments, state.owedAdjustments);
        const loaded = normalizeYearData(structuredClone(payload), '2026');
        expect(loaded.members.find(x => x.id === 1).householdName).toBe('Lake House');
        expect('householdName' in loaded.members.find(x => x.id === 2)).toBe(false);
        expect('householdName' in loaded.members.find(x => x.id === 4)).toBe(false);
    });

    it('is cloned by Start New Year onto the contact only', () => {
        const state = richState();
        state.familyMembers[3] = { ...state.familyMembers[3], householdName: 'Stray' }; // not a contact
        const next = buildNewYearData(state.familyMembers, state.bills, state.settings, '2027');
        expect(next.familyMembers.find(x => x.id === 1)).toMatchObject({ householdName: 'Lake House', linkedMembers: [2, 3] });
        expect('householdName' in next.familyMembers.find(x => x.id === 4)).toBe(false);
    });
});

// ── Share documents ──────────────────────────────────────────────────────

describe('share documents after a contact change', () => {
    beforeEach(() => clearStore());

    const token = (hash, memberId, extra = {}) => {
        mockStore['shareTokens/' + hash] = {
            ownerId: 'user-1', memberId, billingYearId: '2026', revoked: false,
            scopes: ['summary:read', 'paymentMethods:read', 'payments:read', 'usageCharges:read'],
            expiresAt: '2027-01-01T00:00:00Z', memberName: 'x', ...extra
        };
        mockStore['publicShares/' + hash] = { stale: true, memberId };
    };

    it('rebuilds the old and new contact docs to match a fresh build', async () => {
        token('h-erik', 1);
        token('h-anna', 2);
        token('h-maja', 3);
        token('h-kwame', 4);
        token('h-erik-revoked', 1, { revoked: true });

        const svc = createService();
        const result = await svc.changeHouseholdContact(2);
        expect(result.shareDocsRebuilt).toBe(2);

        const s = svc.getState();
        for (const [hash, memberId] of [['h-erik', 1], ['h-anna', 2]]) {
            const tokenDoc = mockStore['shareTokens/' + hash];
            const fresh = buildPublicShareData(s.familyMembers, s.bills, s.payments, memberId, tokenDoc.scopes,
                'user-1', s.activeYear, s.settings, s.owedAdjustments);
            expect(mockStore['publicShares/' + hash]).toEqual({
                ...fresh, expiresAt: tokenDoc.expiresAt, revoked: false, updatedAt: '__SERVER_TIMESTAMP__'
            });
        }
        // The new contact's link now shows the household; the old contact's shows only them.
        expect(mockStore['publicShares/h-anna'].linkedMembers.map(x => x.memberId)).toEqual([1, 3]);
        expect(mockStore['publicShares/h-erik'].linkedMembers).toEqual([]);
        // Other members' and revoked links are untouched.
        expect(mockStore['publicShares/h-maja']).toEqual({ stale: true, memberId: 3 });
        expect(mockStore['publicShares/h-kwame']).toEqual({ stale: true, memberId: 4 });
        expect(mockStore['publicShares/h-erik-revoked']).toEqual({ stale: true, memberId: 1 });
        // Tokens stay keyed to the member they were minted for.
        expect(mockStore['shareTokens/h-erik'].memberId).toBe(1);
        expect(mockStore['shareTokens/h-anna'].memberId).toBe(2);
    });

    it('keeps the links view metrics and drops stale billing fields', async () => {
        token('h-anna', 2);
        mockStore['publicShares/h-anna'] = {
            memberId: 2, accessCount: 7, lastAccessedAt: '2026-10-01T00:00:00Z', serviceCredits: { total: 99, items: [] }
        };
        const svc = createService();
        svc._setState({ owedAdjustments: [] }); // no Service Credit any more
        await svc.changeHouseholdContact(2);
        const cached = mockStore['publicShares/h-anna'];
        expect(cached.accessCount).toBe(7);
        expect(cached.lastAccessedAt).toBe('2026-10-01T00:00:00Z');
        expect('serviceCredits' in cached).toBe(false);
    });

    it('never recreates the cache of a link revoked while the rebuild runs', async () => {
        token('h-erik', 1);
        token('h-anna', 2);
        const { getDocs } = await import('firebase/firestore');
        const original = getDocs.getMockImplementation();
        let calls = 0;
        getDocs.mockImplementation(async (ref) => {
            const result = await original(ref);
            // After the candidate queries, another tab revokes Anna's link (token
            // first, then the cache), as ShareLinkDialog.handleRevoke does.
            if (ref.path === 'shareTokens' && ++calls === 2) {
                mockStore['shareTokens/h-anna'] = { ...mockStore['shareTokens/h-anna'], revoked: true };
                delete mockStore['publicShares/h-anna'];
            }
            return result;
        });
        try {
            const svc = createService();
            const result = await svc.changeHouseholdContact(2);
            expect(result.shareDocsRebuilt).toBe(1);
            expect(mockStore['publicShares/h-anna']).toBeUndefined();
            expect(mockStore['publicShares/h-erik'].revoked).toBe(false);
        } finally {
            getDocs.mockImplementation(original);
        }
    });

    it('does not rebuild share docs, and rolls back, when the household save fails', async () => {
        token('h-erik', 1);
        token('h-anna', 2);
        const { setDoc } = await import('firebase/firestore');
        setDoc.mockRejectedValueOnce(new Error('permission-denied'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = createService();
        const before = structuredClone(svc.getState().familyMembers);
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow('The household change could not be saved: permission-denied');
        expect(svc.getState().familyMembers).toEqual(before);
        expect(svc.getState().billingEvents).toEqual([]);
        expect(mockStore['publicShares/h-erik']).toEqual({ stale: true, memberId: 1 });
        expect(mockStore['publicShares/h-anna']).toEqual({ stale: true, memberId: 2 });
        errSpy.mockRestore();
    });

    it('compensates a queued write when the year is reloaded as closed while the household save is pending', async () => {
        const { setDoc } = await import('firebase/firestore');
        const original = setDoc.getMockImplementation();
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = createService();
        const members = structuredClone(svc.getState().familyMembers);
        const path = 'users/user-1/billingYears/2026';
        setDoc
            .mockImplementationOnce(async () => {
                // A payment is queued behind the household write (holding the optimistic
                // household); then the year is reloaded as closed (without the unsaved
                // change); then the write fails.
                svc.recordPayment({ memberId: 4, amount: 10, method: 'cash' });
                svc._setState({ activeYear: { id: '2026', label: '2026', status: 'closed' }, familyMembers: structuredClone(members), billingEvents: [] });
                throw new Error('unavailable');
            })
            .mockImplementationOnce(async (ref, data, options) => {
                // The queued payment save lands; then another client closes the year,
                // before the compensation runs.
                await original(ref, data, options);
                const stored = mockStore[path];
                mockStore[path] = {
                    ...stored,
                    status: 'closed',
                    billingEvents: [...stored.billingEvents, { id: 'evt_close', eventType: 'YEAR_STATUS_CHANGED', payload: { newStatus: 'closed' } }]
                };
            });
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow(/could not be saved/);
        await svc._saveQueue._chain;
        const persisted = mockStore[path];
        expect(persisted.familyMembers.find(x => x.id === 1)).toMatchObject({ linkedMembers: [2, 3], householdName: 'Lake House' });
        expect(persisted.familyMembers.find(x => x.id === 2).linkedMembers).toEqual([]);
        expect(persisted.payments.some(p => p.memberId === 4 && p.amount === 10)).toBe(true);
        // Only the household fields and this edit's event were reverted: the other
        // client's close and its event survive.
        expect(persisted.status).toBe('closed');
        expect(persisted.billingEvents.map(e => e.eventType)).toEqual(['PAYMENT_RECORDED', 'YEAR_STATUS_CHANGED']);
        errSpy.mockRestore();
    });

    it('keeps a queued payment when the open year is reloaded before it lands and the household save then fails', async () => {
        const { setDoc } = await import('firebase/firestore');
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = createService();
        const loaded = structuredClone({ familyMembers: svc.getState().familyMembers, payments: svc.getState().payments });
        setDoc.mockImplementationOnce(async () => {
            // A payment is queued behind the household write; the (still open) year is
            // reloaded before that payment write lands, so local state has neither the
            // household change nor the payment; then the household write fails.
            svc.recordPayment({ memberId: 4, amount: 10, method: 'cash' });
            svc._setState({ familyMembers: structuredClone(loaded.familyMembers), payments: structuredClone(loaded.payments), billingEvents: [] });
            throw new Error('unavailable');
        });
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow(/could not be saved/);
        await svc._saveQueue._chain;
        const persisted = mockStore['users/user-1/billingYears/2026'];
        // The payment the queued write persisted survives; only the household reverts.
        expect(persisted.payments.some(p => p.memberId === 4 && p.amount === 10)).toBe(true);
        expect(persisted.familyMembers.find(x => x.id === 1).linkedMembers).toEqual([2, 3]);
        expect(persisted.billingEvents.map(e => e.eventType)).toEqual(['PAYMENT_RECORDED']);
        errSpy.mockRestore();
    });

    it('reports when the compensating write after a failed household save also fails', async () => {
        const { setDoc, runTransaction } = await import('firebase/firestore');
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = createService();
        setDoc.mockImplementationOnce(async () => {
            // A payment is queued behind the failing write, so the stored year needs compensating.
            svc.recordPayment({ memberId: 4, amount: 10, method: 'cash' });
            throw new Error('unavailable');
        });
        runTransaction.mockRejectedValueOnce(new Error('offline'));
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow(
            'The household change could not be saved: unavailable. Restoring the saved household also failed (offline); reload before making further changes.');
        expect(svc.getState().familyMembers.find(x => x.id === 1).linkedMembers).toEqual([2, 3]);
        errSpy.mockRestore();
    });

    it('keeps a payment recorded while a failed household save was pending', async () => {
        const { setDoc } = await import('firebase/firestore');
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = createService();
        setDoc.mockImplementationOnce(async () => {
            // A payment lands while the household write is in flight; the write then fails.
            svc.recordPayment({ memberId: 4, amount: 10, method: 'cash' });
            throw new Error('unavailable');
        });
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow(/could not be saved/);
        const state = svc.getState();
        expect(state.familyMembers.find(x => x.id === 1).linkedMembers).toEqual([2, 3]);
        expect(state.billingEvents.map(e => e.eventType)).toEqual(['PAYMENT_RECORDED']);
        expect(state.payments.some(p => p.memberId === 4 && p.amount === 10)).toBe(true);
        // The payment's queued write held the rolled-back household; the compensating
        // write that follows it persists the rolled-back household with the payment.
        await svc._saveQueue._chain;
        const persisted = mockStore['users/user-1/billingYears/2026'];
        expect(persisted.familyMembers.find(x => x.id === 1).linkedMembers).toEqual([2, 3]);
        expect(persisted.familyMembers.find(x => x.id === 2).linkedMembers).toEqual([]);
        expect(persisted.billingEvents.map(e => e.eventType)).toEqual(['PAYMENT_RECORDED']);
        expect(persisted.payments.some(p => p.memberId === 4 && p.amount === 10)).toBe(true);
        errSpy.mockRestore();
    });

    it('rolls back the household but keeps a member edit made while the save was pending', async () => {
        const { setDoc } = await import('firebase/firestore');
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = createService();
        setDoc.mockImplementationOnce(async () => {
            svc.updateMember(3, { name: 'Maja L.' });
            throw new Error('unavailable');
        });
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow(/could not be saved/);
        await svc._saveQueue._chain;
        for (const members of [svc.getState().familyMembers, mockStore['users/user-1/billingYears/2026'].familyMembers]) {
            expect(members.find(x => x.id === 1)).toMatchObject({ linkedMembers: [2, 3], householdName: 'Lake House' });
            expect(members.find(x => x.id === 2).linkedMembers).toEqual([]);
            expect('householdName' in members.find(x => x.id === 2)).toBe(false);
            expect(members.find(x => x.id === 3).name).toBe('Maja L.');
        }
        expect(mockStore['users/user-1/billingYears/2026'].billingEvents).toEqual([]);
        errSpy.mockRestore();
    });

    it('leaves another year alone when the year is switched and the save then fails', async () => {
        const { setDoc } = await import('firebase/firestore');
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = createService();
        const other = [m(1, 'Erik Lindqvist'), m(2, 'Anna Lindqvist', [1, 3], { householdName: 'Lake House' }), m(3, 'Maja Lindqvist')];
        setDoc.mockImplementationOnce(async () => {
            svc._setState({ activeYear: { id: '2027', label: '2027', status: 'open' }, familyMembers: other, billingEvents: [] });
            throw new Error('unavailable');
        });
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow(/could not be saved/);
        await svc._saveQueue._chain;
        expect(svc.getState().familyMembers).toBe(other);
        expect(mockStore['users/user-1/billingYears/2027']).toBeUndefined();
        errSpy.mockRestore();
    });

    it('refuses a household change while a status change or Start New Year is running', async () => {
        const { setDoc, writeBatch } = await import('firebase/firestore');
        const svc = createService();
        const before = structuredClone(svc.getState().familyMembers);

        // Status change first: its write is held open.
        const originalSet = setDoc.getMockImplementation();
        let releaseStatus;
        const statusHeld = new Promise(resolve => { releaseStatus = resolve; });
        setDoc.mockImplementationOnce(async (ref, data, options) => { await statusHeld; return originalSet(ref, data, options); });
        const status = svc.setYearStatus('settling');
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow('The billing year is being updated.');
        await expect(svc.saveHousehold({ contactId: 2, memberIds: [1, 2, 3] })).rejects.toThrow('The billing year is being updated.');
        releaseStatus();
        await status;
        expect(svc.getState().familyMembers).toEqual(before);
        expect(svc.getState().billingEvents.map(e => e.eventType)).toEqual(['YEAR_STATUS_CHANGED']);
        expect(mockStore['users/user-1/billingYears/2026'].status).toBe('settling');

        // Start New Year next: the rollover batch is held open.
        const originalBatch = writeBatch.getMockImplementation();
        let releaseRollover;
        const rolloverHeld = new Promise(resolve => { releaseRollover = resolve; });
        writeBatch.mockImplementationOnce(() => {
            const batch = originalBatch();
            const commit = batch.commit;
            batch.commit = async () => { await rolloverHeld; return commit(); };
            return batch;
        });
        const rollover = svc.createYear('2027');
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow('The billing year is being updated.');
        expect(() => svc.updateMember(1, { linkedMembers: [2, 3, 4] })).toThrow('The billing year is being updated.');
        expect(() => svc.removeMember(4)).toThrow('The billing year is being updated.');
        releaseRollover();
        await rollover;
        // Both year documents keep the original household.
        expect(mockStore['users/user-1/billingYears/2027'].familyMembers.find(x => x.id === 1).linkedMembers).toEqual([2, 3]);
        expect(svc.getState().familyMembers.find(x => x.id === 1).linkedMembers).toEqual([2, 3]);
        expect((mockStore['users/user-1/billingYears/2026'].billingEvents || []).some(e => e.eventType === 'HOUSEHOLD_CONTACT_CHANGED')).toBe(false);
        // Once the year operation has settled, household changes are accepted again.
        await svc.changeHouseholdContact(2);
        expect(svc.getState().familyMembers.find(x => x.id === 2).linkedMembers).toEqual([1, 3]);
    });

    it('compensates a queued write for the edited year when the year is switched and the save then fails', async () => {
        const { setDoc } = await import('firebase/firestore');
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = createService();
        const other = [m(1, 'Erik Lindqvist'), m(2, 'Anna Lindqvist', [1, 3]), m(3, 'Maja Lindqvist')];
        setDoc.mockImplementationOnce(async () => {
            // A 2026 payment is queued behind the household write (holding the
            // optimistic household), then the year switches, then the write fails.
            svc.recordPayment({ memberId: 4, amount: 10, method: 'cash' });
            svc._setState({ activeYear: { id: '2027', label: '2027', status: 'open' }, familyMembers: other, billingEvents: [] });
            throw new Error('unavailable');
        });
        await expect(svc.changeHouseholdContact(2)).rejects.toThrow(/could not be saved/);
        await svc._saveQueue._chain;
        const persisted = mockStore['users/user-1/billingYears/2026'];
        expect(persisted.familyMembers.find(x => x.id === 1)).toMatchObject({ linkedMembers: [2, 3], householdName: 'Lake House' });
        expect(persisted.familyMembers.find(x => x.id === 2).linkedMembers).toEqual([]);
        expect(persisted.billingEvents.map(e => e.eventType)).toEqual(['PAYMENT_RECORDED']);
        expect(persisted.payments.some(p => p.memberId === 4 && p.amount === 10)).toBe(true);
        // The current (2027) state is untouched and never written.
        expect(svc.getState().familyMembers).toBe(other);
        expect(mockStore['users/user-1/billingYears/2027']).toBeUndefined();
        errSpy.mockRestore();
    });

    it('refuses a Refund and a distributed payment while a household change is pending', async () => {
        const { setDoc } = await import('firebase/firestore');
        const original = setDoc.getMockImplementation();
        let release;
        const held = new Promise(resolve => { release = resolve; });
        setDoc.mockImplementationOnce(async (ref, data, options) => { await held; return original(ref, data, options); });
        const svc = createService();
        const pending = svc.changeHouseholdContact(2);
        await vi.waitFor(() => expect(svc.getState().familyMembers.find(x => x.id === 2).linkedMembers).toEqual([1, 3]));
        expect(() => svc.issueRefund({ memberId: 2, amount: 5, method: 'cash', reason: 'over' })).toThrow('A household change is still being saved.');
        expect(() => svc.recordPayment({ memberId: 2, amount: 30, method: 'cash', distribute: true })).toThrow('A household change is still being saved.');
        expect(() => svc.billDeferredCharges({ memberId: 2 })).toThrow('A household change is still being saved.');
        // Erik's links were cleared by the pending change; a distribution request is still refused.
        expect(() => svc.recordPayment({ memberId: 1, amount: 30, method: 'cash', distribute: true })).toThrow('A household change is still being saved.');
        expect(svc.getState().owedAdjustments.find(a => a.id === 'oadj_def').status).toBe('deferred');
        svc.recordPayment({ memberId: 4, amount: 10, method: 'cash' }); // an individual payment is still allowed
        // Start New Year and a status change would snapshot the unconfirmed household.
        await expect(svc.createYear('2027')).rejects.toThrow('A household change is still being saved.');
        await expect(svc.setYearStatus('closed')).rejects.toThrow('A household change is still being saved.');
        expect(mockStore['users/user-1/billingYears/2027']).toBeUndefined();
        expect(svc.getState().activeYear.status).toBe('open');
        release();
        await pending;
        expect(svc.getState().payments.filter(p => p.memberId === 4 && p.amount === 10)).toHaveLength(1);
        expect(svc.getState().creditAdjustments).toHaveLength(1); // only the fixture refund
    });

    it('serializes overlapping contact changes so the later rebuild wins', async () => {
        token('h-erik', 1);
        token('h-anna', 2);
        token('h-maja', 3);
        const svc = createService();
        const first = svc.changeHouseholdContact(2);   // Erik -> Anna
        const second = svc.changeHouseholdContact(3);  // then Anna -> Maja, planned after the first finishes
        const [a, b] = await Promise.all([first, second]);
        expect(a).toMatchObject({ previousContactId: 1, contactId: 2 });
        expect(b).toMatchObject({ previousContactId: 2, contactId: 3 });
        const members = svc.getState().familyMembers;
        expect(members.find(x => x.id === 3).linkedMembers).toEqual([2, 1]);
        // Anna is no longer the contact, so her link is individual-only; Maja shows the household.
        expect(mockStore['publicShares/h-anna'].linkedMembers).toEqual([]);
        expect(mockStore['publicShares/h-maja'].linkedMembers.map(x => x.memberId).sort()).toEqual([1, 2]);
        expect(mockStore['publicShares/h-erik'].linkedMembers).toEqual([]);
    });

    it('refuses other household-graph edits while a household change is pending', async () => {
        const { setDoc } = await import('firebase/firestore');
        const original = setDoc.getMockImplementation();
        let release;
        const held = new Promise(resolve => { release = resolve; });
        setDoc.mockImplementationOnce(async (ref, data, options) => { await held; return original(ref, data, options); });
        const svc = createService();
        const pending = svc.changeHouseholdContact(2);
        await vi.waitFor(() => expect(svc.getState().familyMembers.find(x => x.id === 2).linkedMembers).toEqual([1, 3]));
        expect(() => svc.updateMember(2, { linkedMembers: [1, 3, 4] })).toThrow('A household change is still being saved.');
        expect(() => svc.removeMember(4)).toThrow('A household change is still being saved.');
        svc.updateMember(3, { name: 'Maja L.' }); // non-graph edits are still allowed
        release();
        await pending;
        svc.updateMember(2, { linkedMembers: [1, 3, 4] }); // allowed again once settled
        expect(svc.getState().familyMembers.find(x => x.id === 2).linkedMembers).toEqual([1, 3, 4]);
    });

    it('rejects a queued household change when the year is switched before it runs', async () => {
        const { setDoc } = await import('firebase/firestore');
        const original = setDoc.getMockImplementation();
        let release;
        const held = new Promise(resolve => { release = resolve; });
        setDoc.mockImplementationOnce(async (ref, data, options) => { await held; return original(ref, data, options); });
        const svc = createService();
        const other = [m(1, 'Erik Lindqvist', [2, 3]), m(2, 'Anna Lindqvist'), m(3, 'Maja Lindqvist')];
        const first = svc.changeHouseholdContact(2);   // 2026; its save is held open
        const queued = svc.changeHouseholdContact(3);  // requested in 2026, waits for the first
        // While the first change is saving, the administrator switches to 2027.
        await vi.waitFor(() => expect(svc.getState().familyMembers.find(x => x.id === 2).linkedMembers).toEqual([1, 3]));
        svc._setState({ activeYear: { id: '2027', label: '2027', status: 'open' }, familyMembers: other, billingEvents: [] });
        release();
        await first;
        await expect(queued).rejects.toThrow('The billing year changed before the household change ran; it was not applied.');
        expect(svc.getState().familyMembers).toBe(other);
        expect(mockStore['users/user-1/billingYears/2027']).toBeUndefined();
    });

    it('rebuilds the edited year even if the year is switched while the save is pending', async () => {
        token('h-erik', 1);
        token('h-anna', 2);
        const { setDoc } = await import('firebase/firestore');
        const svc = createService();
        const original = setDoc.getMockImplementation();
        setDoc.mockImplementationOnce(async (ref, data, options) => {
            // The administrator switches to another year mid-write.
            svc._setState({
                activeYear: { id: '2027', label: '2027', status: 'open' },
                familyMembers: [m(1, 'Erik Lindqvist'), m(2, 'Anna Lindqvist')],
                bills: [], payments: [], owedAdjustments: []
            });
            return original(ref, data, options);
        });
        const result = await svc.changeHouseholdContact(2);
        expect(result.shareDocsRebuilt).toBe(2);
        // Anna's 2026 link shows the 2026 household she now holds, not the 2027 state.
        expect(mockStore['publicShares/h-anna'].billingYearId).toBe('2026');
        expect(mockStore['publicShares/h-anna'].linkedMembers.map(x => x.memberId)).toEqual([1, 3]);
    });

    it('reports a failed rebuild without undoing the saved change', async () => {
        const { getDocs } = await import('firebase/firestore');
        getDocs.mockRejectedValueOnce(new Error('offline'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = createService();
        const result = await svc.changeHouseholdContact(2);
        expect(result.shareDocsRebuilt).toBeNull();
        expect(svc.getState().familyMembers.find(x => x.id === 2).linkedMembers).toEqual([1, 3]);
        expect(mockStore['users/user-1/billingYears/2026'].familyMembers.find(x => x.id === 2).linkedMembers).toEqual([1, 3]);
        errSpy.mockRestore();
    });
});
