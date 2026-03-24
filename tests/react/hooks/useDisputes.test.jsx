import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase
vi.mock('../../../src/lib/firebase.js', () => ({ db: {}, storage: {} }));

// Mock firebase/firestore — return trackable ref objects so tests can verify Firestore paths
const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn();
const mockCollection = vi.fn((...segments) => ({ _type: 'collection', _path: segments.filter(s => typeof s === 'string').join('/') }));
const mockDoc = vi.fn((...segments) => ({ _type: 'doc', _path: segments.filter(s => typeof s === 'string').join('/') }));
vi.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    doc: (...args) => mockDoc(...args),
    getDocs: (...args) => mockGetDocs(...args),
    setDoc: (...args) => mockSetDoc(...args),
    serverTimestamp: vi.fn(() => 'SERVER_TS')
}));

// Mock firebase/storage
const mockUploadBytes = vi.fn();
const mockGetDownloadURL = vi.fn();
const mockDeleteObject = vi.fn();
vi.mock('firebase/storage', () => ({
    ref: vi.fn(),
    uploadBytes: (...args) => mockUploadBytes(...args),
    getDownloadURL: (...args) => mockGetDownloadURL(...args),
    deleteObject: (...args) => mockDeleteObject(...args)
}));

// Mock AuthContext
vi.mock('../../../src/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn()
}));

// Mock useBillingData
vi.mock('../../../src/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn()
}));

// Mock validation
vi.mock('../../../src/lib/validation.js', () => ({
    normalizeDisputeStatus: vi.fn(s => s === 'dispute' ? 'open' : s)
}));

import { useAuth } from '../../../src/app/contexts/AuthContext.jsx';
import { useBillingData } from '../../../src/app/hooks/useBillingData.js';
import { normalizeDisputeStatus } from '../../../src/lib/validation.js';
import { useDisputes } from '../../../src/app/hooks/useDisputes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupMocks(user = { uid: 'u1' }, activeYear = { id: 'y1' }) {
    useAuth.mockReturnValue({ user });
    useBillingData.mockReturnValue({ activeYear });
}

/** Build a fake Firestore QuerySnapshot from an array of {id, ...data} objects. */
function fakeSnap(docs) {
    return {
        docs: docs.map(d => ({
            id: d.id,
            data: () => {
                const { id, ...rest } = d;
                return { ...rest };
            }
        }))
    };
}

