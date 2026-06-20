import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/firebase.js', () => ({ db: {} }));

const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn(() => Promise.resolve());
const mockCollection = vi.fn((...segments) => ({ _type: 'collection', _path: segments.filter(s => typeof s === 'string').join('/') }));
const mockDoc = vi.fn((...segments) => ({ _type: 'doc', _path: segments.filter(s => typeof s === 'string').join('/') }));
vi.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    doc: (...args) => mockDoc(...args),
    getDocs: (...args) => mockGetDocs(...args),
    setDoc: (...args) => mockSetDoc(...args),
    serverTimestamp: vi.fn(() => 'SERVER_TS')
}));

vi.mock('../../../src/app/contexts/AuthContext.jsx', () => ({ useAuth: vi.fn() }));
vi.mock('../../../src/app/hooks/useBillingData.js', () => ({ useBillingData: vi.fn() }));

import { useAuth } from '../../../src/app/contexts/AuthContext.jsx';
import { useBillingData } from '../../../src/app/hooks/useBillingData.js';
import { useRefundNotices } from '../../../src/app/hooks/useRefundNotices.js';

function setupMocks(user = { uid: 'u1' }, activeYear = { id: 'y1' }) {
    useAuth.mockReturnValue({ user });
    useBillingData.mockReturnValue({ activeYear });
}

function fakeSnap(docs) {
    return {
        docs: docs.map(d => ({
            id: d.id,
            data: () => { const { id: _id, ...rest } = d; return { ...rest }; }
        }))
    };
}

describe('useRefundNotices', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([]));
    });

    it('returns empty and skips Firestore when user is null', async () => {
        setupMocks(null, { id: 'y1' });
        const { result } = renderHook(() => useRefundNotices());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.refundNotices).toEqual([]);
        expect(mockGetDocs).not.toHaveBeenCalled();
    });

    it('loads ONLY refund_notice docs (excludes Review Requests)', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'rn1', kind: 'refund_notice', memberId: 1, amount: 100, confirmation: null, createdAt: '2024-01-01T00:00:00Z' },
            { id: 'd1', status: 'open', message: 'a review request', createdAt: '2024-01-02T00:00:00Z' },
            { id: 'rn2', kind: 'refund_notice', memberId: 2, amount: 50, confirmation: 'not_received', createdAt: '2024-01-03T00:00:00Z' }
        ]));

        const { result } = renderHook(() => useRefundNotices());
        await waitFor(() => expect(result.current.loading).toBe(false));

        const colRef = mockCollection.mock.results[0].value;
        expect(colRef._path).toContain('users/u1/billingYears/y1/disputes');

        const ids = result.current.refundNotices.map(n => n.id);
        expect(ids).toContain('rn1');
        expect(ids).toContain('rn2');
        expect(ids).not.toContain('d1');
    });

    it('sorts notices by createdAt descending', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'old', kind: 'refund_notice', amount: 1, createdAt: '2024-01-01T00:00:00Z' },
            { id: 'new', kind: 'refund_notice', amount: 2, createdAt: '2024-06-01T00:00:00Z' }
        ]));
        const { result } = renderHook(() => useRefundNotices());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.refundNotices.map(n => n.id)).toEqual(['new', 'old']);
    });

    it('exposes activeNotReceivedCount for the admin follow-up surface', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'rn1', kind: 'refund_notice', amount: 100, confirmation: 'not_received', createdAt: '2024-01-01T00:00:00Z' },
            { id: 'rn2', kind: 'refund_notice', amount: 50, confirmation: 'not_received', resolution: { type: 'dismissed' }, createdAt: '2024-01-02T00:00:00Z' },
            { id: 'rn3', kind: 'refund_notice', amount: 25, confirmation: 'confirmed_by_member', createdAt: '2024-01-03T00:00:00Z' }
        ]));
        const { result } = renderHook(() => useRefundNotices());
        await waitFor(() => expect(result.current.loading).toBe(false));
        // Only rn1 is an active, unresolved not_received.
        expect(result.current.activeNotReceivedCount).toBe(1);
    });

    it('resolveNotice writes resolution + serverTimestamp and optimistically updates', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'rn1', kind: 'refund_notice', amount: 100, confirmation: 'not_received', createdAt: '2024-01-01T00:00:00Z' }
        ]));
        const { result } = renderHook(() => useRefundNotices());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.resolveNotice('rn1', { type: 'dismissed', note: 'Paid via Zelle on 6/1' });
        });

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const [ref, data, options] = mockSetDoc.mock.calls[0];
        expect(ref._path).toContain('users/u1/billingYears/y1/disputes/rn1');
        expect(options).toEqual({ merge: true });
        expect(data.resolution.type).toBe('dismissed');
        expect(data.resolution.note).toBe('Paid via Zelle on 6/1');
        expect(data.resolution.resolvedAt).toBe('SERVER_TS');

        // Optimistic: rn1 now reads resolved → no longer counted as active.
        expect(result.current.activeNotReceivedCount).toBe(0);
    });

    it('sets error state when getDocs rejects', async () => {
        setupMocks();
        mockGetDocs.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(() => useRefundNotices());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('boom');
    });
});
