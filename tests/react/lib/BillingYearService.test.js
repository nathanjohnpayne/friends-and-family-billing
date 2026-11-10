import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Firestore mock ──────────────────────────────────────────────────────
// Tracks all setDoc calls and controls what getDoc/getDocs return.
const mockStore = {};
const setDocCalls = [];
// Out-of-band switch to force the next writeBatch().commit() to reject (atomicity test).
const mockBatchControl = { failNextCommit: false };
// runTransaction controls (#614): fail before commit, reject after committing (a lost
// response), replay the callback (SDK contention), or change the stored document
// between the read and the commit (another session).
const mockTxControl = { failNextCommit: null, rejectAfterCommit: null, replays: 0, beforeCommit: null, contention: null };

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
    // runTransaction mock: reads mockStore, buffers set() ops and applies them only
    // when the callback resolves (atomic), recording them in setDocCalls as
    // transactional writes. mockTxControl can replay the callback, fail the commit,
    // reject after the commit landed, or run a hook before the commit.
    runTransaction: vi.fn(async (_db, fn) => {
        const runs = 1 + mockTxControl.replays;
        mockTxControl.replays = 0;
        let result;
        let writes = [];
        const runOnce = async () => {
            writes = [];
            const tx = {
                get: async (ref) => {
                    const data = mockStore[ref.path];
                    return { exists: () => !!data, data: () => data || null };
                },
                set: (ref, data) => { writes.push({ ref, data }); return tx; },
                update: (ref, data) => { writes.push({ ref, data, merge: true }); return tx; }
            };
            result = await fn(tx);
        };
        for (let i = 0; i < runs; i++) await runOnce();
        if (mockTxControl.contention) {
            // Another writer commits between this transaction's read and its commit;
            // the SDK then re-runs the callback against the new state.
            const hook = mockTxControl.contention;
            mockTxControl.contention = null;
            await hook();
            await runOnce();
        }
        if (mockTxControl.beforeCommit) {
            const hook = mockTxControl.beforeCommit;
            mockTxControl.beforeCommit = null;
            await hook();
        }
        if (mockTxControl.failNextCommit) {
            const err = mockTxControl.failNextCommit;
            mockTxControl.failNextCommit = null;
            throw err;
        }
        for (const { ref, data, merge } of writes) {
            setDocCalls.push({ path: ref.path, data, transactional: true });
            mockStore[ref.path] = merge ? { ...(mockStore[ref.path] || {}), ...data } : data;
        }
        if (mockTxControl.rejectAfterCommit) {
            const err = mockTxControl.rejectAfterCommit;
            mockTxControl.rejectAfterCommit = null;
            throw err;
        }
        return result;
    }),
    serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__')
}));

import { BillingYearService } from '@/lib/BillingYearService.js';
import { toExactCents } from '@/lib/household-money.js';
import { getHouseholdFinancials } from '@/lib/calculations.js';

