import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ──────────────────────────────────────────────────────
// Tracks all setDoc calls and controls what getDoc/getDocs return.
const mockStore = {};
const setDocCalls = [];

vi.mock('@/lib/firebase.js', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
    collection: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
    getDoc: vi.fn(async (ref) => {
        const data = mockStore[ref.path];
        return {
            exists: () => !!data,
            data: () => data || null
        };
    }),
    getDocs: vi.fn(async (ref) => {
        const prefix = ref.path + '/';
        const docs = [];
        for (const [key, val] of Object.entries(mockStore)) {
            if (key.startsWith(prefix) || key === ref.path) {
                // For collection queries, match children
                const segments = key.split('/');
                const id = segments[segments.length - 1];
                // Only include direct children of the collection
                if (key.startsWith(prefix) && key.replace(prefix, '').indexOf('/') === -1) {
                    docs.push({ id, data: () => val });
                }
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

describe('BillingYearService', () => {
    let svc;

    beforeEach(() => {
        clearStore();
        svc = new BillingYearService();
    });

    // ── Subscription API ──────────────────────────────────────────────

    describe('subscribe / _setState', () => {
        it('notifies subscribers on state change', () => {
            const calls = [];
            svc.subscribe(() => calls.push('called'));
            svc._setState({ loading: false });
            expect(calls).toEqual(['called']);
        });

        it('creates a new state reference on each _setState', () => {
            const first = svc.getState();
            svc._setState({ loading: false });
            const second = svc.getState();
            expect(first).not.toBe(second);
        });

        it('unsubscribe stops notifications', () => {
            const calls = [];
            const unsub = svc.subscribe(() => calls.push('called'));
            unsub();
            svc._setState({ loading: false });
            expect(calls).toEqual([]);
        });
    });

    // ── setUser ───────────────────────────────────────────────────────

    describe('setUser', () => {
        it('resets state when user is null', async () => {
            svc._setState({ loading: true, familyMembers: [{ id: 1 }] });
            await svc.setUser(null);
            const state = svc.getState();
            expect(state.loading).toBe(false);
            expect(state.familyMembers).toEqual([]);
            expect(state.activeYear).toBeNull();
        });

        it('loads data for an existing user with activeBillingYear', async () => {
            // Seed mock store with user doc and billing year
            mockStore['users/user-1'] = { activeBillingYear: '2025' };
            mockStore['users/user-1/billingYears/2025'] = {
                label: '2025', status: 'open',
                familyMembers: [{ id: 1, name: 'Alice' }],
                bills: [], payments: [], billingEvents: [],
                settings: { emailMessage: 'test', paymentLinks: [], paymentMethods: [] }
            };

            await svc.setUser(TEST_USER);
            const state = svc.getState();
            expect(state.loading).toBe(false);
            expect(state.activeYear.id).toBe('2025');
            expect(state.familyMembers.length).toBe(1);
            expect(state.familyMembers[0].name).toBe('Alice');
        });

        it('creates default year for brand-new users with legacy email template', async () => {
            // No user doc → brand-new user path
            await svc.setUser(TEST_USER);

            // Should have called setDoc for the user doc and the year doc
            const yearWrite = setDocCalls.find(c => c.path.includes('billingYears'));
            expect(yearWrite).toBeDefined();
            expect(yearWrite.data.settings.emailMessage).toContain('%billing_year%');
            expect(yearWrite.data.settings.emailMessage).toContain('%annual_total%');
        });

        it('sets error state when load fails', async () => {
            // Make getDoc throw
            const { getDoc } = await import('firebase/firestore');
            getDoc.mockRejectedValueOnce(new Error('network down'));

            await svc.setUser(TEST_USER);
            const state = svc.getState();
            expect(state.loading).toBe(false);
            expect(state.error).toBe('network down');
        });
    });

    // ── createYear ────────────────────────────────────────────────────

    describe('createYear', () => {
        it('throws on duplicate year label', async () => {
            svc._user = TEST_USER;
            svc._setState({
                billingYears: [{ id: '2025', label: '2025', status: 'open' }],
                familyMembers: [], bills: [], settings: {}
            });

            await expect(svc.createYear('2025'))
                .rejects.toThrow('already exists');
        });

        it('writes to Firestore for a new year label', async () => {
            svc._user = TEST_USER;
            svc._setState({
                billingYears: [{ id: '2025', label: '2025', status: 'open' }],
                activeYear: { id: '2025', label: '2025', status: 'open' },
                familyMembers: [{ id: 1, name: 'Alice', linkedMembers: [] }],
                bills: [{ id: 1, name: 'Electric', amount: 100, billingFrequency: 'annually', members: [1] }],
                settings: { emailMessage: '', paymentLinks: [], paymentMethods: [] }
            });

            // Seed store so switchYear's loadYearData finds something
            mockStore['users/user-1/billingYears/2026'] = {
                label: '2026', status: 'open',
                familyMembers: [{ id: 1, name: 'Alice' }],
                bills: [], payments: [], billingEvents: [], settings: {}
            };

            await svc.createYear('2026');

            const yearWrite = setDocCalls.find(c => c.path === 'users/user-1/billingYears/2026');
            expect(yearWrite).toBeDefined();
            expect(yearWrite.data.createdAt).toBe('__SERVER_TIMESTAMP__');
        });

        it('does nothing when no user is set', async () => {
            const before = setDocCalls.length;
            await svc.createYear('2026');
            expect(setDocCalls.length).toBe(before);
        });
    });

    // ── save ──────────────────────────────────────────────────────────

    describe('save', () => {
        it('refuses to save when year is closed', async () => {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2024', status: 'closed' },
                familyMembers: [], bills: [], payments: [],
                billingEvents: [], settings: {}
            });

            const before = setDocCalls.length;
            await svc.save();
            expect(setDocCalls.length).toBe(before);
        });

        it('refuses to save when year is archived', async () => {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2024', status: 'archived' },
                familyMembers: [], bills: [], payments: [],
                billingEvents: [], settings: {}
            });

            const before = setDocCalls.length;
            await svc.save();
            expect(setDocCalls.length).toBe(before);
        });

        it('enqueues a write for an open year', async () => {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'open' },
                familyMembers: [{ id: 1, name: 'Alice' }],
                bills: [], payments: [], billingEvents: [],
                settings: { emailMessage: '', paymentLinks: [], paymentMethods: [] }
            });

            await svc.save();

            const write = setDocCalls.find(c => c.path === 'users/user-1/billingYears/2025');
            expect(write).toBeDefined();
            expect(write.data.updatedAt).toBe('__SERVER_TIMESTAMP__');
        });

        it('does nothing without a user', async () => {
            const before = setDocCalls.length;
            await svc.save();
            expect(setDocCalls.length).toBe(before);
        });

        it('does nothing without an active year', async () => {
            svc._user = TEST_USER;
            const before = setDocCalls.length;
            await svc.save();
            expect(setDocCalls.length).toBe(before);
        });
    });

    // ── setYearStatus ────────────────────────────────────────────────

    describe('setYearStatus', () => {
        it('transitions active year to new status and writes to Firestore with billing event', async () => {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'open' },
                billingYears: [{ id: '2025', label: '2025', status: 'open' }],
                billingEvents: []
            });

            await svc.setYearStatus('settling');

            const state = svc.getState();
            expect(state.activeYear.status).toBe('settling');
            expect(state.billingYears[0].status).toBe('settling');

            // Verify YEAR_STATUS_CHANGED event was emitted
            expect(state.billingEvents.length).toBe(1);
            expect(state.billingEvents[0].eventType).toBe('YEAR_STATUS_CHANGED');
            expect(state.billingEvents[0].payload.previousStatus).toBe('open');
            expect(state.billingEvents[0].payload.newStatus).toBe('settling');
            expect(state.billingEvents[0].actor.userId).toBe('user-1');

            const write = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2025' && c.data.status === 'settling'
            );
            expect(write).toBeDefined();
            expect(write.options).toEqual({ merge: true });
            // Event should be persisted in the Firestore write
            expect(write.data.billingEvents.length).toBe(1);
            expect(write.data.billingEvents[0].eventType).toBe('YEAR_STATUS_CHANGED');
        });

        it('sets closedAt when closing', async () => {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'settling' },
                billingYears: [{ id: '2025', label: '2025', status: 'settling' }]
            });

            await svc.setYearStatus('closed');

            const state = svc.getState();
            expect(state.activeYear.status).toBe('closed');
            expect(state.activeYear.closedAt).toBeInstanceOf(Date);

            const write = setDocCalls.find(c => c.data.status === 'closed');
            expect(write.data.closedAt).toBe('__SERVER_TIMESTAMP__');
        });

        it('sets archivedAt when archiving', async () => {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'closed' },
                billingYears: [{ id: '2025', label: '2025', status: 'closed' }]
            });

            await svc.setYearStatus('archived');
            expect(svc.getState().activeYear.archivedAt).toBeInstanceOf(Date);
        });

        it('no-ops when status is unchanged', async () => {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'open' },
                billingYears: [{ id: '2025', label: '2025', status: 'open' }]
            });

            const before = setDocCalls.length;
            await svc.setYearStatus('open');
            expect(setDocCalls.length).toBe(before);
        });

        it('no-ops without a user', async () => {
            const before = setDocCalls.length;
            await svc.setYearStatus('settling');
            expect(setDocCalls.length).toBe(before);
        });

        it('throws and preserves state on Firestore error', async () => {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'open' },
                billingYears: [{ id: '2025', label: '2025', status: 'open' }]
            });

            const { setDoc } = await import('firebase/firestore');
            setDoc.mockRejectedValueOnce(new Error('permission denied'));

            await expect(svc.setYearStatus('settling')).rejects.toThrow('permission denied');
            expect(svc.getState().activeYear.status).toBe('open');
        });
    });

    // ── switchYear ────────────────────────────────────────────────────

    describe('switchYear', () => {
        it('updates activeYear and sets activeBillingYear on user doc', async () => {
            svc._user = TEST_USER;
            mockStore['users/user-1/billingYears/2024'] = {
                label: '2024', status: 'archived',
                familyMembers: [], bills: [], payments: [],
                billingEvents: [], settings: {}
            };

            await svc.switchYear('2024');

            const state = svc.getState();
            expect(state.activeYear.id).toBe('2024');
            expect(state.loading).toBe(false);

            const userDocWrite = setDocCalls.find(c =>
                c.path === 'users/user-1' && c.data.activeBillingYear === '2024'
            );
            expect(userDocWrite).toBeDefined();
            expect(userDocWrite.options).toEqual({ merge: true });
        });

        it('sets error state on failure', async () => {
            svc._user = TEST_USER;
            const { setDoc } = await import('firebase/firestore');
            setDoc.mockRejectedValueOnce(new Error('write failed'));

            await svc.switchYear('2024');
            expect(svc.getState().error).toBe('write failed');
            expect(svc.getState().loading).toBe(false);
        });
    });
});