function makeFile({ name = 'test.pdf', type = 'application/pdf', size = 1024 } = {}) {
    return { name, type, size };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDisputes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([]));
        mockSetDoc.mockResolvedValue(undefined);
        mockUploadBytes.mockResolvedValue(undefined);
        mockGetDownloadURL.mockResolvedValue('https://storage.example.com/file');
        mockDeleteObject.mockResolvedValue(undefined);
    });

    // -----------------------------------------------------------------------
    // 1. No user or no activeYear -> no-op load
    // -----------------------------------------------------------------------
    describe('loading without user or activeYear', () => {
        it('returns empty disputes when user is null', async () => {
            setupMocks(null, { id: 'y1' });

            const { result } = renderHook(() => useDisputes());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.disputes).toEqual([]);
            expect(result.current.error).toBeNull();
            expect(mockGetDocs).not.toHaveBeenCalled();
        });

        it('returns empty disputes when activeYear is null', async () => {
            setupMocks({ uid: 'u1' }, null);

            const { result } = renderHook(() => useDisputes());

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.disputes).toEqual([]);
            expect(mockGetDocs).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // 2. Load normalizes legacy statuses
    // -----------------------------------------------------------------------
    it('normalizes legacy dispute statuses via normalizeDisputeStatus', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'dispute', createdAt: '2024-01-01T00:00:00Z' },
            { id: 'd2', status: 'resolved', createdAt: '2024-01-02T00:00:00Z' }
        ]));

        const { result } = renderHook(() => useDisputes());

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Verify the correct Firestore collection path was used
        expect(mockCollection).toHaveBeenCalled();
        const colRef = mockCollection.mock.results[0].value;
        expect(colRef._path).toContain('users/u1/billingYears/y1/disputes');

        expect(normalizeDisputeStatus).toHaveBeenCalledWith('dispute');
        expect(normalizeDisputeStatus).toHaveBeenCalledWith('resolved');

        const d1 = result.current.disputes.find(d => d.id === 'd1');
        expect(d1.status).toBe('open');

        const d2 = result.current.disputes.find(d => d.id === 'd2');
        expect(d2.status).toBe('resolved');
    });

    // -----------------------------------------------------------------------
    // 3. Load sorts by createdAt descending
    // -----------------------------------------------------------------------
    describe('sorting', () => {
        it('sorts disputes by createdAt descending with ISO strings', async () => {
            setupMocks();
            mockGetDocs.mockResolvedValue(fakeSnap([
                { id: 'old', status: 'open', createdAt: '2024-01-01T00:00:00Z' },
                { id: 'new', status: 'open', createdAt: '2024-06-15T00:00:00Z' },
                { id: 'mid', status: 'open', createdAt: '2024-03-10T00:00:00Z' }
            ]));

            const { result } = renderHook(() => useDisputes());
            await waitFor(() => expect(result.current.loading).toBe(false));

            const ids = result.current.disputes.map(d => d.id);
            expect(ids).toEqual(['new', 'mid', 'old']);
        });

        it('sorts disputes by createdAt descending with Firestore Timestamps', async () => {
            setupMocks();
            const makeTs = (ms) => ({ toDate: () => new Date(ms) });
            mockGetDocs.mockResolvedValue(fakeSnap([
                { id: 'a', status: 'open', createdAt: makeTs(1000) },
                { id: 'b', status: 'open', createdAt: makeTs(3000) },
                { id: 'c', status: 'open', createdAt: makeTs(2000) }
            ]));

            const { result } = renderHook(() => useDisputes());
            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.disputes.map(d => d.id)).toEqual(['b', 'c', 'a']);
        });

        it('treats missing createdAt as epoch 0 (sorts last)', async () => {
            setupMocks();
            mockGetDocs.mockResolvedValue(fakeSnap([
                { id: 'noDate', status: 'open' },
                { id: 'hasDate', status: 'open', createdAt: '2024-06-01T00:00:00Z' }
            ]));

            const { result } = renderHook(() => useDisputes());
            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.disputes[0].id).toBe('hasDate');
            expect(result.current.disputes[1].id).toBe('noDate');
        });
    });

    // -----------------------------------------------------------------------
    // 4. Load error
    // -----------------------------------------------------------------------
    it('sets error when getDocs rejects', async () => {
        setupMocks();
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockGetDocs.mockRejectedValue(new Error('Firestore unavailable'));

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe('Firestore unavailable');
        expect(result.current.disputes).toEqual([]);

        consoleSpy.mockRestore();
    });

    // -----------------------------------------------------------------------
    // 5. updateDispute writes merged data
    // -----------------------------------------------------------------------
    it('calls setDoc with correct doc path, merge: true, and serverTimestamp', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'open', createdAt: '2024-01-01T00:00:00Z' }
        ]));

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateDispute('d1', { status: 'resolved' });
        });

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const [docRef, fields, options] = mockSetDoc.mock.calls[0];

        // Verify the exact Firestore document path
        expect(docRef._type).toBe('doc');
        expect(docRef._path).toContain('users/u1/billingYears/y1/disputes/d1');

        expect(fields).toEqual({ status: 'resolved', updatedAt: 'SERVER_TS' });
        expect(options).toEqual({ merge: true });
    });

    // -----------------------------------------------------------------------
    // 6. updateDispute optimistic state
    // -----------------------------------------------------------------------
    it('optimistically updates the local disputes array', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'open', amount: 50, createdAt: '2024-01-01T00:00:00Z' },
            { id: 'd2', status: 'open', amount: 100, createdAt: '2024-01-02T00:00:00Z' }
        ]));

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateDispute('d1', { status: 'resolved', resolution: 'accepted' });
        });

        const updated = result.current.disputes.find(d => d.id === 'd1');
        expect(updated.status).toBe('resolved');
        expect(updated.resolution).toBe('accepted');
        // Other dispute should be unchanged
        const other = result.current.disputes.find(d => d.id === 'd2');
        expect(other.status).toBe('open');
    });

    // -----------------------------------------------------------------------
    // 7. uploadEvidence rejects invalid type
    // -----------------------------------------------------------------------
    it('throws when uploading a file with invalid type', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'open', createdAt: '2024-01-01T00:00:00Z' }
        ]));

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await expect(
            act(() => result.current.uploadEvidence('d1', makeFile({ type: 'text/plain' })))
        ).rejects.toThrow('Only PDF, PNG, and JPEG files are allowed.');

        expect(mockUploadBytes).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // 8. uploadEvidence rejects oversize
    // -----------------------------------------------------------------------
    it('throws when uploading a file exceeding 20 MB', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'open', createdAt: '2024-01-01T00:00:00Z' }
        ]));

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        const oversized = makeFile({ size: 21 * 1024 * 1024 });

        await expect(
            act(() => result.current.uploadEvidence('d1', oversized))
        ).rejects.toThrow('File is too large. Maximum size is 20 MB.');

        expect(mockUploadBytes).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // 9. uploadEvidence rejects >10 files
    // -----------------------------------------------------------------------
    it('throws when dispute already has 10 evidence items', async () => {
        setupMocks();
        const tenItems = Array.from({ length: 10 }, (_, i) => ({ name: `file${i}.pdf` }));
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'open', evidence: tenItems, createdAt: '2024-01-01T00:00:00Z' }
        ]));

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await expect(
            act(() => result.current.uploadEvidence('d1', makeFile()))
        ).rejects.toThrow('Maximum of 10 evidence files per dispute.');

        expect(mockUploadBytes).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // 10. uploadEvidence success
    // -----------------------------------------------------------------------
    it('uploads file, gets download URL, and updates dispute with new evidence', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'open', evidence: [], createdAt: '2024-01-01T00:00:00Z' }
        ]));
        mockGetDownloadURL.mockResolvedValue('https://storage.example.com/uploaded.pdf');

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        const file = makeFile({ name: 'receipt.pdf', type: 'application/pdf', size: 2048 });

        await act(async () => {
            await result.current.uploadEvidence('d1', file);
        });

        expect(mockUploadBytes).toHaveBeenCalledTimes(1);
        expect(mockGetDownloadURL).toHaveBeenCalledTimes(1);

        // setDoc should have been called with evidence array containing new entry
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const writtenFields = mockSetDoc.mock.calls[0][1];
        expect(writtenFields.evidence).toHaveLength(1);
        expect(writtenFields.evidence[0]).toMatchObject({
            name: 'receipt.pdf',
            contentType: 'application/pdf',
            size: 2048,
            downloadUrl: 'https://storage.example.com/uploaded.pdf'
        });
        expect(writtenFields.evidence[0].storagePath).toContain('receipt.pdf');
        expect(writtenFields.evidence[0].uploadedAt).toBeDefined();

        // Optimistic update in local state
        const dispute = result.current.disputes.find(d => d.id === 'd1');
        expect(dispute.evidence).toHaveLength(1);
    });

    // -----------------------------------------------------------------------
    // 11. uploadEvidence tolerates getDownloadURL failure
    // -----------------------------------------------------------------------
    it('adds evidence with empty downloadUrl when getDownloadURL fails', async () => {
        setupMocks();
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'open', evidence: [], createdAt: '2024-01-01T00:00:00Z' }
        ]));
        mockGetDownloadURL.mockRejectedValue(new Error('Permission denied'));

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.uploadEvidence('d1', makeFile());
        });

        expect(mockUploadBytes).toHaveBeenCalledTimes(1);

        const writtenFields = mockSetDoc.mock.calls[0][1];
        expect(writtenFields.evidence[0].downloadUrl).toBe('');
    });

    // -----------------------------------------------------------------------
    // 12. removeEvidence deletes from Storage and updates Firestore
    // -----------------------------------------------------------------------
    it('deletes file from Storage and updates Firestore with filtered evidence', async () => {
        setupMocks();
        const evidence = [
            { name: 'keep.pdf', storagePath: 'users/u1/disputes/d1/keep.pdf' },
            { name: 'remove.pdf', storagePath: 'users/u1/disputes/d1/remove.pdf' },
            { name: 'also-keep.pdf', storagePath: 'users/u1/disputes/d1/also-keep.pdf' }
        ];
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'open', evidence, createdAt: '2024-01-01T00:00:00Z' }
        ]));

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.removeEvidence('d1', 1); // remove index 1
        });

        expect(mockDeleteObject).toHaveBeenCalledTimes(1);
        expect(mockSetDoc).toHaveBeenCalledTimes(1);

        const writtenFields = mockSetDoc.mock.calls[0][1];
        expect(writtenFields.evidence).toHaveLength(2);
        expect(writtenFields.evidence.map(e => e.name)).toEqual(['keep.pdf', 'also-keep.pdf']);
    });

    // -----------------------------------------------------------------------
    // 13. removeEvidence tolerates Storage deletion failure
    // -----------------------------------------------------------------------
    it('still updates Firestore when deleteObject throws', async () => {
        setupMocks();
        const evidence = [
            { name: 'file.pdf', storagePath: 'users/u1/disputes/d1/file.pdf' }
        ];
        mockGetDocs.mockResolvedValue(fakeSnap([
            { id: 'd1', status: 'open', evidence, createdAt: '2024-01-01T00:00:00Z' }
        ]));
        mockDeleteObject.mockRejectedValue(new Error('Storage error'));

        const { result } = renderHook(() => useDisputes());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.removeEvidence('d1', 0);
        });

        // deleteObject was attempted
        expect(mockDeleteObject).toHaveBeenCalledTimes(1);

        // Firestore update still happened
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const writtenFields = mockSetDoc.mock.calls[0][1];
        expect(writtenFields.evidence).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Additional edge-case coverage
    // -----------------------------------------------------------------------
    describe('edge cases', () => {
        it('updateDispute is a no-op when canLoad is false', async () => {
            setupMocks(null, null);

            const { result } = renderHook(() => useDisputes());
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.updateDispute('d1', { status: 'resolved' });
            });

            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('uploadEvidence is a no-op when dispute is not found', async () => {
            setupMocks();
            mockGetDocs.mockResolvedValue(fakeSnap([
                { id: 'd1', status: 'open', createdAt: '2024-01-01T00:00:00Z' }
            ]));

            const { result } = renderHook(() => useDisputes());
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.uploadEvidence('nonexistent', makeFile());
            });

            expect(mockUploadBytes).not.toHaveBeenCalled();
        });

        it('removeEvidence is a no-op when evidence array is missing', async () => {
            setupMocks();
            mockGetDocs.mockResolvedValue(fakeSnap([
                { id: 'd1', status: 'open', createdAt: '2024-01-01T00:00:00Z' }
                // no evidence property
            ]));

            const { result } = renderHook(() => useDisputes());
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.removeEvidence('d1', 0);
            });

            expect(mockDeleteObject).not.toHaveBeenCalled();
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('removeEvidence is a no-op when evidenceIndex is out of bounds', async () => {
            setupMocks();
            mockGetDocs.mockResolvedValue(fakeSnap([
                { id: 'd1', status: 'open', evidence: [{ name: 'a.pdf', storagePath: 'x' }], createdAt: '2024-01-01T00:00:00Z' }
            ]));

            const { result } = renderHook(() => useDisputes());
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.removeEvidence('d1', 5);
            });

            expect(mockDeleteObject).not.toHaveBeenCalled();
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('reload triggers a fresh load', async () => {
            setupMocks();
            mockGetDocs
                .mockResolvedValueOnce(fakeSnap([
                    { id: 'd1', status: 'open', createdAt: '2024-01-01T00:00:00Z' }
                ]))
                .mockResolvedValueOnce(fakeSnap([
                    { id: 'd1', status: 'open', createdAt: '2024-01-01T00:00:00Z' },
                    { id: 'd2', status: 'open', createdAt: '2024-01-02T00:00:00Z' }
                ]));

            const { result } = renderHook(() => useDisputes());
            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.disputes).toHaveLength(1);

            await act(async () => {
                await result.current.reload();
            });

            await waitFor(() => expect(result.current.disputes).toHaveLength(2));
        });

        it('allows PNG and JPEG uploads', async () => {
            setupMocks();
            mockGetDocs.mockResolvedValue(fakeSnap([
                { id: 'd1', status: 'open', evidence: [], createdAt: '2024-01-01T00:00:00Z' }
            ]));

            const { result } = renderHook(() => useDisputes());
            await waitFor(() => expect(result.current.loading).toBe(false));

            // PNG
            await act(async () => {
                await result.current.uploadEvidence('d1', makeFile({ name: 'img.png', type: 'image/png' }));
            });
            expect(mockUploadBytes).toHaveBeenCalledTimes(1);

            // Need to re-render with updated disputes for the next upload to see existing evidence
            // Reset for JPEG test by re-rendering
            mockUploadBytes.mockClear();
            mockGetDocs.mockResolvedValue(fakeSnap([
                { id: 'd1', status: 'open', evidence: [{ name: 'img.png' }], createdAt: '2024-01-01T00:00:00Z' }
            ]));

            const { result: result2 } = renderHook(() => useDisputes());
            await waitFor(() => expect(result2.current.loading).toBe(false));

            await act(async () => {
                await result2.current.uploadEvidence('d1', makeFile({ name: 'photo.jpg', type: 'image/jpeg' }));
            });
            expect(mockUploadBytes).toHaveBeenCalledTimes(1);
        });
    });
});
