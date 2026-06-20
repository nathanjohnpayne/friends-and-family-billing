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

        it('loads creditAdjustments from the year document into state (#316 read path)', async () => {
            const creditAdjustments = [{ id: 'cadj1', memberId: 1, type: 'refund', amount: 50, status: 'recorded' }];
            mockStore['users/user-1'] = { activeBillingYear: '2025' };
            mockStore['users/user-1/billingYears/2025'] = {
                label: '2025', status: 'open',
                familyMembers: [{ id: 1, name: 'Alice' }],
                bills: [], payments: [], creditAdjustments, billingEvents: [],
                settings: { emailMessage: 'test', paymentLinks: [], paymentMethods: [] }
            };

            await svc.setUser(TEST_USER);
            expect(svc.getState().creditAdjustments).toEqual(creditAdjustments);
        });

        it('loads owedAdjustments from the year document into state (#317 read path)', async () => {
            const owedAdjustments = [{ id: 'oadj1', memberId: 1, kind: 'usage_charge', amount: 25, status: 'deferred' }];
            mockStore['users/user-1'] = { activeBillingYear: '2025' };
            mockStore['users/user-1/billingYears/2025'] = {
                label: '2025', status: 'open',
                familyMembers: [{ id: 1, name: 'Alice' }],
                bills: [], payments: [], owedAdjustments, billingEvents: [],
                settings: { emailMessage: 'test', paymentLinks: [], paymentMethods: [] }
            };

            await svc.setUser(TEST_USER);
            expect(svc.getState().owedAdjustments).toEqual(owedAdjustments);
        });

        it('resets owedAdjustments to an empty array when user is null', async () => {
            svc._setState({ owedAdjustments: [{ id: 'oadj1', memberId: 1, kind: 'usage_charge', amount: 5, status: 'deferred' }] });
            await svc.setUser(null);
            expect(svc.getState().owedAdjustments).toEqual([]);
        });

        it('creates default year for brand-new users with legacy email template', async () => {
            // No user doc → brand-new user path
            await svc.setUser(TEST_USER);

            // Should have called setDoc for the user doc and the year doc
            const yearWrite = setDocCalls.find(c => c.path.includes('billingYears'));
            expect(yearWrite).toBeDefined();
            expect(yearWrite.data.settings.emailMessage).toContain('%billing_year%');
            expect(yearWrite.data.settings.emailMessage).toContain('%household_total%');
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

    // ── createYear: carry-forward seam (#322, ADR 0005/0006) ──────────
    describe('createYear — carry-forward', () => {
        // Alice (solo) owes 600 on a $50/mo bill and overpaid by 80 → undisposed credit.
        // Bob (solo) owes 600 and has a 30 deferred usage charge → undisposed charge.
        function seedPriorYear() {
            svc._user = TEST_USER;
            svc._setState({
                billingYears: [{ id: '2026', label: '2026', status: 'open' }],
                activeYear: { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null },
                familyMembers: [
                    { id: 1, name: 'Alice', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
                    { id: 2, name: 'Bob', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] }
                ],
                bills: [
                    { id: 101, name: 'A', amount: 50, billingFrequency: 'monthly', logo: '', website: '', members: [1] },
                    { id: 102, name: 'B', amount: 50, billingFrequency: 'monthly', logo: '', website: '', members: [2] }
                ],
                payments: [
                    { id: 'p1', memberId: 1, amount: 680, receivedAt: '2026-01-01', note: '', method: 'cash' },
                    { id: 'p2', memberId: 2, amount: 600, receivedAt: '2026-01-01', note: '', method: 'cash' }
                ],
                creditAdjustments: [],
                owedAdjustments: [
                    { id: 'o1', memberId: 2, kind: 'usage_charge', amount: 30, status: 'deferred', createdAt: '2026-02-01' }
                ],
                billingEvents: [],
                settings: { emailMessage: '', emailSubject: '', paymentLinks: [], paymentMethods: [] }
            });
            // Seed the destination doc so switchYear's loadYearData finds it.
            mockStore['users/user-1/billingYears/2027'] = {
                label: '2027', status: 'open',
                familyMembers: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
                bills: [], payments: [], creditAdjustments: [], owedAdjustments: [], billingEvents: [], settings: {}
            };
        }

        it('seeds carry_opening records in the new year for each carrying household', async () => {
            seedPriorYear();
            await svc.createYear('2027');

            const newYearWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2027' && c.data.familyMembers && !c.options?.merge
            );
            expect(newYearWrite).toBeDefined();
            const seeds = (newYearWrite.data.owedAdjustments || []).filter(a => a.kind === 'carry_opening');
            // Alice carries −80 (credit), Bob carries +30 (deferred charge).
            const alice = seeds.find(s => s.memberId === 1);
            const bob = seeds.find(s => s.memberId === 2);
            expect(alice.amount).toBeCloseTo(-80, 5);
            expect(bob.amount).toBeCloseTo(30, 5);
            expect(alice.fromYear).toBe('2026');
        });

        it('marks the prior year undisposed credits as carried-forward (append-only) on the prior year', async () => {
            seedPriorYear();
            await svc.createYear('2027');

            // A full-document write to the PRIOR year records the carry disposition.
            const priorWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2026' && c.data.creditAdjustments
            );
            expect(priorWrite).toBeDefined();
            const carry = (priorWrite.data.creditAdjustments || []).find(a => a.type === 'carry_forward');
            expect(carry).toBeDefined();
            expect(carry.memberId).toBe(1);            // Alice's household primary
            expect(carry.amount).toBeCloseTo(80, 5);
            expect(carry.status).toBe('recorded');
            expect(carry.toYear).toBe('2027');
        });

        it('marks the prior year deferred charges as carried_forward (append-only, not deleted)', async () => {
            seedPriorYear();
            await svc.createYear('2027');

            const priorWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2026' && c.data.owedAdjustments
            );
            expect(priorWrite).toBeDefined();
            const charge = (priorWrite.data.owedAdjustments || []).find(a => a.id === 'o1');
            // Same record, still present (not deleted), status transitioned.
            expect(charge).toBeDefined();
            expect(charge.status).toBe('carried_forward');
            expect(charge.carriedForwardTo).toBe('2027');
        });

        it('records the carry on the prior year so it no longer reads as an undisposed credit', async () => {
            seedPriorYear();
            await svc.createYear('2027');
            // After the carry, the prior-year state nets Alice to owed (credit cleared).
            const priorWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2026' && c.data.creditAdjustments
            );
            const carried = priorWrite.data.creditAdjustments.filter(a => a.type === 'carry_forward');
            expect(carried).toHaveLength(1);
        });

        it('creates the new year cleanly when nothing is undisposed', async () => {
            svc._user = TEST_USER;
            svc._setState({
                billingYears: [{ id: '2026', label: '2026', status: 'open' }],
                activeYear: { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null },
                familyMembers: [{ id: 1, name: 'Alice', linkedMembers: [] }],
                bills: [{ id: 101, name: 'A', amount: 50, billingFrequency: 'monthly', members: [1] }],
                payments: [{ id: 'p1', memberId: 1, amount: 600, receivedAt: '2026-01-01', note: '', method: 'cash' }],
                creditAdjustments: [], owedAdjustments: [], billingEvents: [],
                settings: { emailMessage: '', emailSubject: '', paymentLinks: [], paymentMethods: [] }
            });
            mockStore['users/user-1/billingYears/2027'] = {
                label: '2027', status: 'open', familyMembers: [{ id: 1, name: 'Alice' }],
                bills: [], payments: [], creditAdjustments: [], owedAdjustments: [], billingEvents: [], settings: {}
            };
            await svc.createYear('2027');
            const newYearWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2027' && c.data.familyMembers && !c.options?.merge
            );
            expect((newYearWrite.data.owedAdjustments || []).filter(a => a.kind === 'carry_opening')).toHaveLength(0);
        });

        it('does NOT carry a credit re-opened by an active not_received (#319/#322, ADR 0003/0006)', async () => {
            // Alice (solo) owes 600, overpaid by 80, but the whole 80 surplus was
            // already refunded (c1=80 recorded) → net credit 0. With the refund
            // re-opened by a not_received, the 80 is owed back THIS year; it must NOT
            // carry forward as undisposed surplus.
            svc._user = TEST_USER;
            svc._setState({
                billingYears: [{ id: '2026', label: '2026', status: 'open' }],
                activeYear: { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null },
                familyMembers: [{ id: 1, name: 'Alice', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] }],
                bills: [{ id: 101, name: 'A', amount: 50, billingFrequency: 'monthly', logo: '', website: '', members: [1] }],
                payments: [{ id: 'p1', memberId: 1, amount: 680, receivedAt: '2026-01-01', note: '', method: 'cash' }],
                creditAdjustments: [{ id: 'c1', memberId: 1, type: 'refund', amount: 80, status: 'recorded', createdAt: '2026-02-01' }],
                owedAdjustments: [], billingEvents: [],
                settings: { emailMessage: '', emailSubject: '', paymentLinks: [], paymentMethods: [] }
            });
            mockStore['users/user-1/billingYears/2027'] = {
                label: '2027', status: 'open', familyMembers: [{ id: 1, name: 'Alice' }],
                bills: [], payments: [], creditAdjustments: [], owedAdjustments: [], billingEvents: [], settings: {}
            };

            // Pass the re-opened set (as BillingYearSelector does from useRefundNotices).
            await svc.createYear('2027', { reopenedAdjustmentIds: new Set(['c1']) });

            const newYearWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2027' && c.data.familyMembers && !c.options?.merge
            );
            // No carry_opening seed (the resurfaced credit stays live this year).
            expect((newYearWrite.data.owedAdjustments || []).filter(a => a.kind === 'carry_opening')).toHaveLength(0);
            // And no prior-year carry_forward disposition was written.
            const priorWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2026' && c.data.creditAdjustments &&
                (c.data.creditAdjustments || []).some(a => a.type === 'carry_forward')
            );
            expect(priorWrite).toBeUndefined();
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

        it('preserves creditAdjustments in the save payload (#316 — no drop on full-document write)', async () => {
            const creditAdjustments = [{ id: 'cadj1', memberId: 1, type: 'refund', amount: 50, status: 'recorded' }];
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'open' },
                familyMembers: [{ id: 1, name: 'Alice' }],
                bills: [], payments: [], creditAdjustments, billingEvents: [],
                settings: { emailMessage: '', paymentLinks: [], paymentMethods: [] }
            });

            await svc.save();

            const write = setDocCalls.find(c => c.path === 'users/user-1/billingYears/2025');
            expect(write.data.creditAdjustments).toEqual(creditAdjustments);
        });

        it('preserves owedAdjustments in the save payload (#317 — no drop on full-document write)', async () => {
            const owedAdjustments = [{ id: 'oadj1', memberId: 1, kind: 'usage_charge', amount: 25, status: 'deferred' }];
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'open' },
                familyMembers: [{ id: 1, name: 'Alice' }],
                bills: [], payments: [], owedAdjustments, billingEvents: [],
                settings: { emailMessage: '', paymentLinks: [], paymentMethods: [] }
            });

            await svc.save();

            const write = setDocCalls.find(c => c.path === 'users/user-1/billingYears/2025');
            expect(write.data.owedAdjustments).toEqual(owedAdjustments);
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

    // ── recordUsageCharge (#317) ──────────────────────────────────────

    describe('recordUsageCharge', () => {
        function seedOpenYear(extra = {}) {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'open' },
                familyMembers: [
                    { id: 1, name: 'Alice', linkedMembers: [] },
                    { id: 2, name: 'Bob', linkedMembers: [] }
                ],
                bills: [], payments: [], creditAdjustments: [], owedAdjustments: [],
                billingEvents: [],
                settings: { emailMessage: '', paymentLinks: [], paymentMethods: [] },
                ...extra
            });
        }

        it('appends a deferred usage charge to owedAdjustments with the financial source of truth on the record', () => {
            seedOpenYear();
            const charge = svc.recordUsageCharge({ memberId: 1, amount: 12.5, description: 'Roaming overage', incurredDate: '2025-03-04' });

            const { owedAdjustments } = svc.getState();
            expect(owedAdjustments.length).toBe(1);
            expect(charge.kind).toBe('usage_charge');
            expect(charge.status).toBe('deferred');
            expect(charge.memberId).toBe(1);
            expect(charge.amount).toBe(12.5);
            expect(charge.description).toBe('Roaming overage');
            expect(charge.incurredDate).toBe('2025-03-04');
            expect(typeof charge.id).toBe('string');
            expect(charge.id.length).toBeGreaterThan(0);
            expect(charge.createdAt).toBeTruthy();
        });

        it('normalizes decimal edge-case amounts to persisted cents', () => {
            seedOpenYear();
            const charge = svc.recordUsageCharge({ memberId: 1, amount: '1.005', description: 'Rounding edge', incurredDate: '2025-03-04' });

            expect(charge.amount).toBe(1.01);
            expect(svc.getState().owedAdjustments[0].amount).toBe(1.01);
        });

        it('defaults incurredDate to the local date when omitted', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2025, 4, 6, 12, 0, 0));
            try {
                seedOpenYear();
                const charge = svc.recordUsageCharge({ memberId: 1, amount: 8.75, description: 'Local date fallback' });

                expect(charge.incurredDate).toBe('2025-05-06');
                expect(svc.getState().owedAdjustments[0].incurredDate).toBe('2025-05-06');
            } finally {
                vi.useRealTimers();
            }
        });

        it('emits a USAGE_CHARGE_RECORDED billing event (mirrors the PAYMENT_RECORDED pattern)', () => {
            seedOpenYear();
            svc.recordUsageCharge({ memberId: 1, amount: 9, description: 'Late fee', incurredDate: '2025-02-01' });

            const events = svc.getState().billingEvents;
            const evt = events.find(e => e.eventType === 'USAGE_CHARGE_RECORDED');
            expect(evt).toBeDefined();
            expect(evt.payload.memberId).toBe(1);
            expect(evt.payload.memberName).toBe('Alice');
            expect(evt.payload.amount).toBe(9);
            expect(evt.payload.status).toBe('deferred');
            expect(evt.actor.userId).toBe('user-1');
        });

        it('is append-only across multiple charges (never overwrites prior entries)', () => {
            seedOpenYear();
            svc.recordUsageCharge({ memberId: 1, amount: 5, description: 'A', incurredDate: '2025-01-01' });
            svc.recordUsageCharge({ memberId: 1, amount: 7, description: 'B', incurredDate: '2025-01-02' });
            expect(svc.getState().owedAdjustments.length).toBe(2);
        });

        it('persists via save() (full-document write includes the new charge)', async () => {
            seedOpenYear();
            svc.recordUsageCharge({ memberId: 1, amount: 5, description: 'A', incurredDate: '2025-01-01' });
            // recordUsageCharge calls save() internally; flush the queue
            await svc.getSaveQueue()._chain;
            const write = setDocCalls.find(c => c.path === 'users/user-1/billingYears/2025');
            expect(write).toBeDefined();
            expect(write.data.owedAdjustments.length).toBe(1);
            expect(write.data.owedAdjustments[0].description).toBe('A');
        });

        it('does NOT add the deferred charge to owed — settlement is unaffected', () => {
            seedOpenYear();
            svc.recordUsageCharge({ memberId: 1, amount: 100, description: 'Big charge', incurredDate: '2025-01-01' });
            // payments and bills are untouched; a deferred charge lives only on owedAdjustments
            expect(svc.getState().payments).toEqual([]);
            const charge = svc.getState().owedAdjustments[0];
            expect(charge.status).toBe('deferred');
        });

        it('rejects a non-positive amount', () => {
            seedOpenYear();
            expect(() => svc.recordUsageCharge({ memberId: 1, amount: 0, description: 'x', incurredDate: '2025-01-01' }))
                .toThrow(/amount/i);
            expect(() => svc.recordUsageCharge({ memberId: 1, amount: -5, description: 'x', incurredDate: '2025-01-01' }))
                .toThrow(/amount/i);
        });

        it('requires a description', () => {
            seedOpenYear();
            expect(() => svc.recordUsageCharge({ memberId: 1, amount: 5, description: '   ', incurredDate: '2025-01-01' }))
                .toThrow(/description/i);
        });

        it('throws when the member does not exist', () => {
            seedOpenYear();
            expect(() => svc.recordUsageCharge({ memberId: 999, amount: 5, description: 'x', incurredDate: '2025-01-01' }))
                .toThrow(/member/i);
        });

        it('throws when the year is read-only (closed)', () => {
            seedOpenYear({ activeYear: { id: '2025', label: '2025', status: 'closed' } });
            expect(() => svc.recordUsageCharge({ memberId: 1, amount: 5, description: 'x', incurredDate: '2025-01-01' }))
                .toThrow(/read-only/i);
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
