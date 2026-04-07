import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/firebase.js', () => ({ db: {} }));

const mockWriteBatch = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn(() => Promise.resolve());
const mockGetDocs = vi.fn();
const mockDoc = vi.fn((_db, _coll, id) => ({ id, path: _coll + '/' + id }));
const mockCollection = vi.fn();
const mockQuery = vi.fn();
const mockWhere = vi.fn();
const mockServerTimestamp = vi.fn(() => 'SERVER_TS');

vi.mock('firebase/firestore', () => ({
    doc: (...args) => mockDoc(...args),
    setDoc: vi.fn(),
    getDocs: (...args) => mockGetDocs(...args),
    collection: (...args) => mockCollection(...args),
    query: (...args) => mockQuery(...args),
    where: (...args) => mockWhere(...args),
    writeBatch: () => {
        mockWriteBatch();
        return { set: mockBatchSet, update: mockBatchUpdate, delete: mockBatchDelete, commit: mockBatchCommit };
    },
    serverTimestamp: () => mockServerTimestamp(),
}));

vi.mock('@/lib/validation.js', () => ({
    generateRawToken: vi.fn(() => 'test-raw-token-abc123'),
    hashToken: vi.fn(async () => 'test-hash-abc123'),
}));

vi.mock('@/lib/share.js', () => ({
    buildShareScopes: vi.fn((_a, _b) => ['summary:read', 'paymentMethods:read']),
    buildShareTokenDoc: vi.fn((_uid, _mid, _name, _byid, rawToken, _exp, _scopes) => ({
        ownerId: _uid,
        memberId: _mid,
        memberName: _name,
        billingYearId: _byid,
        rawToken: rawToken,
        scopes: _scopes,
        revoked: false,
        expiresAt: _exp,
        lastAccessedAt: null,
        accessCount: 0,
    })),
    buildShareUrl: vi.fn((_origin, token) => 'https://example.com/share?token=' + token),
    buildPublicShareData: vi.fn(() => ({
        memberName: 'Alice',
        memberId: 1,
        billingYearId: '2026',
        scopes: ['summary:read'],
        ownerId: 'user-1',
        summary: { name: 'Alice' },
    })),
    computeExpiryDate: vi.fn((days) => (days > 0 ? new Date('2027-04-06') : null)),
}));

// Stub window.location.origin for URL building
Object.defineProperty(window, 'location', {
    value: { origin: 'https://example.com', href: '' },
    writable: true,
});

import { createAndPruneShareLink } from '@/lib/ShareLinkService.js';
import { generateRawToken, hashToken } from '@/lib/validation.js';
import { buildShareTokenDoc, computeExpiryDate } from '@/lib/share.js';

const baseOpts = {
    userId: 'user-1',
    memberId: 1,
    memberName: 'Alice',
    billingYearId: '2026',
    familyMembers: [{ id: 1, name: 'Alice' }],
    bills: [{ id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }],
    payments: [],
    activeYear: { id: '2026', label: '2026' },
    settings: {},
};

beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing links
    mockGetDocs.mockResolvedValue({ docs: [] });
});

describe('createAndPruneShareLink', () => {
    it('returns url, tokenHash, and rawToken', async () => {
        const result = await createAndPruneShareLink(baseOpts);
        expect(result.url).toBe('https://example.com/share?token=test-raw-token-abc123');
        expect(result.tokenHash).toBe('test-hash-abc123');
        expect(result.rawToken).toBe('test-raw-token-abc123');
    });

    it('uses 365-day expiry by default', async () => {
        await createAndPruneShareLink(baseOpts);
        expect(computeExpiryDate).toHaveBeenCalledWith(365);
    });

    it('passes custom expiryDays when provided', async () => {
        await createAndPruneShareLink({ ...baseOpts, expiryDays: 30 });
        expect(computeExpiryDate).toHaveBeenCalledWith(30);
    });

    it('uses default scopes when none provided', async () => {
        await createAndPruneShareLink(baseOpts);
        // buildShareTokenDoc receives the default scopes from the service
        expect(buildShareTokenDoc).toHaveBeenCalled();
        const callArgs = buildShareTokenDoc.mock.calls[0];
        expect(callArgs[6]).toEqual(['summary:read', 'paymentMethods:read', 'disputes:create', 'disputes:read']);
    });

    it('uses custom scopes when provided', async () => {
        const customScopes = ['summary:read'];
        await createAndPruneShareLink({ ...baseOpts, scopes: customScopes });
        const callArgs = buildShareTokenDoc.mock.calls[0];
        expect(callArgs[6]).toEqual(['summary:read']);
    });

    it('always includes rawToken in the token doc', async () => {
        await createAndPruneShareLink(baseOpts);
        const callArgs = buildShareTokenDoc.mock.calls[0];
        expect(callArgs[4]).toBe('test-raw-token-abc123');
    });

    it('creates shareTokens and publicShares docs in a batch', async () => {
        await createAndPruneShareLink(baseOpts);
        expect(mockBatchSet).toHaveBeenCalledTimes(2); // shareTokens + publicShares
        expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    it('prunes links beyond the most recent 5', async () => {
        // Simulate 5 existing active links (need to prune 1 to stay at 5 after adding new)
        const existingDocs = Array.from({ length: 5 }, (_, i) => ({
            id: 'existing-' + i,
            data: () => ({
                createdAt: { toDate: () => new Date(2026, 3, 1 + i) },
            }),
        }));
        mockGetDocs.mockResolvedValue({ docs: existingDocs });

        await createAndPruneShareLink(baseOpts);

        // Keep most recent 4 (MAX_ACTIVE_LINKS - 1), prune the oldest 1
        expect(mockBatchUpdate).toHaveBeenCalledTimes(1); // revoke 1 old link
        expect(mockBatchDelete).toHaveBeenCalledTimes(1); // delete 1 publicShares doc
    });

    it('does not prune when fewer than 5 existing links', async () => {
        const existingDocs = Array.from({ length: 3 }, (_, i) => ({
            id: 'existing-' + i,
            data: () => ({
                createdAt: { toDate: () => new Date(2026, 3, 1 + i) },
            }),
        }));
        mockGetDocs.mockResolvedValue({ docs: existingDocs });

        await createAndPruneShareLink(baseOpts);

        expect(mockBatchUpdate).not.toHaveBeenCalled(); // no pruning needed
        expect(mockBatchDelete).not.toHaveBeenCalled();
    });

    it('calls generateRawToken and hashToken', async () => {
        await createAndPruneShareLink(baseOpts);
        expect(generateRawToken).toHaveBeenCalledTimes(1);
        expect(hashToken).toHaveBeenCalledWith('test-raw-token-abc123');
    });
});
