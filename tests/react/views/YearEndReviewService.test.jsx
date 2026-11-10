import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// The Year-End Review page driven through the REAL BillingYearService (#607's commit
// guard, #614's versioned writes) over the repo's Firestore mock, the same harness
// as tests/react/lib/BillingYearService.test.js. The wireframe fixture's Step 4
// figures must be exactly what Start writes; the service's own outcomes (an unsaved
// source edit, a year created elsewhere) render without any mocked service.

const mockStore = {};
const mockTxControl = { failNextCommit: null, failGetDocPath: null };
const holder = vi.hoisted(() => ({ service: null }));

vi.mock('@/lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
    collection: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
    query: vi.fn(ref => ref),
    where: vi.fn(() => null),
    getDoc: vi.fn(async ref => {
        // A plain read of one path that cannot reach the server (the rollover read-back).
        if (mockTxControl.failGetDocPath === ref.path) throw Object.assign(new Error('offline'), { code: 'unavailable' });
        return { exists: () => !!mockStore[ref.path], data: () => mockStore[ref.path] || null };
    }),
    getDocs: vi.fn(async ref => {
        const prefix = ref.path + '/';
        const docs = Object.entries(mockStore)
            .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => value }));
        return { docs };
    }),
    setDoc: vi.fn(async (ref, data, options) => {
        mockStore[ref.path] = options?.merge ? { ...(mockStore[ref.path] || {}), ...data } : data;
    }),
    writeBatch: vi.fn(() => {
        const ops = [];
        return { set: (ref, data) => { ops.push({ ref, data }); }, commit: async () => { for (const { ref, data } of ops) mockStore[ref.path] = data; } };
    }),
    runTransaction: vi.fn(async (_db, fn) => {
        const writes = [];
        const tx = {
            get: async ref => ({ exists: () => !!mockStore[ref.path], data: () => mockStore[ref.path] || null }),
            set: (ref, data) => { writes.push({ ref, data }); return tx; },
            update: (ref, data) => { writes.push({ ref, data, merge: true }); return tx; }
        };
        const result = await fn(tx);
        if (mockTxControl.failNextCommit) {
            const err = mockTxControl.failNextCommit;
            mockTxControl.failNextCommit = null;
            throw err;
        }
        for (const { ref, data, merge } of writes) mockStore[ref.path] = merge ? { ...(mockStore[ref.path] || {}), ...data } : data;
        return result;
    }),
    serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__')
}));
vi.mock('@/app/hooks/useBillingData.js', async () => {
    const { useSyncExternalStore } = await import('react');
    return {
        useBillingData: () => {
            const state = useSyncExternalStore(callback => holder.service.subscribe(callback), () => holder.service.getState());
            return { ...state, service: holder.service };
        }
    };
});
vi.mock('@/app/contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: { uid: 'user-1' }, loading: false }) }));
vi.mock('@/app/hooks/useRefundNotices.js', () => ({ useRefundNotices: () => ({ refundNotices: [], loading: false, error: null }) }));

import { BillingYearService } from '@/lib/BillingYearService.js';
import { getHouseholdFinancials, isLinkedToAnyone } from '@/lib/calculations.js';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import YearEndReviewView from '@/app/views/YearEndReview/YearEndReviewView.jsx';
import { createDraft, draftStorageKey, fingerprintOf } from '@/app/views/YearEndReview/yearEndReviewModel.js';
import { BILL, MEMBER, NEW_BILL, wireframeEntries, wireframeReviewState } from '../helpers/yearEndReviewFixture.js';

const PATH_26 = 'users/user-1/billingYears/2026';
const PATH_27 = 'users/user-1/billingYears/2027';
const KEY = draftStorageKey('user-1', '2026');
const firestoreError = code => Object.assign(new Error(code), { code });

function seedStore() {
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    const state = wireframeReviewState();
    mockStore['users/user-1'] = { activeBillingYear: '2026' };
    mockStore[PATH_26] = {
        label: '2026', status: 'settling', createdAt: 'ts-created', rev: 1, lastWriteId: 'w-1',
        familyMembers: state.familyMembers, bills: state.bills, payments: state.payments,
        creditAdjustments: [], owedAdjustments: state.owedAdjustments, billingEvents: [],
        settings: { emailMessage: 'Hi', emailSubject: '', paymentLinks: [], paymentMethods: [] }
    };
}

async function loadService() {
    const service = new BillingYearService();
    await service.setUser({ uid: 'user-1' });
    holder.service = service;
    return service;
}

/** The wireframe draft, bound to the source exactly as the service loaded it. */
function seedDraft(service) {
    const live = service.getState();
    const source = { sourceYear: live.activeYear, bills: live.bills, familyMembers: live.familyMembers, owedAdjustments: live.owedAdjustments,
        payments: live.payments, creditAdjustments: live.creditAdjustments, billingEvents: live.billingEvents };
    const draft = { ...createDraft({ userId: 'user-1', sourceYear: live.activeYear, nextYearLabel: '2027', sourceFingerprint: fingerprintOf(source) }),
        reconciliationId: 'rec_wireframe', ...wireframeEntries() };
    window.localStorage.setItem(KEY, JSON.stringify(draft));
    return draft;
}

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/year-end-review']}>
            <ToastProvider>
                <Routes>
                    <Route path="/year-end-review" element={<YearEndReviewView />} />
                    <Route path="/dashboard" element={<p>Dashboard page</p>} />
                </Routes>
            </ToastProvider>
        </MemoryRouter>
    );
}