function clearStore() {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    setDocCalls.length = 0;
    mockBatchControl.failNextCommit = false;
    Object.assign(mockTxControl, { failNextCommit: null, rejectAfterCommit: null, replays: 0, beforeCommit: null, contention: null });
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

            // The destination is absent (#614: a creation never overwrites an existing
            // year); switchYear then loads the document the rollover created.
            await svc.createYear('2026');

            const yearWrite = setDocCalls.find(c => c.path === 'users/user-1/billingYears/2026');
            expect(yearWrite).toBeDefined();
            expect(yearWrite.data.createdAt).toBe('__SERVER_TIMESTAMP__');
            expect(yearWrite.data.rev).toBe(1);
            expect(svc.getState().activeYear.id).toBe('2026');
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
            // The destination is absent: the rollover creates it (never overwrites, #614)
            // and switchYear's loadYearData then finds the created document.
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
        it('commits the new-year seed and prior-year marking atomically in one version-checked transaction', async () => {
            const { writeBatch, runTransaction } = await import('firebase/firestore');
            writeBatch.mockClear();
            runTransaction.mockClear();
            seedPriorYear();
            await svc.createYear('2027');

            // Exactly one transaction for the rollover, carrying BOTH writes; no batch (#614).
            expect(runTransaction).toHaveBeenCalledTimes(1);
            expect(writeBatch).not.toHaveBeenCalled();
            const newYearWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2027' && c.data.familyMembers
            );
            const priorWrite = setDocCalls.find(c =>
                c.path === 'users/user-1/billingYears/2026' && c.data.creditAdjustments
            );
            expect(newYearWrite).toBeDefined();
            expect(priorWrite).toBeDefined();
            // Both landed through the transaction, not bare setDoc, each with its rev:
            // the destination is created at rev 1, the source advances from its own.
            expect(newYearWrite.transactional).toBe(true);
            expect(priorWrite.transactional).toBe(true);
            expect(newYearWrite.data.rev).toBe(1);
            expect(priorWrite.data.rev).toBe(1);
            expect(typeof newYearWrite.data.lastWriteId).toBe('string');
            expect(priorWrite.data.lastWriteId).toBe(newYearWrite.data.lastWriteId);
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
            mockTxControl.failNextCommit = new Error('simulated transaction commit failure');
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(svc.createYear('2027')).rejects.toThrow('simulated transaction commit failure');
            errSpy.mockRestore();

            // Neither the new-year seed nor the prior-year marking persisted.
            expect(mockStore['users/user-1/billingYears/2027']).toBeUndefined();
            const committed = setDocCalls.filter(c => c.transactional);
            expect(committed).toHaveLength(0);
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
            // A full-document version-checked write through the queue, not a merge (#614).
            expect(write.options).toBeUndefined();
            expect(write.transactional).toBe(true);
            expect(write.data.rev).toBe(1);
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

            mockTxControl.failNextCommit = new Error('permission denied');
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(svc.setYearStatus('settling')).rejects.toThrow('permission denied');
            errSpy.mockRestore();
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

// ── Versioned year-document writes (#614 / #668, spec § Versioned year-document writes) ──

describe('BillingYearService — version-checked year writes (#668)', () => {
    const PATH = 'users/user-1/billingYears/2026';
    const firestoreError = (code, message = code) => Object.assign(new Error(message), { code });

    function seedYear(extra = {}) {
        mockStore['users/user-1'] = { activeBillingYear: '2026' };
        mockStore[PATH] = {
            label: '2026', status: 'open', createdAt: 'ts-created', archivedAt: null, closedAt: null,
            familyMembers: [{ id: 1, name: 'Ada', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] }],
            bills: [{ id: 101, name: 'Internet', amount: 60, billingFrequency: 'monthly', logo: '', website: '', members: [1] }],
            payments: [], creditAdjustments: [], owedAdjustments: [], billingEvents: [],
            settings: { emailMessage: 'Hi', emailSubject: '', paymentLinks: [], paymentMethods: [] },
            ...extra
        };
    }
    async function loadedService() {
        const service = new BillingYearService();
        await service.setUser(TEST_USER);
        return service;
    }
    const yearWrites = () => setDocCalls.filter(c => c.path === PATH);
    let errSpy;
    beforeEach(() => {
        clearStore();
        errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => errSpy.mockRestore());

    it('commits rapid same-tab edits in order with consecutive revs', async () => {
        seedYear({ rev: 3, lastWriteId: 'w-3' });
        const s = await loadedService();
        s.addMember({ name: 'Bea' });
        s.addMember({ name: 'Cy' });
        s.addMember({ name: 'Dee' });
        await s._saveQueue._chain;
        expect(yearWrites().map(c => c.data.rev)).toEqual([4, 5, 6]);
        expect(yearWrites().map(c => c.data.familyMembers.length)).toEqual([2, 3, 4]);
        const ids = yearWrites().map(c => c.data.lastWriteId);
        expect(new Set(ids).size).toBe(3);
        expect(mockStore[PATH].rev).toBe(6);
        expect(mockStore[PATH].createdAt).toBe('ts-created');
    });

    it('serializes a status change behind a pending save; it lands with the next rev as a full document', async () => {
        seedYear({ rev: 1, lastWriteId: 'w-1' });
        const s = await loadedService();
        s.addMember({ name: 'Bea' });
        const status = s.setYearStatus('settling');
        await status;
        const writes = yearWrites();
        expect(writes.map(c => [c.data.rev, c.data.status])).toEqual([[2, 'open'], [3, 'settling']]);
        // The status write is the whole document, including the earlier save's member.
        expect(writes[1].data.familyMembers.map(m => m.name)).toEqual(['Ada', 'Bea']);
        expect(writes[1].data.billingEvents.map(e => e.eventType)).toEqual(['YEAR_STATUS_CHANGED']);
        expect(writes[1].options).toBeUndefined();
    });

    it('two sessions saving the same year: one commits, the other gets STALE_DOCUMENT with no write', async () => {
        seedYear({ rev: 1, lastWriteId: 'w-1' });
        const a = await loadedService();
        const b = await loadedService();
        a.addMember({ name: 'Bea' });
        await a._saveQueue._chain;
        expect(mockStore[PATH].rev).toBe(2);
        const before = structuredClone(mockStore[PATH]);
        const writesBefore = setDocCalls.length;
        const events = [];
        b.getSaveQueue().subscribe(e => events.push(e.type));
        b.addMember({ name: 'Cy' });
        await b._saveQueue._chain;
        expect(setDocCalls.length).toBe(writesBefore);
        expect(mockStore[PATH]).toEqual(before);
        expect(b.getState().writeBlock).toMatchObject({ yearId: '2026', reason: 'stale' });
        expect(b.getState().saveStatus).toMatchObject({ state: 'not_saved' });
        expect(events).toContain('save:error');
        expect(events).not.toContain('save:success');
        // The losing session is read-only until it reloads.
        expect(() => b.addMember({ name: 'Dee' })).toThrow('read-only until it reloads');
    });

    it('rejects a stale status change with STALE_DOCUMENT and keeps the local status', async () => {
        seedYear({ rev: 1, lastWriteId: 'w-1' });
        const s = await loadedService();
        mockStore[PATH] = { ...mockStore[PATH], rev: 2, lastWriteId: 'w-other' };
        await expect(s.setYearStatus('settling')).rejects.toMatchObject({ code: 'STALE_DOCUMENT' });
        expect(s.getState().activeYear.status).toBe('open');
        expect(mockStore[PATH].status).toBe('open');
    });

    it('first-run race: two tabs creating the same first year leave one document; the loser loads it', async () => {
        const year = String(new Date().getFullYear());
        const path = 'users/user-1/billingYears/' + year;
        const a = new BillingYearService();
        const b = new BillingYearService();
        await a.setUser(TEST_USER);
        const created = structuredClone(mockStore[path]);
        expect(created.rev).toBe(1);
        // B also saw no user document, so it runs the first-run creation too.
        delete mockStore['users/user-1'];
        await b.setUser(TEST_USER);
        expect(setDocCalls.filter(c => c.path === path)).toHaveLength(1);
        expect(mockStore[path]).toEqual(created);
        expect(b.getState().activeYear.id).toBe(year);
        expect(b.getState().writeBlock).toBeNull();
        // The loser's next save advances the existing document.
        b.addMember({ name: 'Bea' });
        await b._saveQueue._chain;
        expect(mockStore[path].rev).toBe(2);
    });

    it('first-run race under contention: the retried callback sees the other tab’s year and writes nothing', async () => {
        const year = String(new Date().getFullYear());
        const path = 'users/user-1/billingYears/' + year;
        const theirs = { label: year, status: 'open', rev: 1, lastWriteId: 'w-theirs', createdAt: 'ts', familyMembers: [], bills: [], payments: [], billingEvents: [], settings: {} };
        mockTxControl.contention = async () => { mockStore[path] = theirs; };
        const s = new BillingYearService();
        await s.setUser(TEST_USER);
        expect(setDocCalls.filter(c => c.path === path)).toHaveLength(0);
        expect(mockStore[path]).toBe(theirs);
        expect(s.getState().activeYear.id).toBe(year);
    });

    it('versions an unversioned document (rev 1) only while it matches the loaded snapshot', async () => {
        seedYear();
        const s = await loadedService();
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(mockStore[PATH].rev).toBe(1);
        expect(mockStore[PATH].createdAt).toBe('ts-created');
        expect(s.getState().writeBlock).toBeNull();
    });

    it('refuses the migration write with STALE_DOCUMENT when an unversioned writer changed the document', async () => {
        seedYear();
        const s = await loadedService();
        // A pre-feature tab saves a payment onto the still-unversioned document.
        mockStore[PATH] = { ...mockStore[PATH], payments: [{ id: 'p-old', memberId: 1, amount: 5 }], updatedAt: 'later' };
        const before = structuredClone(mockStore[PATH]);
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(mockStore[PATH]).toEqual(before);
        expect('rev' in mockStore[PATH]).toBe(false);
        expect(s.getState().writeBlock).toMatchObject({ reason: 'stale' });
    });

    it('does not treat a missing rev as zero: a versioned document whose rev the tab never saw is stale', async () => {
        seedYear();
        const s = await loadedService();
        mockStore[PATH] = { ...mockStore[PATH], rev: 1, lastWriteId: 'w-other' };
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(mockStore[PATH].lastWriteId).toBe('w-other');
        expect(s.getState().writeBlock).toMatchObject({ reason: 'stale' });
    });

    it('adopts a committed write whose response was lost, even after its server timestamp resolved', async () => {
        seedYear({ rev: 4, lastWriteId: 'w-4' });
        const s = await loadedService();
        mockTxControl.rejectAfterCommit = firestoreError('unavailable', 'connection dropped');
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(mockStore[PATH].rev).toBe(5);
        expect(s.getState().saveStatus).toMatchObject({ state: 'not_saved' });
        // The server resolved the sentinel; the stored document no longer equals the sent payload.
        mockStore[PATH] = { ...mockStore[PATH], updatedAt: { toDate: () => new Date('2026-06-01T10:00:00Z') } };
        s.addMember({ name: 'Cy' });
        await s._saveQueue._chain;
        expect(s.getState().writeBlock).toBeNull();
        expect(mockStore[PATH].rev).toBe(6);
        expect(mockStore[PATH].familyMembers.map(m => m.name)).toEqual(['Ada', 'Bea', 'Cy']);
        expect(s.getState().saveStatus).toBeNull();
    });

    it('adopts a migration write whose response was lost, without STALE_DOCUMENT', async () => {
        seedYear();
        const s = await loadedService();
        mockTxControl.rejectAfterCommit = firestoreError('deadline-exceeded');
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(mockStore[PATH].rev).toBe(1);
        s.addMember({ name: 'Cy' });
        await s._saveQueue._chain;
        expect(s.getState().writeBlock).toBeNull();
        expect(mockStore[PATH].rev).toBe(2);
    });

    it('retries with the same expectation when a lost-response attempt did not commit', async () => {
        seedYear({ rev: 2, lastWriteId: 'w-2' });
        const s = await loadedService();
        mockTxControl.failNextCommit = firestoreError('unavailable', 'Failed to get document because the client is offline.');
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(mockStore[PATH].rev).toBe(2);
        expect(s.getState().saveStatus.message).toMatch(/offline, so nothing was written/);
        s.addMember({ name: 'Cy' });
        await s._saveQueue._chain;
        expect(s.getState().writeBlock).toBeNull();
        expect(mockStore[PATH].rev).toBe(3);
        expect(mockStore[PATH].familyMembers.map(m => m.name)).toEqual(['Ada', 'Bea', 'Cy']);
    });

    it('classifies a lost response as stale when another session wrote meanwhile', async () => {
        seedYear({ rev: 2, lastWriteId: 'w-2' });
        const s = await loadedService();
        mockTxControl.failNextCommit = firestoreError('unavailable');
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        mockStore[PATH] = { ...mockStore[PATH], rev: 3, lastWriteId: 'w-other' };
        s.addMember({ name: 'Cy' });
        await s._saveQueue._chain;
        expect(mockStore[PATH].lastWriteId).toBe('w-other');
        expect(s.getState().writeBlock).toMatchObject({ reason: 'stale' });
    });

    it('reports offline as Not saved, never as success, and never downgrades to a plain write', async () => {
        const { setDoc, writeBatch } = await import('firebase/firestore');
        setDoc.mockClear();
        writeBatch.mockClear();
        seedYear({ rev: 1, lastWriteId: 'w-1' });
        const s = await loadedService();
        setDoc.mockClear();
        const events = [];
        s.getSaveQueue().subscribe(e => events.push(e.type));
        mockTxControl.failNextCommit = firestoreError('unavailable');
        await s.save();
        expect(events).toEqual(['save:start', 'save:error']);
        expect(s.getState().saveStatus.state).toBe('not_saved');
        expect(setDoc).not.toHaveBeenCalled();
        expect(writeBatch).not.toHaveBeenCalled();
    });

    it('emits save:success only after the transaction resolves', async () => {
        seedYear({ rev: 1, lastWriteId: 'w-1' });
        const s = await loadedService();
        let release;
        mockTxControl.beforeCommit = () => new Promise(resolve => { release = resolve; });
        const events = [];
        s.getSaveQueue().subscribe(e => events.push(e.type));
        const saved = s.save();
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        expect(events).toEqual(['save:start']);
        release();
        await saved;
        expect(events).toEqual(['save:start', 'save:success']);
    });

    it('a replayed transaction callback writes once and changes no service state', async () => {
        seedYear({ rev: 1, lastWriteId: 'w-1' });
        const s = await loadedService();
        mockTxControl.replays = 2;
        s.recordPayment({ memberId: 1, amount: 10, method: 'cash' });
        await s._saveQueue._chain;
        expect(yearWrites()).toHaveLength(1);
        expect(mockStore[PATH].rev).toBe(2);
        expect(mockStore[PATH].payments).toHaveLength(1);
        expect(mockStore[PATH].billingEvents.filter(e => e.eventType === 'PAYMENT_RECORDED')).toHaveLength(1);
    });

    it('a permission-denied write enters the read-only state with nothing written', async () => {
        seedYear({ rev: 1, lastWriteId: 'w-1' });
        const s = await loadedService();
        mockTxControl.failNextCommit = firestoreError('permission-denied', 'Missing or insufficient permissions.');
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(mockStore[PATH].rev).toBe(1);
        expect(s.getState().writeBlock).toMatchObject({ reason: 'permission-denied' });
        expect(s.getState().saveStatus.state).toBe('not_saved');
    });

    it('legacy createYear writes the same two documents apart from rev and lastWriteId, source at its next rev', async () => {
        seedYear({
            rev: 5, lastWriteId: 'w-5',
            payments: [{ id: 'p1', memberId: 1, amount: 800, receivedAt: '2026-01-01', note: '', method: 'cash' }]
        });
        const s = await loadedService();
        s._setState({ billingYears: [{ id: '2026', label: '2026', status: 'open' }] });
        await s.createYear('2027');
        const source = setDocCalls.filter(c => c.path === PATH).pop();
        const dest = setDocCalls.find(c => c.path === 'users/user-1/billingYears/2027');
        expect(source.data.rev).toBe(6);
        expect(dest.data.rev).toBe(1);
        expect(source.data.creditAdjustments.some(a => a.type === 'carry_forward')).toBe(true);
        expect(source.data.billingEvents.map(e => e.eventType)).toEqual(['YEAR_CARRIED_FORWARD']);
        expect(dest.data.owedAdjustments.some(a => a.kind === 'carry_opening')).toBe(true);
        expect(s.getState().activeYear.id).toBe('2027');
    });

    it('legacy createYear never overwrites a destination created elsewhere and leaves the source unchanged', async () => {
        seedYear({ rev: 5, lastWriteId: 'w-5', payments: [{ id: 'p1', memberId: 1, amount: 800, method: 'cash' }] });
        const s = await loadedService();
        const elsewhere = { label: '2027', status: 'open', rev: 1, lastWriteId: 'w-elsewhere', familyMembers: [], bills: [], payments: [], billingEvents: [], settings: {} };
        mockStore['users/user-1/billingYears/2027'] = elsewhere;
        const source = structuredClone(mockStore[PATH]);
        await expect(s.createYear('2027')).rejects.toThrow('Billing year "2027" already exists.');
        expect(mockStore['users/user-1/billingYears/2027']).toBe(elsewhere);
        expect(mockStore[PATH]).toEqual(source);
        expect(s.getState().activeYear.id).toBe('2026');
    });

    it('legacy createYear refuses a stale source with STALE_DOCUMENT and creates no destination', async () => {
        seedYear({ rev: 5, lastWriteId: 'w-5', payments: [{ id: 'p1', memberId: 1, amount: 800, method: 'cash' }] });
        const s = await loadedService();
        mockStore[PATH] = { ...mockStore[PATH], rev: 6, lastWriteId: 'w-other' };
        await expect(s.createYear('2027')).rejects.toMatchObject({ code: 'STALE_DOCUMENT' });
        expect(mockStore['users/user-1/billingYears/2027']).toBeUndefined();
        expect(mockStore[PATH].lastWriteId).toBe('w-other');
    });

    it('no caller writes a year document with writeBatch or a bare setDoc (source guard)', async () => {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const source = readFileSync(resolve(process.cwd(), 'src/lib/BillingYearService.js'), 'utf8');
        expect(source).not.toMatch(/\bwriteBatch\b/);
        expect(source).not.toMatch(/\btx\.update\(/);
        const setDocCallsInSource = source.match(/\bsetDoc\([^,]*/g) || [];
        // The only setDoc calls left write the users/<uid> pointer document.
        expect(setDocCallsInSource.length).toBeGreaterThan(0);
        for (const call of setDocCallsInSource) expect(call).toBe('setDoc(userDocRef');
        // Every transaction in the service is the version-checked primitive.
        expect((source.match(/\brunTransaction\(/g) || []).length).toBe(1);
    });
});

// ── Stale-write recovery: the Reload required state (#669, RD-34) ──

describe('BillingYearService — Reload required state (#669)', () => {
    const PATH = 'users/user-1/billingYears/2026';
    const KEY = 'ffb.unsaved.v1.user-1.2026';
    const firestoreError = (code, message = code) => Object.assign(new Error(message), { code });
    function seedYear(extra = {}) {
        mockStore['users/user-1'] = { activeBillingYear: '2026' };
        mockStore[PATH] = {
            label: '2026', status: 'open', createdAt: 'ts-created', rev: 1, lastWriteId: 'w-1',
            familyMembers: [
                { id: 1, name: 'Ada', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
                { id: 2, name: 'Kenji', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] }
            ],
            bills: [{ id: 101, name: 'Internet', amount: 60, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2] }],
            payments: [], creditAdjustments: [], owedAdjustments: [], billingEvents: [],
            settings: { emailMessage: 'Hi', emailSubject: '', paymentLinks: [], paymentMethods: [] },
            ...extra
        };
    }
    async function loadedService() {
        const service = new BillingYearService();
        await service.setUser(TEST_USER);
        return service;
    }
    const otherSessionSaves = () => { mockStore[PATH] = { ...mockStore[PATH], rev: mockStore[PATH].rev + 1, lastWriteId: 'w-other' }; };
    let errSpy;
    beforeEach(() => {
        clearStore();
        window.localStorage.clear();
        errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        errSpy.mockRestore();
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('the losing session lists its unsaved changes against the last successful save and keeps them on the device', async () => {
        seedYear();
        const s = await loadedService();
        // A payment saved after the load is part of the baseline, never unsaved.
        s.recordPayment({ memberId: 1, amount: 50, method: 'venmo' });
        await s._saveQueue._chain;
        expect(mockStore[PATH].rev).toBe(2);
        otherSessionSaves();
        // Unsaved: a service credit (an event) and edits that emit no event.
        s.recordServiceCredit({ billId: 101, amount: 12, reason: 'Outage, March' });
        s.updateMember(2, { phone: '+14155551212' });
        s.addMember({ name: 'Priya Natarajan' });
        s.updateSettings({ emailMessage: 'Hello there' });
        await s._saveQueue._chain;

        const block = s.getState().writeBlock;
        expect(block).toMatchObject({ yearId: '2026', reason: 'stale', baselineKind: 'saved', keptOnDevice: true, storageError: null });
        const labels = block.changes.map(c => c.label + (c.detail ? ' · ' + c.detail : ''));
        expect(labels.some(l => l.startsWith('Service credit · Internet'))).toBe(true);
        expect(labels).toContain('Member edited · Kenji · phone number');
        expect(labels).toContain('Member added · Priya Natarajan');
        expect(labels).toContain('Invoice template changed');
        expect(labels.some(l => l.startsWith('Payment recorded'))).toBe(false);
        expect(block.payload.familyMembers.map(m => m.name)).toEqual(['Ada', 'Kenji', 'Priya Natarajan']);

        const kept = JSON.parse(window.localStorage.getItem(KEY));
        expect(kept.changes).toEqual(block.changes);
        expect(kept.payload.settings.emailMessage).toBe('Hello there');
        // Nothing was merged or re-stamped: the other session's document stands.
        expect(mockStore[PATH].lastWriteId).toBe('w-other');
        expect(mockStore[PATH].payments).toHaveLength(1);
    });

    it('stops the queue for the year: later enqueues reject with the same outcome and write nothing', async () => {
        seedYear();
        const s = await loadedService();
        otherSessionSaves();
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        const outcome = s._saveQueue.stoppedOutcome('2026');
        expect(outcome).toMatchObject({ code: 'STALE_DOCUMENT' });
        const writes = setDocCalls.length;
        await expect(s._saveQueue.enqueue(async () => {}, { keys: ['2026'] })).rejects.toBe(outcome);
        await expect(s._saveConfirmed()).rejects.toBe(outcome);
        await expect(s.setYearStatus('settling')).rejects.toBe(outcome);
        await s.save(); // fire-and-forget callers still resolve
        expect(setDocCalls.length).toBe(writes);
        expect(s.getState().saveStatus.state).toBe('not_saved');
    });

    it('a permission-denied write produces the same state and never a success', async () => {
        seedYear();
        const s = await loadedService();
        const events = [];
        s.getSaveQueue().subscribe(e => events.push(e.type));
        mockTxControl.failNextCommit = firestoreError('permission-denied', 'Missing or insufficient permissions.');
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(s.getState().writeBlock).toMatchObject({ reason: 'permission-denied', keptOnDevice: true });
        expect(s.getState().writeBlock.changes.map(c => c.label)).toEqual(['Member added']);
        expect(window.localStorage.getItem(KEY)).not.toBeNull();
        expect(events).not.toContain('save:success');
        expect(s.getState().saveStatus.state).toBe('not_saved');
    });

    it('after a reload the kept list is read back for the Dashboard', async () => {
        seedYear();
        const s = await loadedService();
        otherSessionSaves();
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        const { readUnsavedRecords } = await import('@/lib/unsaved-changes.js');
        const fresh = await loadedService(); // the reloaded tab
        expect(fresh.getState().writeBlock).toBeNull();
        const [record] = readUnsavedRecords('user-1');
        expect(record.yearId).toBe('2026');
        expect(record.changes.map(c => c.label + ' · ' + c.detail)).toEqual(['Member added · Bea']);
    });

    it('says so when the device cannot keep the list (storage unavailable)', async () => {
        seedYear();
        const s = await loadedService();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('The operation is insecure.'); });
        otherSessionSaves();
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(s.getState().writeBlock).toMatchObject({ keptOnDevice: false, storageError: 'The operation is insecure.' });
        expect(s.getState().writeBlock.changes).toHaveLength(1);
    });

    it('says so when the device cannot keep the list (quota exceeded)', async () => {
        seedYear();
        const s = await loadedService();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
        });
        otherSessionSaves();
        s.addMember({ name: 'Bea' });
        await s._saveQueue._chain;
        expect(s.getState().writeBlock).toMatchObject({ keptOnDevice: false, storageError: 'This device is out of storage space.' });
    });
});
