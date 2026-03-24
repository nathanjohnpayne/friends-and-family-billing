import { renderHook, act } from '@testing-library/react';

// Mock firebase
vi.mock('../../../src/lib/firebase.js', () => ({
    db: {},
    storage: {},
    auth: {}
}));

// Mock BillingYearService — define mock fns via vi.hoisted so they're available in hoisted vi.mock
const { mockSetUser, mockSubscribe, mockGetState, mockGetSaveQueue } = vi.hoisted(() => ({
    mockSetUser: vi.fn(),
    mockSubscribe: vi.fn(),
    mockGetState: vi.fn(),
    mockGetSaveQueue: vi.fn()
}));

vi.mock('../../../src/lib/BillingYearService.js', () => {
    class MockBillingYearService {
        constructor() {
            this.setUser = mockSetUser;
            this.subscribe = mockSubscribe;
            this.getState = mockGetState;
            this.getSaveQueue = mockGetSaveQueue;
        }
    }
    return { BillingYearService: MockBillingYearService };
});

// Mock AuthContext
const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('../../../src/app/contexts/AuthContext.jsx', () => ({
    useAuth: () => mockUseAuth()
}));

import { useBillingData, billingYearService } from '../../../src/app/hooks/useBillingData.js';

describe('useBillingData', () => {
    let subscribeCb;

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuth.mockReturnValue({ user: null });
        mockGetState.mockReturnValue({
            billingYears: [],
            activeYear: null,
            familyMembers: [],
            bills: [],
            payments: [],
            billingEvents: [],
            settings: null,
            loading: true,
            error: null
        });
        mockGetSaveQueue.mockReturnValue({ pending: 0 });
        mockSubscribe.mockImplementation(cb => {
            subscribeCb = cb;
            return () => { subscribeCb = null; };
        });
    });

    it('calls service.setUser when auth user changes', () => {
        const user = { uid: 'u1', email: 'test@test.com' };
        mockUseAuth.mockReturnValue({ user });

        renderHook(() => useBillingData());

        expect(mockSetUser).toHaveBeenCalledWith(user);
    });

    it('calls service.setUser(null) when user is null', () => {
        mockUseAuth.mockReturnValue({ user: null });

        renderHook(() => useBillingData());

        expect(mockSetUser).toHaveBeenCalledWith(null);
    });

    it('calls service.setUser again when user changes', () => {
        const user1 = { uid: 'u1' };
        const user2 = { uid: 'u2' };
        mockUseAuth.mockReturnValue({ user: user1 });

        const { rerender } = renderHook(() => useBillingData());
        expect(mockSetUser).toHaveBeenCalledWith(user1);

        mockUseAuth.mockReturnValue({ user: user2 });
        rerender();
        expect(mockSetUser).toHaveBeenCalledWith(user2);
    });

    it('subscribes to service state via useSyncExternalStore', () => {
        renderHook(() => useBillingData());

        expect(mockSubscribe).toHaveBeenCalledTimes(1);
        expect(typeof mockSubscribe.mock.calls[0][0]).toBe('function');
    });

    it('returns state from service.getState()', () => {
        const state = {
            billingYears: [{ id: 'y1' }],
            activeYear: { id: 'y1', label: '2024' },
            familyMembers: [{ id: 'm1', name: 'Alice' }],
            bills: [],
            payments: [],
            billingEvents: [],
            settings: { emailMessage: 'hi' },
            loading: false,
            error: null
        };
        mockGetState.mockReturnValue(state);

        const { result } = renderHook(() => useBillingData());

        expect(result.current.billingYears).toEqual([{ id: 'y1' }]);
        expect(result.current.activeYear).toEqual({ id: 'y1', label: '2024' });
        expect(result.current.familyMembers).toEqual([{ id: 'm1', name: 'Alice' }]);
        expect(result.current.loading).toBe(false);
    });

    it('returns the singleton service instance', () => {
        const { result } = renderHook(() => useBillingData());

        expect(result.current.service).toBeDefined();
        expect(result.current.service.setUser).toBe(mockSetUser);
    });

    it('returns saveQueue from service.getSaveQueue()', () => {
        const saveQueue = { pending: 3, flush: vi.fn() };
        mockGetSaveQueue.mockReturnValue(saveQueue);

        const { result } = renderHook(() => useBillingData());

        expect(result.current.saveQueue).toBe(saveQueue);
    });

    it('rerenders when service notifies subscribers', () => {
        const state1 = {
            billingYears: [],
            activeYear: null,
            familyMembers: [],
            bills: [],
            payments: [],
            billingEvents: [],
            settings: null,
            loading: true,
            error: null
        };
        const state2 = { ...state1, loading: false, activeYear: { id: 'y1' } };

        mockGetState.mockReturnValue(state1);
        const { result } = renderHook(() => useBillingData());
        expect(result.current.loading).toBe(true);

        // Simulate service state change
        mockGetState.mockReturnValue(state2);
        act(() => {
            if (subscribeCb) subscribeCb();
        });

        expect(result.current.loading).toBe(false);
        expect(result.current.activeYear).toEqual({ id: 'y1' });
    });

    it('exports the singleton service as billingYearService', () => {
        expect(billingYearService).toBeDefined();
        expect(billingYearService.setUser).toBe(mockSetUser);
    });

    it('unsubscribes on unmount', () => {
        const unsubscribe = vi.fn();
        mockSubscribe.mockReturnValue(unsubscribe);

        const { unmount } = renderHook(() => useBillingData());
        unmount();

        // useSyncExternalStore should clean up
        expect(unsubscribe).toHaveBeenCalled();
    });
});