async function openStep4(user) {
    await user.click(screen.getByRole('button', { name: /^Next: new subscriptions/ }));
    await user.click(screen.getByRole('button', { name: /^Next: member charges/ }));
    await user.click(screen.getByRole('button', { name: /Review & start 2027/ }));
}

const startButton = () => within(screen.getByTestId('start-card')).getByRole('button', { name: /^Start 2027$|^Starting 2027/ });

/** Each household's first invoice in a stored year: what getHouseholdFinancials says it owes. */
function owedByHousehold(yearDoc) {
    const source = { familyMembers: yearDoc.familyMembers, bills: yearDoc.bills, payments: yearDoc.payments || [],
        creditAdjustments: yearDoc.creditAdjustments || [], owedAdjustments: yearDoc.owedAdjustments || [] };
    return Object.fromEntries(yearDoc.familyMembers.filter(member => !isLinkedToAnyone(yearDoc.familyMembers, member.id))
        .map(member => [member.id, getHouseholdFinancials(member, source).owed]));
}

let errSpy;
beforeEach(() => {
    window.localStorage.clear();
    mockTxControl.failNextCommit = null;
    mockTxControl.failGetDocPath = null;
    seedStore();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errSpy.mockRestore(); window.localStorage.clear(); });

describe('Start through the real BillingYearService (wireframe fixture)', () => {
    it('writes exactly the Step 4 figures: bills, carried seeds, first invoices, and the 2026 records and events', async () => {
        const user = userEvent.setup();
        const service = await loadService();
        expect(service.reviewedCommitGuard).toBe(true);
        seedDraft(service);
        renderPage();
        await openStep4(user);
        const figures = within(screen.getByTestId('review-figures'));
        expect(figures.getByText('$3,167.88')).toBeInTheDocument();
        expect(figures.getByText('+$170.46')).toBeInTheDocument();
        expect(figures.getByText('$3,338.34')).toBeInTheDocument();
        await user.click(startButton());
        await screen.findByText('Dashboard page');

        const next = mockStore[PATH_27];
        expect(next).toBeTruthy();
        // 2027 bills at their new prices; Pinecone Vault left out; Lumen Fiber Backup created.
        expect(Object.fromEntries(next.bills.map(bill => [bill.id, bill.amount]))).toEqual({
            [BILL.nl]: 198, [BILL.cs]: 26, [BILL.hc]: 144, [BILL.mm]: 18, [NEW_BILL]: 9.99 });
        // One carried seed per household, each the Carried figure of Step 4, its items summing to it.
        const seeds = next.owedAdjustments.filter(record => record.kind === 'carry_opening');
        const seedOf = id => seeds.find(seed => seed.memberId === id);
        expect(Object.fromEntries([MEMBER.ada, MEMBER.erik, MEMBER.kenji, MEMBER.rosa, MEMBER.sam].map(id => [id, seedOf(id).amount])))
            .toEqual({ [MEMBER.ada]: 15, [MEMBER.erik]: 55, [MEMBER.kenji]: 98.14, [MEMBER.rosa]: -28, [MEMBER.sam]: 30.32 });
        for (const seed of seeds) {
            expect(Math.round(seed.items.reduce((sum, item) => sum + item.amount * 100, 0))).toBe(Math.round(seed.amount * 100));
        }
        // The first 2027 invoices are the Step 4 first-invoice figures.
        expect(owedByHousehold(next)).toEqual({ [MEMBER.ada]: 1071, [MEMBER.erik]: 723, [MEMBER.kenji]: 814.06, [MEMBER.rosa]: 360, [MEMBER.sam]: 370.28 });
        expect(next.billingEvents.map(event => event.eventType)).toContain('YEAR_CREATED_FROM_REVIEW');

        // 2026: the review's records appended (16 True-up shares, 5 service-credit shares), carried, and rolled over.
        const source = mockStore[PATH_26];
        const review = source.owedAdjustments.filter(record => record.reconciliationId === 'rec_wireframe');
        expect(review.filter(record => record.kind === 'usage_charge')).toHaveLength(16);
        expect(review.filter(record => record.kind === 'service_credit')).toHaveLength(5);
        expect(review.filter(record => record.kind === 'usage_charge').every(record => record.status === 'carried_forward')).toBe(true);
        expect(source.billingEvents.map(event => event.eventType)).toContain('YEAR_ROLLED_OVER');

        // Success: the draft is cleared and the tab is in 2027.
        expect(window.localStorage.getItem(KEY)).toBeNull();
        expect(service.getState().activeYear.id).toBe('2027');
    });

    it('an unsaved 2026 edit that still cannot be written: COMMIT_FAILED shows the service’s message, keeps the draft, and Retry succeeds once it can', async () => {
        const user = userEvent.setup();
        const service = await loadService();
        // An edit fails offline and stays unsaved in this tab.
        mockTxControl.failNextCommit = firestoreError('unavailable');
        service.updateMember(MEMBER.sam, { phone: '+14155551212' });
        await service._saveQueue._chain;
        seedDraft(service);
        renderPage();
        await openStep4(user);
        // Still offline when Start retries that save first: nothing starts.
        mockTxControl.failNextCommit = firestoreError('unavailable');
        await user.click(startButton());
        const alert = (await screen.findByText('2027 was not created.')).closest('[role="alert"]');
        expect(alert).toHaveTextContent(/Changes to 2026 are not saved yet.*Try again when you are back online\./);
        expect(mockStore[PATH_27]).toBeUndefined();
        expect(JSON.parse(window.localStorage.getItem(KEY)).reconciliationId).toBe('rec_wireframe');
        // Back online: Retry saves the edit, then commits the rollover over a source that holds it.
        await user.click(within(alert).getByRole('button', { name: 'Retry' }));
        await screen.findByText('Dashboard page');
        expect(mockStore[PATH_26].familyMembers.find(member => member.id === MEMBER.sam).phone).toBe('+14155551212');
        expect(mockStore[PATH_27]).toBeTruthy();
    });

    it('a 2027 created by another device during the flow: the service classifies it as created elsewhere; nothing is written', async () => {
        const user = userEvent.setup();
        const service = await loadService();
        seedDraft(service);
        renderPage();
        await openStep4(user);
        const before = JSON.stringify(mockStore[PATH_26]);
        // Another device creates 2027 (a legacy rollover, no review events) after this tab loaded.
        mockStore[PATH_27] = { label: '2027', status: 'open', rev: 1, lastWriteId: 'w-other', familyMembers: [], bills: [], payments: [],
            creditAdjustments: [], owedAdjustments: [], billingEvents: [], settings: {} };
        await user.click(startButton());
        const alert = (await screen.findByText('2027 already exists.')).closest('[role="alert"]');
        expect(alert).toHaveTextContent('your draft is kept');
        expect(mockStore[PATH_27].lastWriteId).toBe('w-other');
        expect(JSON.stringify(mockStore[PATH_26])).toBe(before);
        expect(JSON.parse(window.localStorage.getItem(KEY)).reconciliationId).toBe('rec_wireframe');
    });

    it('an existing 2027 whose completion evidence cannot be read stays on the page with Check again, never "started elsewhere" (#609 review)', async () => {
        const user = userEvent.setup();
        const service = await loadService();
        seedDraft(service);
        renderPage();
        await openStep4(user);
        mockStore[PATH_27] = { label: '2027', status: 'open', rev: 1, lastWriteId: 'w-other', familyMembers: [], bills: [], payments: [],
            creditAdjustments: [], owedAdjustments: [], billingEvents: [], settings: {} };
        // The transaction sees 2027; the read-back of its events then cannot reach the server.
        mockTxControl.failGetDocPath = PATH_27;
        await user.click(startButton());
        const banner = (await screen.findByText('We can’t tell yet whether 2027 was created.')).closest('[role="alert"]');
        // The years list now shows 2027, yet the page stays: no entry-guard card replaces it.
        expect(service.getState().billingYears.some(year => year.id === '2027')).toBe(true);
        expect(screen.queryByText(/It was started elsewhere/)).toBeNull();
        const recheck = within(banner).getByRole('button', { name: 'Check again' });
        expect(recheck).toBeEnabled();
        // Back online: Check again reads the evidence, and the service classifies it.
        mockTxControl.failGetDocPath = null;
        await user.click(recheck);
        expect(await screen.findByText('2027 already exists.')).toBeInTheDocument();
        expect(mockStore[PATH_27].lastWriteId).toBe('w-other');
        expect(JSON.parse(window.localStorage.getItem(KEY)).reconciliationId).toBe('rec_wireframe');
    });
});
