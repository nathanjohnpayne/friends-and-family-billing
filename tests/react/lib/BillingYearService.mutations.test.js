import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ──────────────────────────────────────────────────────
const mockStore = {};
const setDocCalls = [];

vi.mock('@/lib/firebase.js', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
    collection: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
    getDoc: vi.fn(async (ref) => {
        const data = mockStore[ref.path];
        return { exists: () => !!data, data: () => data || null };
    }),
    getDocs: vi.fn(async (ref) => {
        const prefix = ref.path + '/';
        const docs = [];
        for (const [key, val] of Object.entries(mockStore)) {
            if (key.startsWith(prefix) && key.replace(prefix, '').indexOf('/') === -1) {
                const id = key.split('/').pop();
                docs.push({ id, data: () => val });
            }
        }
        return { docs };
    }),
    setDoc: vi.fn(async (ref, data, options) => {
        setDocCalls.push({ path: ref.path, data, options });
        mockStore[ref.path] = options?.merge
            ? { ...(mockStore[ref.path] || {}), ...data }
            : data;
    }),
    serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__')
}));

import { BillingYearService } from '@/lib/BillingYearService.js';

function clearStore() {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    setDocCalls.length = 0;
}

const TEST_USER = { uid: 'user-1' };

function createService() {
    const svc = new BillingYearService();
    svc._user = TEST_USER;
    svc._setState({
        activeYear: { id: '2026', label: '2026', status: 'open' },
        billingYears: [{ id: '2026', label: '2026', status: 'open' }],
        familyMembers: [
            { id: 1, name: 'Alice', email: 'a@b.com', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [3] },
            { id: 3, name: 'Carol', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] }
        ],
        bills: [
            { id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2] }
        ],
        payments: [
            { id: 'pay_1', memberId: 1, amount: 50, receivedAt: '2026-01-01', note: '', method: 'cash' }
        ],
        billingEvents: [],
        settings: { emailMessage: 'test', paymentLinks: [], paymentMethods: [] }
    });
    return svc;
}

