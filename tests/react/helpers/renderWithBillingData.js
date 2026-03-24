/**
 * renderWithBillingData — shared test utility that renders components with
 * the real useBillingData hook backed by a mocked BillingYearService singleton.
 *
 * ## How it works
 *
 * The real `useBillingData` hook calls `useAuth()` and instantiates a
 * `BillingYearService` singleton at module load. This helper provides:
 *   1. `mockService` — a fake service whose state you control via `setServiceState`
 *   2. `mockSaveQueue` — a fake save queue
 *   3. `renderWithBillingData` — wraps the component in AuthProvider + ToastProvider + MemoryRouter
 *   4. `setServiceState` / `resetServiceState` — control what the hook returns
 *
 * ## Required mocks in consuming test files
 *
 * Because `vi.mock()` is hoisted, the consuming test file MUST set up these
 * mocks before importing this helper or any component under test:
 *
 * ```js
 * import { mockService, mockSaveQueue } from '../helpers/renderWithBillingData.js';
 *
 * // These vi.mock calls MUST be in the test file (hoisting requirement)
 * vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {}, auth: {} }));
 * vi.mock('firebase/auth', () => ({
 *     onAuthStateChanged: vi.fn((_auth, cb) => { cb({ uid: 'test-uid', email: 'test@test.com' }); return () => {}; }),
 *     signOut: vi.fn()
 * }));
 * vi.mock('firebase/firestore', () => ({
 *     collection: vi.fn(), doc: vi.fn(),
 *     getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
 *     getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
 *     setDoc: vi.fn(() => Promise.resolve()), serverTimestamp: vi.fn(),
 *     query: vi.fn(), where: vi.fn(), deleteDoc: vi.fn()
 * }));
 * vi.mock('firebase/storage', () => ({ ref: vi.fn(), deleteObject: vi.fn() }));
 *
 * // Wire the BillingYearService singleton to use mockService
 * vi.mock('@/lib/BillingYearService.js', () => {
 *     const { mockService: svc } = require('../helpers/renderWithBillingData.js');
 *     return { BillingYearService: function() { Object.assign(this, svc); } };
 * });
 * ```
 *
 * Then in tests:
 * ```js
 * import { renderWithBillingData, setServiceState, resetServiceState } from '../helpers/renderWithBillingData.js';
 *
 * beforeEach(() => resetServiceState());
 *
 * it('renders members', () => {
 *     setServiceState({ familyMembers: [{ id: 1, name: 'Alice' }], loading: false });
 *     renderWithBillingData(<MembersTab />);
 *     expect(screen.getByText('Alice')).toBeInTheDocument();
 * });
 * ```
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/app/contexts/AuthContext.jsx';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';

/** Default state matching BillingYearService initial state. */
const DEFAULT_STATE = {
    billingYears: [],
    activeYear: null,
    familyMembers: [],
    bills: [],
    payments: [],
    billingEvents: [],
    settings: null,
    loading: false,
    error: null
};

/** Mutable state container — BillingYearService mock reads from this. */
let currentState = { ...DEFAULT_STATE };

/** Subscription listeners (mirrors BillingYearService._listeners). */
let listeners = new Set();

export const mockSaveQueue = {
    subscribe: vi.fn(() => () => {}),
    pending: 0
};

/**
 * Mock service instance — the BillingYearService mock delegates to this.
 * `getState` and `subscribe` are live-wired to `currentState` and `listeners`
 * so that `useSyncExternalStore` in the real hook works correctly.
 */
export const mockService = {
    setUser: vi.fn(),
    getState: () => currentState,
    getSaveQueue: () => mockSaveQueue,
    subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
    // Mutation methods — tests can spy on these
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    addBill: vi.fn(),
    updateBill: vi.fn(),
    removeBill: vi.fn(),
    toggleBillMember: vi.fn(),
    updateSettings: vi.fn(),
    recordPayment: vi.fn(),
    reversePayment: vi.fn(),
    switchYear: vi.fn()
};

/**
 * Update the mocked service state and notify subscribers.
 * This triggers `useSyncExternalStore` to re-render components using the hook.
 */
export function setServiceState(partial) {
    currentState = { ...currentState, ...partial };
    listeners.forEach(fn => fn());
}

/** Reset to default state and clear mocks. Call in beforeEach. */
export function resetServiceState() {
    currentState = { ...DEFAULT_STATE };
    listeners = new Set();
    Object.values(mockService).forEach(fn => {
        if (typeof fn === 'function' && fn.mockClear) fn.mockClear();
    });
}

/**
 * Render a component wrapped with AuthProvider, ToastProvider, and MemoryRouter.
 *
 * The consuming test file must have the vi.mock() calls listed in the module
 * docstring above, so that:
 *   - AuthProvider uses the mocked firebase/auth (provides { user } to useAuth)
 *   - useBillingData uses the mocked BillingYearService (wired to mockService)
 *
 * @param {React.ReactElement} ui - component to render
 * @param {{ route?: string }} options
 */
export function renderWithBillingData(ui, { route = '/' } = {}) {
    return render(
        <AuthProvider>
            <MemoryRouter initialEntries={[route]}>
                <ToastProvider>
                    {ui}
                </ToastProvider>
            </MemoryRouter>
        </AuthProvider>
    );
}
