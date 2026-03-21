import { useEffect, useSyncExternalStore } from 'react';
import { BillingYearService } from '@/lib/BillingYearService.js';
import { useAuth } from '../contexts/AuthContext.jsx';

/**
 * Singleton service instance — shared across the React app.
 * The service owns canonical state; React subscribes to it.
 */
const service = new BillingYearService();

/**
 * useBillingData — returns the current billing state from BillingYearService.
 * Automatically loads data when the auth user changes.
 *
 * Uses useSyncExternalStore for tear-free reads from the service.
 */
export function useBillingData() {
    const { user } = useAuth();

    // Bind the service to the current auth user
    useEffect(() => {
        service.setUser(user);
    }, [user]);

    // Subscribe to state changes via useSyncExternalStore
    const state = useSyncExternalStore(
        (callback) => service.subscribe(callback),
        () => service.getState()
    );

    return {
        ...state,
        service, // expose for mutations (switchYear, save, createYear)
        saveQueue: service.getSaveQueue()
    };
}

/** Access the singleton service directly (for non-React code or tests). */
export { service as billingYearService };
