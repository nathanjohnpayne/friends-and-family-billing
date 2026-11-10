import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore mock ──────────────────────────────────────────────────────
// Tracks all setDoc calls and controls what getDoc/getDocs return.
const mockStore = {};
const setDocCalls = [];
// Out-of-band switch to force the next writeBatch().commit() to reject (atomicity test).
const mockBatchControl = { failNextCommit: false };

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
    // writeBatch mock: collects batched set() ops and applies them on commit() the
    // same way setDoc does (recording into setDocCalls + mockStore), so the rollover
    // (which routes through a batch) is observable to the same assertions. commit can
    // be forced to reject via __failNextBatchCommit to exercise atomicity.
    writeBatch: vi.fn(() => {
        const ops = [];
        return {
            set: (ref, data) => { ops.push({ ref, data }); },
            commit: vi.fn(async () => {
                if (mockBatchControl.failNextCommit) {
                    mockBatchControl.failNextCommit = false;
                    throw new Error('simulated batch commit failure');
                }
                // Atomic: only apply once all ops are known and commit succeeds.
                for (const { ref, data } of ops) {
                    setDocCalls.push({ path: ref.path, data, batched: true });
                    mockStore[ref.path] = data;
                }
            })
        };
    }),
    serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__')
}));

import { BillingYearService } from '@/lib/BillingYearService.js';
import { toExactCents } from '@/lib/household-money.js';
import { getHouseholdFinancials, calculateSettlementMetrics } from '@/lib/calculations.js';
import { computePriceChange, buildTrueUpRecords, snapshotExistingCredit, existingCreditCoverage, computeEnded } from '@/lib/year-end-review.js';

