/**
 * renderWithBillingData — shared test utility that renders components with
 * the real useBillingData hook backed by a mocked BillingYearService singleton.
 *
 * Usage:
 *   import { renderWithBillingData, mockService, setServiceState } from '../helpers/renderWithBillingData.js';
 *
 *   setServiceState({ familyMembers: [...], bills: [...] });
 *   renderWithBillingData(<DashboardView />);
 *
 * This avoids mocking useBillingData at the hook level, so component integration
 * tests exercise the real hook subscription path.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

/** Subscription listeners. */
let listeners = new Set();

/**
 * Mock service instance — exposed for tests that need to spy on mutations.
 * Automatically created fresh in resetServiceState().
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

export const mockSaveQueue = {
    subscribe: vi.fn(() => () => {}),
    pending: 0
};

/**
 * Update the mocked service state and notify subscribers
 * (triggers useSyncExternalStore re-render).
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
 * Render a component wrapped with MemoryRouter and ToastProvider.
 * Uses the real useBillingData hook (which the test file must NOT mock).
 *
 * @param {React.ReactElement} ui
 * @param {{ route?: string }} options
 */
export function renderWithBillingData(ui, { route = '/' } = {}) {
    return render(
        <MemoryRouter initialEntries={[route]}>
            <ToastProvider>
                {ui}
            </ToastProvider>
        </MemoryRouter>
    );
}