describe('BillingYearService — CRUD mutations', () => {
    beforeEach(() => clearStore());

    // ── Members ──

    describe('addMember', () => {
        it('adds a new member and triggers save', () => {
            const svc = createService();
            const member = svc.addMember({ name: 'Dave', email: 'd@e.com' });
            expect(member.name).toBe('Dave');
            expect(member.email).toBe('d@e.com');
            expect(member.id).toBeGreaterThan(0);
            expect(svc.getState().familyMembers).toHaveLength(4);
        });

        it('trims name whitespace', () => {
            const svc = createService();
            const member = svc.addMember({ name: '  Eve  ' });
            expect(member.name).toBe('Eve');
        });

        it('rejects empty name', () => {
            const svc = createService();
            expect(() => svc.addMember({ name: '' })).toThrow('Name is required');
        });

        it('rejects duplicate name', () => {
            const svc = createService();
            expect(() => svc.addMember({ name: 'Alice' })).toThrow('already exists');
        });

        it('throws when year is read-only', () => {
            const svc = createService();
            svc._setState({ activeYear: { id: '2024', status: 'closed' } });
            expect(() => svc.addMember({ name: 'New' })).toThrow('read-only');
        });
    });

    describe('updateMember', () => {
        it('updates member fields', () => {
            const svc = createService();
            svc.updateMember(1, { email: 'new@test.com' });
            expect(svc.getState().familyMembers.find(m => m.id === 1).email).toBe('new@test.com');
        });

        it('rejects renaming to duplicate name', () => {
            const svc = createService();
            expect(() => svc.updateMember(1, { name: 'Bob' })).toThrow('already exists');
        });

        it('throws for non-existent member', () => {
            const svc = createService();
            expect(() => svc.updateMember(999, { email: 'x' })).toThrow('not found');
        });
    });

    describe('removeMember', () => {
        it('removes member and cleans up bill membership', () => {
            const svc = createService();
            svc.removeMember(1);
            const state = svc.getState();
            expect(state.familyMembers.find(m => m.id === 1)).toBeUndefined();
            // Alice was in the Internet bill — should be removed
            expect(state.bills[0].members).not.toContain(1);
        });

        it('removes payments for deleted member', () => {
            const svc = createService();
            svc.removeMember(1);
            expect(svc.getState().payments).toHaveLength(0);
        });

        it('unlinks from parent member', () => {
            const svc = createService();
            // Bob has Carol (id:3) linked
            svc.removeMember(3);
            const bob = svc.getState().familyMembers.find(m => m.id === 2);
            expect(bob.linkedMembers).not.toContain(3);
        });

        it('throws when year is archived', () => {
            const svc = createService();
            svc._setState({ activeYear: { id: '2024', status: 'archived' } });
            expect(() => svc.removeMember(1)).toThrow('read-only');
        });
    });

    // ── Bills ──

    describe('addBill', () => {
        it('adds a bill and emits BILL_CREATED event', () => {
            const svc = createService();
            const bill = svc.addBill({ name: 'Electric', amount: 80 });
            expect(bill.name).toBe('Electric');
            expect(bill.amount).toBe(80);
            expect(bill.billingFrequency).toBe('monthly');
            expect(svc.getState().bills).toHaveLength(2);
            const events = svc.getState().billingEvents;
            expect(events.length).toBe(1);
            expect(events[0].eventType).toBe('BILL_CREATED');
        });

        it('rejects empty name', () => {
            const svc = createService();
            expect(() => svc.addBill({ name: '', amount: 50 })).toThrow('name is required');
        });

        it('rejects zero amount', () => {
            const svc = createService();
            expect(() => svc.addBill({ name: 'X', amount: 0 })).toThrow('greater than zero');
        });

        it('accepts annual frequency', () => {
            const svc = createService();
            const bill = svc.addBill({ name: 'Insurance', amount: 1200, billingFrequency: 'annual' });
            expect(bill.billingFrequency).toBe('annual');
        });
    });

    describe('updateBill', () => {
        it('updates bill fields and emits BILL_UPDATED events', () => {
            const svc = createService();
            svc.updateBill(101, { name: 'Fiber Internet', amount: 120 });
            const bill = svc.getState().bills.find(b => b.id === 101);
            expect(bill.name).toBe('Fiber Internet');
            expect(bill.amount).toBe(120);
            // Two field changes → two events
            const events = svc.getState().billingEvents.filter(e => e.eventType === 'BILL_UPDATED');
            expect(events.length).toBe(2);
        });

        it('throws for non-existent bill', () => {
            const svc = createService();
            expect(() => svc.updateBill(999, { name: 'X' })).toThrow('not found');
        });

        it('does not emit events for unchanged fields', () => {
            const svc = createService();
            svc.updateBill(101, { name: 'Internet' }); // same name
            expect(svc.getState().billingEvents).toHaveLength(0);
        });
    });

    describe('removeBill', () => {
        it('removes bill and emits BILL_DELETED event', () => {
            const svc = createService();
            svc.removeBill(101);
            expect(svc.getState().bills).toHaveLength(0);
            const events = svc.getState().billingEvents;
            expect(events.length).toBe(1);
            expect(events[0].eventType).toBe('BILL_DELETED');
            expect(events[0].payload.billName).toBe('Internet');
        });
    });

    describe('toggleBillMember', () => {
        it('adds a member to a bill', () => {
            const svc = createService();
            svc.toggleBillMember(101, 3); // Carol not in Internet
            expect(svc.getState().bills[0].members).toContain(3);
            const event = svc.getState().billingEvents.find(e => e.eventType === 'MEMBER_ADDED_TO_BILL');
            expect(event).toBeDefined();
            expect(event.payload.memberName).toBe('Carol');
        });

        it('removes a member from a bill', () => {
            const svc = createService();
            svc.toggleBillMember(101, 1); // Alice is in Internet
            expect(svc.getState().bills[0].members).not.toContain(1);
            const event = svc.getState().billingEvents.find(e => e.eventType === 'MEMBER_REMOVED_FROM_BILL');
            expect(event).toBeDefined();
        });

        it('throws for non-existent bill', () => {
            const svc = createService();
            expect(() => svc.toggleBillMember(999, 1)).toThrow('not found');
        });
    });

    // ── Payments ──

    describe('recordPayment', () => {
        it('records a payment and emits event', () => {
            const svc = createService();
            const entry = svc.recordPayment({ memberId: 2, amount: 100, method: 'venmo', note: 'Thanks' });
            expect(entry.amount).toBe(100);
            expect(entry.method).toBe('venmo');
            expect(svc.getState().payments).toHaveLength(2);
            const event = svc.getState().billingEvents.find(e => e.eventType === 'PAYMENT_RECORDED');
            expect(event).toBeDefined();
            expect(event.payload.memberName).toBe('Bob');
        });

        it('rejects zero amount', () => {
            const svc = createService();
            expect(() => svc.recordPayment({ memberId: 1, amount: 0 })).toThrow('greater than zero');
        });

        it('rejects unknown member', () => {
            const svc = createService();
            expect(() => svc.recordPayment({ memberId: 999, amount: 50 })).toThrow('not found');
        });

        it('defaults method to other', () => {
            const svc = createService();
            const entry = svc.recordPayment({ memberId: 1, amount: 10 });
            expect(entry.method).toBe('other');
        });
    });

    // ── Settings ──

    describe('updateSettings', () => {
        it('merges settings', () => {
            const svc = createService();
            svc.updateSettings({ emailMessage: 'New template' });
            expect(svc.getState().settings.emailMessage).toBe('New template');
            // Other settings preserved
            expect(svc.getState().settings.paymentLinks).toEqual([]);
        });

        it('throws when year is read-only', () => {
            const svc = createService();
            svc._setState({ activeYear: { id: '2024', status: 'closed' } });
            expect(() => svc.updateSettings({ emailMessage: 'x' })).toThrow('read-only');
        });
    });

    // ── _guardReadOnly ──

    describe('_guardReadOnly', () => {
        it('throws for closed year', () => {
            const svc = createService();
            svc._setState({ activeYear: { id: '2024', status: 'closed' } });
            expect(() => svc._guardReadOnly()).toThrow('read-only');
        });

        it('throws for archived year', () => {
            const svc = createService();
            svc._setState({ activeYear: { id: '2024', status: 'archived' } });
            expect(() => svc._guardReadOnly()).toThrow('read-only');
        });

        it('throws when no active year', () => {
            const svc = createService();
            svc._setState({ activeYear: null });
            expect(() => svc._guardReadOnly()).toThrow('No active billing year');
        });

        it('passes for open year', () => {
            const svc = createService();
            expect(() => svc._guardReadOnly()).not.toThrow();
        });

        it('passes for settling year', () => {
            const svc = createService();
            svc._setState({ activeYear: { id: '2026', status: 'settling' } });
            expect(() => svc._guardReadOnly()).not.toThrow();
        });
    });
});