function clearStore() {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    setDocCalls.length = 0;
    mockBatchControl.failNextCommit = false;
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

        it('persists valid carry with an unadmitted null credit row and preserves the original raw ledger', async () => {
            seedPriorYear();
            const creditAdjustments = Object.freeze([null]);
            const payment = Object.freeze({ id: 'one-dollar', memberId: 1, amount: 1, receivedAt: '2026-01-01', method: 'cash' });
            svc._setState({ familyMembers: [svc.getState().familyMembers[0]], bills: [],
                payments: [payment], creditAdjustments, owedAdjustments: [] });
            await svc.createYear('2027');
            const priorWrite = setDocCalls.find(call => call.path === 'users/user-1/billingYears/2026' && call.data.creditAdjustments);
            const nextWrite = setDocCalls.find(call => call.path === 'users/user-1/billingYears/2027' && call.data.owedAdjustments);
            expect(priorWrite.data.creditAdjustments[0]).toBeNull();
            expect(priorWrite.data.creditAdjustments).toHaveLength(2);
            expect(priorWrite.data.creditAdjustments[1]).toMatchObject({ memberId: 1, type: 'carry_forward', amount: 1 });
            expect(nextWrite.data.owedAdjustments).toEqual([expect.objectContaining({ memberId: 1, kind: 'carry_opening', amount: -1 })]);
            expect(svc.getState().activeYear.id).toBe('2027');
            expect(creditAdjustments).toEqual([null]);
            expect(payment).toEqual({ id: 'one-dollar', memberId: 1, amount: 1, receivedAt: '2026-01-01', method: 'cash' });
        });

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

        // ── atomic + queue-serialized rollover (#330 P1) ──────────────
        it('commits the new-year seed and prior-year marking atomically via a writeBatch', async () => {
            const { writeBatch } = await import('firebase/firestore');
            writeBatch.mockClear();
            seedPriorYear();
            await svc.createYear('2027');

            // Exactly one batch for the rollover, carrying BOTH writes.
            expect(writeBatch).toHaveBeenCalledTimes(1);
            const newYearWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2027' && c.data.familyMembers
            );
            const priorWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2026' && c.data.creditAdjustments
            );
            expect(newYearWrite).toBeDefined();
            expect(priorWrite).toBeDefined();
            // Both landed through the batch path, not bare setDoc.
            expect(newYearWrite.batched).toBe(true);
            expect(priorWrite.batched).toBe(true);
        });

        it('serializes the rollover behind pending saves (queued prior-year save runs first)', async () => {
            seedPriorYear();
            const order = [];
            // A pending full-document save of the prior/active year enqueued BEFORE
            // createYear. It must complete first; the carry-marked write then supersedes it.
            svc._saveQueue.enqueue(async () => { order.push('pending-save'); });
            await svc.createYear('2027');
            order.push('rollover-committed');

            // FIFO: the pre-existing save ran before the rollover batch committed.
            expect(order).toEqual(['pending-save', 'rollover-committed']);
            // And the carry-marked prior-year write is the LAST write to 2026 (supersedes
            // any queued pre-carry save of the same doc).
            const priorWrites = setDocCalls.filter(c => c.path === 'users/user-1/billingYears/2026');
            const last = priorWrites[priorWrites.length - 1];
            expect((last.data.creditAdjustments || []).some(a => a.type === 'carry_forward')).toBe(true);
        });

        it('is atomic: a failed prior-year commit leaves NO new-year doc and rejects', async () => {
            seedPriorYear();
            // Remove the pre-seeded destination so we can assert it is NOT created.
            delete mockStore['users/user-1/billingYears/2027'];
            mockBatchControl.failNextCommit = true;

            await expect(svc.createYear('2027')).rejects.toThrow('simulated batch commit failure');

            // Neither the new-year seed nor the prior-year marking persisted.
            expect(mockStore['users/user-1/billingYears/2027']).toBeUndefined();
            const committed = setDocCalls.filter(c => c.batched);
            expect(committed).toHaveLength(0);
        });
    });

    // ── createYear: Year-End Review reconciliation path (#606, ADR 0009 § 3) ──
    describe('createYear — Year-End Review reconciliation', () => {
        const PRIOR = 'users/user-1/billingYears/2026';
        const NEXT = 'users/user-1/billingYears/2027';
        // The wireframe sample year: nine members in five households, every household paid in full.
        const MEMBERS = [
            { id: 1, name: 'Ada Okafor', linkedMembers: [2, 3] }, { id: 2, name: 'Erik Okafor', linkedMembers: [] },
            { id: 3, name: 'Kenji Okafor', linkedMembers: [] }, { id: 4, name: 'Dede Lindqvist', linkedMembers: [5] },
            { id: 5, name: 'Maja Lindqvist', linkedMembers: [] }, { id: 6, name: 'Rosa Diaz', linkedMembers: [7] },
            { id: 7, name: 'Sam Diaz', linkedMembers: [] }, { id: 8, name: 'Priya Natarajan', linkedMembers: [] },
            { id: 9, name: 'Tomas Berg', linkedMembers: [] }
        ].map(member => ({ email: '', phone: '', avatar: '', paymentReceived: 0, ...member }));
        const NORTHLINE = { id: 101, name: 'Northline Mobile', amount: 180, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
        const PINECONE = { id: 102, name: 'Pinecone Vault', amount: 12, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2, 3] };
        const GLACIER = { id: 103, name: 'Glacier Streaming', amount: 30, billingFrequency: 'monthly', logo: '', website: '', members: [4, 5, 6] };
        // Household totals: Okafor 720 + 144, Lindqvist 480 + 240, Diaz 480 + 120, Priya 240, Tomas 240.
        const PAID = { 1: 864, 4: 720, 6: 600, 8: 240, 9: 240 };
        const MAJA_FEE = { id: 'oadj_maja_fee', memberId: 5, kind: 'usage_charge', amount: 30, description: 'Activation fee',
            incurredDate: '2026-11-03', status: 'deferred', createdAt: '2026-11-03T09:00:00.000Z' };

        function seedReview({ status = 'open', owedAdjustments = [], billingEvents = [] } = {}) {
            svc._user = TEST_USER;
            svc._setState({
                billingYears: [{ id: '2026', label: '2026', status }],
                activeYear: { id: '2026', label: '2026', status, createdAt: null, archivedAt: null },
                familyMembers: structuredClone(MEMBERS),
                bills: structuredClone([NORTHLINE, PINECONE, GLACIER]),
                payments: Object.entries(PAID).map(([memberId, amount]) => ({ id: 'pay_' + memberId, memberId: Number(memberId),
                    amount, receivedAt: '2026-01-15', note: '', method: 'cash' })),
                creditAdjustments: [],
                owedAdjustments: structuredClone(owedAdjustments),
                billingEvents: structuredClone(billingEvents),
                settings: { emailMessage: '', emailSubject: '', paymentLinks: [], paymentMethods: [] }
            });
            return structuredClone(svc.getState());
        }
        const review = (fields = {}) => ({ reconciliationId: 'rec-2026-a', sourceYearId: '2026', sourceFingerprint: 'yer1_reviewed',
            trueUps: [], serviceCredits: [], usageCharges: [], billOverrides: {}, endedBillIds: [], newBills: [],
            confirmations: { noBillChanges: false, noNewSubscriptions: false, noExtraCharges: false }, ...fields });
        const sourceOf = (state, doc) => ({ familyMembers: state.familyMembers, bills: state.bills, payments: state.payments,
            creditAdjustments: doc ? doc.creditAdjustments : state.creditAdjustments, owedAdjustments: doc ? doc.owedAdjustments : state.owedAdjustments });
        const households = state => state.familyMembers.filter(member => !state.familyMembers.some(other => other.linkedMembers.includes(member.id)));
        const events = (docData, type) => docData.billingEvents.filter(event => event.eventType === type);
        const seedFor = (docData, primaryId) => docData.owedAdjustments.find(row => row.kind === 'carry_opening' && row.memberId === primaryId);

        it('fixture 1: nine True-ups born carried_forward, 2026 settlement unchanged, 2027 seeds and price', async () => {
            const { writeBatch } = await import('firebase/firestore');
            writeBatch.mockClear();
            const before = seedReview();
            // The page's own amount is ignored: every record is rebuilt from the inputs.
            await svc.createYear('2027', { reconciliation: review({ trueUps: [{ billId: 101, newAmount: 198, firstMonth: '2026-07', amount: 999 }] }) });

            expect(writeBatch).toHaveBeenCalledTimes(1);
            const prior = mockStore[PRIOR];
            const next = mockStore[NEXT];
            const trueUps = prior.owedAdjustments.filter(row => row.trueUpId);
            expect(trueUps).toHaveLength(9);
            for (const [index, record] of trueUps.entries()) {
                expect(record).toMatchObject({ id: 'oadj_tu_2026_tu_2026_101_' + (index + 1), memberId: index + 1, trueUpId: 'tu_2026_101',
                    billId: 101, billName: 'Northline Mobile', kind: 'usage_charge', basis: 'price_change', amount: 12,
                    status: 'carried_forward', carriedForwardTo: '2027', reconciliationId: 'rec-2026-a', incurredDate: '2026-07-01',
                    description: 'Northline Mobile went from $180 to $198 a month in July. Your share of 6 months: $12.00.' });
                expect(record.calc).toMatchObject({ frequency: 'monthly', fromMonthly: 180, toMonthly: 198, firstMonth: '2026-07', months: 6,
                    computed: 108, gross: 108, overridden: false, recorded: 108, share: 12 });
            }
            // 2026 settlement metrics identical before and after Start.
            const metrics = state => calculateSettlementMetrics(state.familyMembers, state.bills, state.payments, state.creditAdjustments, null, state.owedAdjustments);
            const after = { ...before, creditAdjustments: prior.creditAdjustments, owedAdjustments: prior.owedAdjustments };
            expect(metrics(after).cents).toEqual(metrics(before).cents);
            for (const member of households(before)) {
                expect(getHouseholdFinancials(member, sourceOf(after)).cents).toEqual(getHouseholdFinancials(member, sourceOf(before)).cents);
            }
            expect(prior.bills).toEqual(before.bills);
            // 2027 seeds carry +$12.00 per Northline member at the household grain.
            const okafor = seedFor(next, 1);
            expect(okafor).toMatchObject({ id: 'coadj_2026_1', amount: 36, fromYear: '2026', status: 'carried_in' });
            expect(okafor.items.map(item => [item.sourceId, item.memberId, item.amount, item.basis])).toEqual(
                [1, 2, 3].map(memberId => ['oadj_tu_2026_tu_2026_101_' + memberId, memberId, 12, 'price_change']));
            expect(seedFor(next, 4).items.map(item => item.memberId)).toEqual([4, 5]);
            expect(next.owedAdjustments.map(seed => seed.amount)).toEqual([36, 24, 24, 12, 12]);
            // 2027 Northline is $198/mo with its rollover event.
            expect(next.bills.find(bill => bill.id === 101)).toMatchObject({ amount: 198, billingFrequency: 'monthly', members: NORTHLINE.members });
            expect(events(next, 'BILL_PRICE_ROLLED_OVER').map(event => event.payload)).toEqual([{ billId: 101, billName: 'Northline Mobile',
                previousValue: 180, newValue: 198, billingFrequency: 'monthly', fromYear: '2026' }]);
            // Events on both documents.
            expect(events(prior, 'TRUE_UP_RECORDED').map(event => event.payload)).toEqual([expect.objectContaining({ trueUpId: 'tu_2026_101',
                billId: 101, basis: 'price_change', amount: 108, memberCount: 9, memberIds: NORTHLINE.members, reconciliationId: 'rec-2026-a' })]);
            expect(events(prior, 'YEAR_CARRIED_FORWARD')[0].payload).toMatchObject({ toYear: '2027', memberCount: 5, totalOpeningBalance: 108,
                reconciliationId: 'rec-2026-a', itemCount: 9 });
            const rolled = events(prior, 'YEAR_ROLLED_OVER');
            expect(rolled).toHaveLength(1);
            expect(rolled[0].payload).toMatchObject({ toYear: '2027', reconciliationId: 'rec-2026-a', trueUpCount: 1, serviceCreditCount: 0,
                coveredCount: 0, usageChargeCount: 0, priceChangeCount: 1, endedCount: 0, newBillCount: 0 });
            expect(rolled[0].payload.payloadFingerprint).toMatch(/^yrp1_[0-9a-f]{16}$/);
            expect(events(next, 'YEAR_CREATED_FROM_REVIEW')[0].payload).toEqual({ fromYear: '2026', reconciliationId: 'rec-2026-a',
                payloadFingerprint: rolled[0].payload.payloadFingerprint, householdCount: 5, carriedTotal: 108 });
            expect(svc.getState().activeYear.id).toBe('2027');
        });

        it('fixture 3: the late start is a True-up; 2026 bills unchanged; 2027 has the new bill', async () => {
            const before = seedReview();
            const lumen = { rowId: 'row-lumen', billId: 104, name: 'Lumen Fiber Backup', amount: 9.99, frequency: 'monthly',
                website: 'https://lumen.example', members: [3, 4, 7], firstMonth: '2026-09' };
            await svc.createYear('2027', { reconciliation: review({ newBills: [lumen] }) });
            const prior = mockStore[PRIOR];
            const next = mockStore[NEXT];
            expect(prior.bills).toEqual(before.bills);
            expect(next.bills.find(bill => bill.id === 104)).toMatchObject({ name: 'Lumen Fiber Backup', amount: 9.99,
                billingFrequency: 'monthly', website: 'https://lumen.example', members: [3, 4, 7] });
            expect(events(next, 'BILL_CREATED').map(event => event.payload)).toEqual([{ billId: 104, billName: 'Lumen Fiber Backup',
                amount: 9.99, billingFrequency: 'monthly', website: 'https://lumen.example', source: 'year_end_review',
                firstMonth: '2026-09', reconciliationId: 'rec-2026-a' }]);
            const trueUps = prior.owedAdjustments.filter(row => row.trueUpId === 'tu_2026_new_104');
            expect(trueUps.map(row => [row.id, row.memberId, row.amount, row.status, row.basis])).toEqual([3, 4, 7].map(memberId =>
                ['oadj_tu_2026_tu_2026_new_104_' + memberId, memberId, 13.32, 'carried_forward', 'late_start']));
            const carried = next.owedAdjustments.flatMap(seed => seed.items).filter(item => item.basis === 'late_start');
            expect(carried.reduce((sum, item) => sum + toExactCents(item.amount), 0)).toBe(3996);
            expect(events(prior, 'TRUE_UP_RECORDED')[0].payload).toMatchObject({ trueUpId: 'tu_2026_new_104', basis: 'late_start', amount: 39.96 });
            expect(events(prior, 'YEAR_ROLLED_OVER')[0].payload).toMatchObject({ trueUpCount: 1, newBillCount: 1, priceChangeCount: 0 });
        });

        it.each(['open', 'settling', 'closed'])('fixture 4 from a %s source: a price-decrease Service Credit, disposed by the carry', async status => {
            const before = seedReview({ status });
            await svc.createYear('2027', { reconciliation: review({ serviceCredits: [{ billId: 103, basis: 'price_change', newAmount: 24, firstMonth: '2026-10' }] }) });
            const prior = mockStore[PRIOR];
            const next = mockStore[NEXT];
            expect(prior.status).toBe(status);
            const credits = prior.owedAdjustments.filter(row => row.kind === 'service_credit');
            expect(credits.map(row => [row.id, row.memberId, row.amount, row.status, row.basis])).toEqual([4, 5, 6].map(memberId =>
                ['oadj_sc_2026_price_change_103_' + memberId, memberId, 6, 'active', 'price_change']));
            expect(credits[0].calc).toMatchObject({ fromMonthly: 30, toMonthly: 24, months: 3, computed: 18, gross: 18, recorded: 18, coveredBy: [] });
            // The resulting Credits are carried (disposed) in the same commit: every household still Settled, none Outstanding.
            expect(prior.creditAdjustments.map(row => [row.id, row.type, row.amount, row.toYear])).toEqual([
                ['cadj_carry_2027_4', 'carry_forward', 12, '2027'], ['cadj_carry_2027_6', 'carry_forward', 6, '2027']]);
            for (const member of households(before)) {
                const result = getHouseholdFinancials(member, sourceOf(before, prior));
                expect([member.id, result.cents.balance, result.cents.credit]).toEqual([member.id, 0, 0]);
            }
            const lindqvist = seedFor(next, 4).items[0];
            expect(lindqvist).toMatchObject({ kind: 'credit', sourceId: 'cadj_carry_2027_4', amount: -12 });
            expect(lindqvist.detail.map(row => [row.sourceId, row.amount])).toEqual([['oadj_sc_2026_price_change_103_4', -6], ['oadj_sc_2026_price_change_103_5', -6]]);
            expect(next.bills.find(bill => bill.id === 103).amount).toBe(24);
            expect(events(prior, 'SERVICE_CREDIT_RECORDED')[0].payload).toMatchObject({ billId: 103, amount: 18, basis: 'price_change',
                memberCount: 3, coveredBy: [], reconciliationId: 'rec-2026-a',
                shares: [{ memberId: 4, amount: 6 }, { memberId: 5, amount: 6 }, { memberId: 6, amount: 6 }] });
        });

        it.each(['open', 'closed'])('fixture 5 from a %s source: the ended bill credits the household and leaves 2027', async status => {
            const before = seedReview({ status });
            await svc.createYear('2027', { reconciliation: review({ endedBillIds: [102],
                serviceCredits: [{ billId: 102, basis: 'ended', lastMonth: '2026-08' }] }) });
            const prior = mockStore[PRIOR];
            const next = mockStore[NEXT];
            const credits = prior.owedAdjustments.filter(row => row.kind === 'service_credit');
            expect(credits.map(row => [row.memberId, row.amount, row.basis, row.calc.months, row.incurredDate])).toEqual(
                [1, 2, 3].map(memberId => [memberId, 16, 'ended', 4, '2026-08-01']));
            expect(next.bills.map(bill => bill.id)).toEqual([101, 103]);
            expect(prior.bills).toEqual(before.bills);
            const okafor = seedFor(next, 1);
            expect(okafor.amount).toBe(-48);
            expect(okafor.items).toHaveLength(1);
            expect(okafor.items[0]).toMatchObject({ kind: 'credit', amount: -48, sourceId: 'cadj_carry_2027_1' });
            expect(okafor.items[0].detail.map(row => row.amount)).toEqual([-16, -16, -16]);
            expect(getHouseholdFinancials(before.familyMembers[0], sourceOf(before, prior)).cents).toMatchObject({ balance: 0, credit: 0 });
            expect(events(prior, 'YEAR_ROLLED_OVER')[0].payload).toMatchObject({ serviceCreditCount: 1, endedCount: 1 });
        });

        it('fixture 8d: a change fully covered by existing credits records nothing and writes SERVICE_CREDIT_COVERED', async () => {
            const existing = [1, 2, 3].map(memberId => ({ id: 'oadj_cancel_' + memberId, memberId, billId: 102, kind: 'service_credit',
                amount: 16, reason: 'Cancelled early', incurredDate: '2026-09-02', status: 'active', createdAt: '2026-09-02T00:00:00.000Z' }));
            seedReview({ owedAdjustments: existing });
            const computed = computeEnded(PINECONE, { lastMonth: '2026-08' }, { sourceYear: '2026', skipExistingCredits: true });
            const existingCredits = Object.fromEntries(existing.map(record => [record.id, { choice: 'covers',
                seen: snapshotExistingCredit(record), coverage: existingCreditCoverage(computed, record.memberId) }]));
            await svc.createYear('2027', { reconciliation: review({ endedBillIds: [102],
                serviceCredits: [{ billId: 102, basis: 'ended', lastMonth: '2026-08', existingCredits }] }) });
            const prior = mockStore[PRIOR];
            expect(prior.owedAdjustments.filter(row => row.kind === 'service_credit').map(row => row.id)).toEqual(existing.map(row => row.id));
            expect(events(prior, 'SERVICE_CREDIT_RECORDED')).toHaveLength(0);
            expect(events(prior, 'SERVICE_CREDIT_COVERED')[0].payload).toMatchObject({ billId: 102, basis: 'ended',
                coveredBy: existing.map(row => ({ adjustmentId: row.id, memberId: row.memberId, appliedAmount: 16 })) });
            expect(events(prior, 'YEAR_ROLLED_OVER')[0].payload).toMatchObject({ coveredCount: 1, serviceCreditCount: 0 });
            expect(mockStore[NEXT].bills.map(bill => bill.id)).toEqual([101, 103]);
        });

        it('rejects a missing existing-credit answer before any write', async () => {
            seedReview({ owedAdjustments: [{ id: 'oadj_cancel_2', memberId: 2, billId: 102, kind: 'service_credit', amount: 16,
                reason: 'Cancelled early', incurredDate: '2026-09-02', status: 'active', createdAt: '2026-09-02T00:00:00.000Z' }] });
            await expect(svc.createYear('2027', { reconciliation: review({ endedBillIds: [102],
                serviceCredits: [{ billId: 102, basis: 'ended', lastMonth: '2026-08' }] }) })).rejects.toThrow(/oadj_cancel_2/);
            expect(mockStore[PRIOR]).toBeUndefined();
            expect(mockStore[NEXT]).toBeUndefined();
        });

        it('fixture 6: an existing deferred charge listed in the review is carried once, never re-recorded', async () => {
            seedReview({ owedAdjustments: [MAJA_FEE] });
            await svc.createYear('2027', { reconciliation: review({ usageCharges: [{ existingAdjustmentId: 'oadj_maja_fee' },
                { rowId: 'row-fee', memberId: 9, amount: 15, description: 'Replacement SIM', incurredDate: '2026-12-01' }] }) });
            const prior = mockStore[PRIOR];
            const next = mockStore[NEXT];
            expect(prior.owedAdjustments.filter(row => row.id === 'oadj_maja_fee')).toEqual([{ ...MAJA_FEE, status: 'carried_forward', carriedForwardTo: '2027' }]);
            expect(prior.owedAdjustments.find(row => row.id === 'oadj_uc_2026_row-fee')).toMatchObject({ memberId: 9, amount: 15,
                status: 'carried_forward', reconciliationId: 'rec-2026-a' });
            expect(prior.owedAdjustments).toHaveLength(2);
            expect(seedFor(next, 4).items).toEqual([expect.objectContaining({ sourceId: 'oadj_maja_fee', memberId: 5, amount: 30, basis: 'member' })]);
            expect(events(prior, 'USAGE_CHARGE_RECORDED').map(event => event.payload.adjustmentId)).toEqual(['oadj_uc_2026_row-fee']);
            expect(events(prior, 'USAGE_CHARGE_RECORDED')[0].payload).toMatchObject({ memberName: 'Tomas Berg', reconciliationId: 'rec-2026-a' });
        });

        it('rejects re-recording an existing deferred charge or reusing a charge that is not deferred', async () => {
            seedReview({ owedAdjustments: [MAJA_FEE, { ...MAJA_FEE, id: 'oadj_billed', status: 'billed' }] });
            await expect(svc.createYear('2027', { reconciliation: review({ usageCharges: [{ ...MAJA_FEE, rowId: 'row-x' }] }) }))
                .rejects.toThrow(/reused, never recorded again/);
            await expect(svc.createYear('2027', { reconciliation: review({ usageCharges: [{ existingAdjustmentId: 'oadj_billed' }] }) }))
                .rejects.toThrow(/not a deferred Usage Charge/);
            expect(mockStore[PRIOR]).toBeUndefined();
        });

        it('"Nothing changed" writes YEAR_ROLLED_OVER and the itemized carry and no new adjustment record', async () => {
            const before = seedReview({ owedAdjustments: [MAJA_FEE] });
            await svc.createYear('2027', { reconciliation: review({ usageCharges: [{ existingAdjustmentId: 'oadj_maja_fee' }],
                confirmations: { noBillChanges: true, noNewSubscriptions: true, noExtraCharges: true } }) });
            const prior = mockStore[PRIOR];
            const next = mockStore[NEXT];
            expect(prior.owedAdjustments.map(row => row.id)).toEqual(before.owedAdjustments.map(row => row.id));
            expect(prior.creditAdjustments).toEqual([]);
            expect(prior.billingEvents.map(event => event.eventType)).toEqual(['YEAR_CARRIED_FORWARD', 'YEAR_ROLLED_OVER']);
            expect(events(prior, 'YEAR_ROLLED_OVER')[0].payload).toMatchObject({ trueUpCount: 0, serviceCreditCount: 0, coveredCount: 0,
                usageChargeCount: 0, priceChangeCount: 0, endedCount: 0, newBillCount: 0 });
            expect(next.owedAdjustments).toEqual([expect.objectContaining({ memberId: 4, amount: 30,
                items: [expect.objectContaining({ sourceId: 'oadj_maja_fee', amount: 30 })] })]);
            expect(next.bills.map(bill => [bill.id, bill.amount])).toEqual([[101, 180], [102, 12], [103, 30]]);
            expect(next.billingEvents.map(event => event.eventType)).toEqual(['YEAR_CREATED_FROM_REVIEW']);
        });

        it('writes the source year with YEAR_ROLLED_OVER even when nothing carries', async () => {
            seedReview();
            await svc.createYear('2027', { reconciliation: review() });
            const prior = mockStore[PRIOR];
            expect(prior.billingEvents.map(event => event.eventType)).toEqual(['YEAR_ROLLED_OVER']);
            expect(mockStore[NEXT].owedAdjustments).toEqual([]);
        });

        it('applies next-year price overrides and records them as BILL_PRICE_ROLLED_OVER', async () => {
            seedReview();
            await svc.createYear('2027', { reconciliation: review({ billOverrides: { 102: 14 },
                trueUps: [{ billId: 101, newAmount: 198, firstMonth: '2026-07' }] }) });
            const next = mockStore[NEXT];
            expect(next.bills.map(bill => [bill.id, bill.amount])).toEqual([[101, 198], [102, 14], [103, 30]]);
            expect(events(next, 'BILL_PRICE_ROLLED_OVER').map(event => [event.payload.billId, event.payload.newValue])).toEqual([[101, 198], [102, 14]]);
        });

        it('fixture 10f: an unused incoming credit carries with no carry_forward record; the source stays Settled', async () => {
            svc._user = TEST_USER;
            const incoming = { id: 'coadj_2025_1', memberId: 1, kind: 'carry_opening', status: 'carried_in', fromYear: '2025', amount: -132 };
            svc._setState({ billingYears: [{ id: '2026', label: '2026', status: 'open' }],
                activeYear: { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null },
                familyMembers: [{ id: 1, name: 'Ada', linkedMembers: [] }], bills: [], payments: [], creditAdjustments: [],
                owedAdjustments: [incoming], billingEvents: [], settings: { emailMessage: '', paymentLinks: [], paymentMethods: [] } });
            const before = structuredClone(svc.getState());
            await svc.createYear('2027', { reconciliation: review() });
            const prior = mockStore[PRIOR];
            expect(prior.creditAdjustments).toEqual([]);
            expect(prior.owedAdjustments).toEqual([{ ...incoming, carriedForwardTo: '2027' }]);
            const member = before.familyMembers[0];
            expect(getHouseholdFinancials(member, sourceOf(before, prior)).cents).toEqual(getHouseholdFinancials(member, sourceOf(before)).cents);
            expect(getHouseholdFinancials(member, sourceOf(before, prior)).cents).toMatchObject({ owed: 0, N: 0, balance: 0, credit: 0 });
            const seed = mockStore[NEXT].owedAdjustments[0];
            expect(seed).toMatchObject({ amount: -132, items: [{ kind: 'credit', sourceId: 'coadj_2025_1', amount: -132,
                detail: [{ kind: 'unused', description: 'Unused 2026 credit', amount: -132 }] }] });
        });

        it('rejects an Archived source year, a payload without its id or for another year, before any write', async () => {
            seedReview({ status: 'archived' });
            await expect(svc.createYear('2027', { reconciliation: review() })).rejects.toThrow(/archived billing year cannot be rolled over/);
            seedReview();
            await expect(svc.createYear('2027', { reconciliation: {} })).rejects.toThrow(/reconciliation id/);
            await expect(svc.createYear('2027', { reconciliation: null })).rejects.toThrow(/payload is invalid/);
            await expect(svc.createYear('2027', { reconciliation: review({ sourceYearId: '2025' }) })).rejects.toThrow(/another billing year/);
            await expect(svc.createYear('2027', { reconciliation: review({ trueUps: [{ billId: 103, newAmount: 24, firstMonth: '2026-10' }] }) }))
                .rejects.toThrow(/Service Credit, not a True-up/);
            await expect(svc.createYear('2027', { reconciliation: review({ serviceCredits: [{ billId: 102, basis: 'ended', lastMonth: '2026-08' }] }) }))
                .rejects.toThrow(/not listed as ended/);
            expect(mockStore[PRIOR]).toBeUndefined();
            expect(mockStore[NEXT]).toBeUndefined();
        });

        it('keeps an omitted or undefined reconciliation on the legacy path', async () => {
            seedReview({ owedAdjustments: [MAJA_FEE] });
            await svc.createYear('2027', { reconciliation: undefined });
            const prior = mockStore[PRIOR];
            expect(prior.billingEvents.map(event => event.eventType)).toEqual(['YEAR_CARRIED_FORWARD']);
            expect(prior.billingEvents[0].payload).toEqual({ toYear: '2027', memberCount: 1, totalOpeningBalance: 30 });
            expect(mockStore[NEXT].owedAdjustments[0].items).toBeUndefined();
            expect(mockStore[NEXT].billingEvents).toEqual([]);
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
            // Own-parent Notice policy depends on this writer persisting whole cents.
            expect(charge.amount).toBe(toExactCents(charge.amount) / 100);
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

    // ── recordServiceCredit (#321) ────────────────────────────────────

    describe('recordServiceCredit', () => {
        // Internet bill (id 101) is split among members 1 and 2.
        function seedOpenYear(extra = {}) {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2025', label: '2025', status: 'open' },
                familyMembers: [
                    { id: 1, name: 'Alice', linkedMembers: [] },
                    { id: 2, name: 'Bob', linkedMembers: [] },
                    { id: 3, name: 'Carol', linkedMembers: [] }
                ],
                bills: [
                    { id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2] },
                    { id: 102, name: 'Streaming', amount: 20, billingFrequency: 'monthly', logo: '', website: '', members: [1] }
                ],
                payments: [], creditAdjustments: [], owedAdjustments: [],
                billingEvents: [],
                settings: { emailMessage: '', paymentLinks: [], paymentMethods: [] },
                ...extra
            });
        }

        it('records a bill-level credit split evenly among the bill members', () => {
            seedOpenYear();
            const records = svc.recordServiceCredit({ billId: 101, amount: 90, reason: 'Outage refund' });

            // Bill 101 has 2 members → 45 each
            expect(Array.isArray(records)).toBe(true);
            expect(records.length).toBe(2);
            const { owedAdjustments } = svc.getState();
            expect(owedAdjustments.length).toBe(2);
            for (const r of owedAdjustments) {
                expect(r.kind).toBe('service_credit');
                expect(r.status).toBe('active');
                expect(r.billId).toBe(101);
                expect(r.reason).toBe('Outage refund');
                expect(r.amount).toBeCloseTo(45, 5);
                expect(typeof r.id).toBe('string');
                expect(r.createdAt).toBeTruthy();
            }
            expect(owedAdjustments.map(r => r.memberId).sort()).toEqual([1, 2]);
        });

        it('splits an indivisible amount with the last member absorbing the remainder (sums exactly)', () => {
            seedOpenYear();
            // 10.00 across 3 members would be 3.333… — use a bill with 2 members and an odd cent.
            const records = svc.recordServiceCredit({ billId: 101, amount: 10.01, reason: 'Odd split' });
            const total = records.reduce((s, r) => s + r.amount, 0);
            expect(Math.round(total * 100) / 100).toBeCloseTo(10.01, 5); // no money lost or created
            // First member gets the floor share, the last absorbs the remainder.
            expect(records.length).toBe(2);
        });

        it('records a per-member credit when a memberId is supplied (one-person issue)', () => {
            seedOpenYear();
            const records = svc.recordServiceCredit({ billId: 101, memberId: 2, amount: 30, reason: 'Bob-only issue' });
            expect(records.length).toBe(1);
            expect(records[0].memberId).toBe(2);
            expect(records[0].amount).toBeCloseTo(30, 5);
            expect(records[0].billId).toBe(101);
            expect(svc.getState().owedAdjustments.length).toBe(1);
        });

        it('does NOT edit the bill — amount and members are unchanged (Option B)', () => {
            seedOpenYear();
            const before = JSON.parse(JSON.stringify(svc.getState().bills.find(b => b.id === 101)));
            svc.recordServiceCredit({ billId: 101, amount: 50, reason: 'No bill edit' });
            const after = svc.getState().bills.find(b => b.id === 101);
            expect(after).toEqual(before); // bill history stays honest
        });

        it('normalizes decimal edge-case amounts to persisted cents', () => {
            seedOpenYear();
            // Per-member path avoids split rounding so we can assert the cents normalization directly.
            const records = svc.recordServiceCredit({ billId: 102, memberId: 1, amount: '1.005', reason: 'Rounding edge' });
            expect(records[0].amount).toBe(1.01);
            expect(svc.getState().owedAdjustments[0].amount).toBe(1.01);
        });

        it('defaults incurredDate to the local date when omitted', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2025, 4, 6, 12, 0, 0));
            try {
                seedOpenYear();
                const records = svc.recordServiceCredit({ billId: 102, memberId: 1, amount: 5, reason: 'Date fallback' });
                expect(records[0].incurredDate).toBe('2025-05-06');
            } finally {
                vi.useRealTimers();
            }
        });

        it('emits a SERVICE_CREDIT_RECORDED billing event (mirrors USAGE_CHARGE_RECORDED)', () => {
            seedOpenYear();
            svc.recordServiceCredit({ billId: 101, amount: 90, reason: 'Outage refund' });
            const evt = svc.getState().billingEvents.find(e => e.eventType === 'SERVICE_CREDIT_RECORDED');
            expect(evt).toBeDefined();
            expect(evt.payload.billId).toBe(101);
            expect(evt.payload.billName).toBe('Internet');
            expect(evt.payload.amount).toBeCloseTo(90, 5); // the gross bill-level amount
            expect(evt.payload.reason).toBe('Outage refund');
            expect(evt.actor.userId).toBe('user-1');
        });

        it('is append-only across multiple credits (never overwrites prior entries)', () => {
            seedOpenYear();
            svc.recordServiceCredit({ billId: 101, memberId: 1, amount: 5, reason: 'A' });
            svc.recordServiceCredit({ billId: 101, memberId: 1, amount: 7, reason: 'B' });
            expect(svc.getState().owedAdjustments.length).toBe(2);
        });

        it('persists via save() (full-document write includes the new credits)', async () => {
            seedOpenYear();
            svc.recordServiceCredit({ billId: 101, amount: 90, reason: 'Outage refund' });
            await svc.getSaveQueue()._chain;
            const write = setDocCalls.find(c => c.path === 'users/user-1/billingYears/2025');
            expect(write).toBeDefined();
            expect(write.data.owedAdjustments.length).toBe(2);
            expect(write.data.owedAdjustments[0].kind).toBe('service_credit');
        });

        it('lowers the affected members owed and yields a household credit when already paid', () => {
            seedOpenYear({
                payments: [{ id: 'pay_1', memberId: 1, amount: 840, receivedAt: '2025-01-01', note: '', method: 'cash' }]
            });
            // Alice (id 1) owes 840 (Internet 1200/yr ÷ 2 = 600, Streaming 20/mo = 240/yr).
            // She paid 840 (exactly settled). A 200 per-member service credit on Internet
            // lowers her owed to 640, so 200 is now owed back as a household Credit.
            svc.recordServiceCredit({ billId: 101, memberId: 1, amount: 200, reason: 'Big credit' });
            const { familyMembers, bills, payments, creditAdjustments, owedAdjustments } = svc.getState();

            const f = getHouseholdFinancials(familyMembers.find(m => m.id === 1), { familyMembers, bills, payments, creditAdjustments, owedAdjustments }, { reopenedAdjustmentIds: null });
            expect(f.owed).toBeCloseTo(640, 5); // 840 − 200
            expect(f.credit).toBeCloseTo(200, 5); // paid 840, owes 640 → 200 back
        });

        it('rejects a non-positive amount', () => {
            seedOpenYear();
            expect(() => svc.recordServiceCredit({ billId: 101, amount: 0, reason: 'x' })).toThrow(/amount/i);
            expect(() => svc.recordServiceCredit({ billId: 101, amount: -5, reason: 'x' })).toThrow(/amount/i);
        });

        it('requires a reason', () => {
            seedOpenYear();
            expect(() => svc.recordServiceCredit({ billId: 101, amount: 50, reason: '   ' })).toThrow(/reason/i);
        });

        it('throws when the bill does not exist', () => {
            seedOpenYear();
            expect(() => svc.recordServiceCredit({ billId: 999, amount: 50, reason: 'x' })).toThrow(/bill/i);
        });

        it('throws when the bill has no members to split across', () => {
            seedOpenYear({
                bills: [{ id: 103, name: 'Empty', amount: 50, billingFrequency: 'monthly', logo: '', website: '', members: [] }]
            });
            expect(() => svc.recordServiceCredit({ billId: 103, amount: 50, reason: 'x' })).toThrow(/member/i);
        });

        it('throws when a per-member target is not on the bill', () => {
            seedOpenYear();
            // Carol (3) is not on Internet (101)
            expect(() => svc.recordServiceCredit({ billId: 101, memberId: 3, amount: 10, reason: 'x' })).toThrow(/bill/i);
        });

        it('throws when the year is read-only (closed)', () => {
            seedOpenYear({ activeYear: { id: '2025', label: '2025', status: 'closed' } });
            expect(() => svc.recordServiceCredit({ billId: 101, amount: 5, reason: 'x' })).toThrow(/read-only/i);
        });
    });

    // ── billDeferredCharges (Charge Notice, #320) ─────────────────────

    describe('billDeferredCharges', () => {
        function seedWithCharges(extra = {}) {
            svc._user = TEST_USER;
            svc._setState({
                activeYear: { id: '2026', label: '2026', status: 'open' },
                familyMembers: [
                    { id: 1, name: 'Alice', linkedMembers: [3] },
                    { id: 2, name: 'Bob', linkedMembers: [] },
                    { id: 3, name: 'Carol', linkedMembers: [] }
                ],
                bills: [], payments: [], creditAdjustments: [],
                owedAdjustments: [
                    { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred', incurredDate: '2026-06-03', createdAt: 't1' },
                    { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 5, status: 'deferred', incurredDate: '2026-06-20', createdAt: 't2' },
                    { id: 'o3', memberId: 1, kind: 'usage_charge', amount: 7, status: 'deferred', incurredDate: '2026-05-15', createdAt: 't3' }
                ],
                billingEvents: [],
                settings: { emailMessage: '', paymentLinks: [], paymentMethods: [] },
                ...extra
            });
        }

        it.each([.005, .004])('uses selected own-parent cents without rewriting raw %s sources', amount => {
            const charges = ['a', 'b'].map((id, index) => ({ id, memberId: 1, kind: 'usage_charge', status: 'deferred', amount,
                incurredDate: index ? '2026-02-01' : '2026-01-01' }));
            seedWithCharges({ owedAdjustments: charges });
            const result = svc.billDeferredCharges({ memberId: 1 });
            expect(result.amount).toBe(.01);
            expect(svc.getState().owedAdjustments.map(row => row.amount)).toEqual([amount, amount]);
            expect(svc.getState().billingEvents.at(-1).payload.amount).toBe(.01);
            expect(getHouseholdFinancials(svc.getState().familyMembers[0], svc.getState()).cents.B).toBe(1);
        });

        it.each([{ amounts: [] }, { amounts: [0] }, { amounts: [0, 1] }])('rejects the complete confirmed $amounts set before event/state/save/persistence', ({ amounts }) => {
            seedWithCharges({ owedAdjustments: amounts.map((amount, index) => ({ id: `zero-${index}`, memberId: 1,
                kind: 'usage_charge', status: 'deferred', amount })) });
            const before = svc.getState();
            const original = structuredClone(before);
            const save = vi.spyOn(svc, 'save');
            const emit = vi.spyOn(svc, '_emitEvent');
            const writesBefore = setDocCalls.length;
            expect(() => svc.billDeferredCharges({ memberId: 1, chargeIds: before.owedAdjustments.map(row => row.id) })).toThrow();
            expect(svc.getState()).toBe(before);
            expect(svc.getState()).toEqual(original);
            expect(emit).not.toHaveBeenCalled();
            expect(save).not.toHaveBeenCalled();
            expect(setDocCalls).toHaveLength(writesBefore);
            expect(getHouseholdFinancials(before.familyMembers[0], before).ok).toBe(true);
        });

        it('refuses a newly held B candidate before event/state/save effects', () => {
            seedWithCharges({ owedAdjustments: [
                { id: 'already-billed', memberId: 1, kind: 'usage_charge', status: 'billed', amount: 60000000000000 },
                { id: 'pending', memberId: 1, kind: 'usage_charge', status: 'deferred', amount: 60000000000000 }
            ] });
            expect(getHouseholdFinancials(svc.getState().familyMembers[0], svc.getState()).ok).toBe(true);
            const before = svc.getState();
            const save = vi.spyOn(svc, 'save');
            expect(() => svc.billDeferredCharges({ memberId: 1 })).toThrow(/unavailable/);
            expect(svc.getState()).toBe(before);
            expect(save).not.toHaveBeenCalled();
        });

        it('keeps admitted signed deferred source unchanged when its billed candidate fails the existing B domain', () => {
            seedWithCharges({ owedAdjustments: [
                { id: 'a', memberId: 1, kind: 'usage_charge', status: 'deferred', amount: -.005 },
                { id: 'b', memberId: 1, kind: 'usage_charge', status: 'deferred', amount: .02 }
            ] });
            expect(getHouseholdFinancials(svc.getState().familyMembers[0], svc.getState()).ok).toBe(true);
            const before = svc.getState();
            const save = vi.spyOn(svc, 'save');
            expect(() => svc.billDeferredCharges({ memberId: 1 })).toThrow(/unavailable/);
            expect(svc.getState()).toBe(before);
            expect(save).not.toHaveBeenCalled();
        });

        it('allows separate half-cent Notices to total two cents while B is one cent', () => {
            seedWithCharges({ owedAdjustments: ['a', 'b'].map(id => ({ id, memberId: 1, kind: 'usage_charge', status: 'deferred', amount: .005 })) });
            const first = svc.billDeferredCharges({ memberId: 1, chargeIds: ['a'] });
            const second = svc.billDeferredCharges({ memberId: 1, chargeIds: ['b'] });
            expect(first.amount).toBe(.01);
            expect(second.amount).toBe(.01);
            expect(getHouseholdFinancials(svc.getState().familyMembers[0], svc.getState()).cents.B).toBe(1);
        });

        it.each([.004, NaN, Infinity, '1'])('refuses zero-target or invalid selection %s before status/event/save effects', amount => {
            seedWithCharges({ owedAdjustments: [{ id: 'a', memberId: 1, kind: 'usage_charge', status: 'deferred', amount }] });
            const before = svc.getState();
            const save = vi.spyOn(svc, 'save');
            expect(() => svc.billDeferredCharges({ memberId: 1 })).toThrow();
            expect(svc.getState()).toBe(before);
            expect(save).not.toHaveBeenCalled();
        });

        it('bills a household holding a deferred True-up like any other deferred Usage Charge (#606)', () => {
            // A standalone True-up primitive: the library's records, still deferred in an open year.
            const bill = { id: 101, name: 'Northline Mobile', amount: 180, billingFrequency: 'monthly', members: [1, 2, 3] };
            const result = computePriceChange(bill, { newAmount: 198, firstMonth: '2026-07' }, { sourceYear: '2026' });
            const trueUps = buildTrueUpRecords(result, { sourceYearId: '2026', reconciliationId: 'rec-standalone', now: '2026-11-04T10:00:00.000Z' });
            seedWithCharges({ bills: [bill], owedAdjustments: trueUps });
            const billed = svc.billDeferredCharges({ memberId: 1 });
            // Alice's household is Alice (1) plus Carol (3); Bob (2) is his own household.
            expect(billed.chargeIds.sort()).toEqual([trueUps[0].id, trueUps[2].id].sort());
            // ($198 − $180) × 6 months = $108.00 ÷ 3 members = $36.00 each; the household holds two shares.
            expect(billed.amount).toBe(72);
            const after = svc.getState().owedAdjustments;
            expect(after.filter(row => row.status === 'billed').map(row => row.id).sort()).toEqual(billed.chargeIds.sort());
            expect(after.find(row => row.memberId === 2).status).toBe('deferred');
            expect(after.find(row => row.memberId === 1)).toMatchObject({ basis: 'price_change', trueUpId: 'tu_2026_101', chargeNoticeId: billed.chargeNoticeId });
            expect(getHouseholdFinancials(svc.getState().familyMembers[0], svc.getState()).cents.B).toBe(7200);
        });

        it('flips all of a member deferred charges to billed and stamps the charge-notice id', () => {
            seedWithCharges();
            const result = svc.billDeferredCharges({ memberId: 1 });

            const { owedAdjustments } = svc.getState();
            expect(owedAdjustments.every(a => a.status === 'billed')).toBe(true);
            // Each billed record carries the linkage + a billedAt timestamp.
            owedAdjustments.forEach(a => {
                expect(a.chargeNoticeId).toBe(result.chargeNoticeId);
                expect(a.billedAt).toBeTruthy();
            });
            // The result reports what was billed.
            expect(result.chargeIds.sort()).toEqual(['o1', 'o2', 'o3']);
            expect(result.amount).toBeCloseTo(22, 5);
            expect(typeof result.chargeNoticeId).toBe('string');
        });

        it('bills only the charges in a given incurred-date range (the "this month" preset)', () => {
            seedWithCharges();
            const result = svc.billDeferredCharges({ memberId: 1, range: { from: '2026-06-01', to: '2026-06-30' } });
            expect(result.chargeIds.sort()).toEqual(['o1', 'o2']); // o3 (May) stays deferred
            const { owedAdjustments } = svc.getState();
            expect(owedAdjustments.find(a => a.id === 'o3').status).toBe('deferred');
            expect(owedAdjustments.find(a => a.id === 'o1').status).toBe('billed');
        });

        it('bills only an explicit subset when chargeIds is given', () => {
            seedWithCharges();
            const result = svc.billDeferredCharges({ memberId: 1, chargeIds: ['o2'] });
            expect(result.chargeIds).toEqual(['o2']);
            const { owedAdjustments } = svc.getState();
            expect(owedAdjustments.find(a => a.id === 'o2').status).toBe('billed');
            expect(owedAdjustments.find(a => a.id === 'o1').status).toBe('deferred');
        });

        it('bills a linked member charge when billing the household primary (ADR 0001 grain)', () => {
            // Alice (primary, id 1) links Carol (id 3). Carol has a deferred charge.
            // Billing the household must flip Carol's charge too, not just Alice's.
            seedWithCharges({
                owedAdjustments: [
                    { id: 'a1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred', incurredDate: '2026-06-03' },
                    { id: 'c1', memberId: 3, kind: 'usage_charge', amount: 20, status: 'deferred', incurredDate: '2026-06-04' }
                ]
            });
            const result = svc.billDeferredCharges({ memberId: 1, chargeIds: ['a1', 'c1'] });
            expect(result.chargeIds.sort()).toEqual(['a1', 'c1']);
            expect(result.amount).toBeCloseTo(30, 5);
            const { owedAdjustments } = svc.getState();
            expect(owedAdjustments.find(a => a.id === 'a1').status).toBe('billed');
            expect(owedAdjustments.find(a => a.id === 'c1').status).toBe('billed'); // linked member billed too
        });

        it('defaults to ALL of the household deferred charges (primary + linked)', () => {
            seedWithCharges({
                owedAdjustments: [
                    { id: 'a1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred', incurredDate: '2026-06-03' },
                    { id: 'c1', memberId: 3, kind: 'usage_charge', amount: 20, status: 'deferred', incurredDate: '2026-06-04' }
                ]
            });
            const result = svc.billDeferredCharges({ memberId: 1 });
            expect(result.chargeIds.sort()).toEqual(['a1', 'c1']);
            expect(result.amount).toBeCloseTo(30, 5);
        });

        it('does not touch another household charges', () => {
            seedWithCharges({
                owedAdjustments: [
                    { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred', incurredDate: '2026-06-03' },
                    { id: 'oX', memberId: 2, kind: 'usage_charge', amount: 99, status: 'deferred', incurredDate: '2026-06-03' }
                ]
            });
            svc.billDeferredCharges({ memberId: 1 });
            expect(svc.getState().owedAdjustments.find(a => a.id === 'oX').status).toBe('deferred');
        });

        it('emits a CHARGES_BILLED billing event (mirrors USAGE_CHARGE_RECORDED / REFUND_ISSUED)', () => {
            seedWithCharges();
            const result = svc.billDeferredCharges({ memberId: 1 });
            const evt = svc.getState().billingEvents.find(e => e.eventType === 'CHARGES_BILLED');
            expect(evt).toBeDefined();
            expect(evt.payload.memberId).toBe(1);
            expect(evt.payload.memberName).toBe('Alice');
            expect(evt.payload.amount).toBeCloseTo(22, 5);
            expect(evt.payload.chargeNoticeId).toBe(result.chargeNoticeId);
            expect(evt.payload.count).toBe(3);
            expect(evt.actor.userId).toBe('user-1');
        });

        it('is append-only: never deletes records, only flips status (ledger immutability)', () => {
            seedWithCharges();
            const before = svc.getState().owedAdjustments.length;
            svc.billDeferredCharges({ memberId: 1 });
            expect(svc.getState().owedAdjustments.length).toBe(before); // same records, new status
        });

        it('persists via save() (full-document write carries the billed status)', async () => {
            seedWithCharges();
            svc.billDeferredCharges({ memberId: 1 });
            await svc.getSaveQueue()._chain;
            const write = setDocCalls.find(c => c.path === 'users/user-1/billingYears/2026');
            expect(write).toBeDefined();
            expect(write.data.owedAdjustments.every(a => a.status === 'billed')).toBe(true);
            expect(write.data.owedAdjustments[0].chargeNoticeId).toBeTruthy();
        });

        it('does NOT touch the payments ledger', () => {
            seedWithCharges();
            svc.billDeferredCharges({ memberId: 1 });
            expect(svc.getState().payments).toEqual([]);
        });

        it('throws when there are no deferred charges to bill in the period', () => {
            seedWithCharges();
            expect(() => svc.billDeferredCharges({ memberId: 1, range: { from: '2030-01-01', to: '2030-12-31' } }))
                .toThrow(/no deferred charges|nothing/i);
        });

        it('throws when the member does not exist', () => {
            seedWithCharges();
            expect(() => svc.billDeferredCharges({ memberId: 999 })).toThrow(/member/i);
        });

        it('throws when the year is read-only (closed)', () => {
            seedWithCharges({ activeYear: { id: '2026', label: '2026', status: 'closed' } });
            expect(() => svc.billDeferredCharges({ memberId: 1 })).toThrow(/read-only/i);
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
