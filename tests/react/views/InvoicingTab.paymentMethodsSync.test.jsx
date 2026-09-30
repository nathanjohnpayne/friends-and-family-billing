import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Exercises the Invoicing tab's "Payment Methods" dialog: saving methods must
// sync the enabled methods to every active publicShares doc owned by the
// signed-in user. The owner uid reaches EmailTemplateSection as the `userId`
// prop from InvoicingTab's useAuth().

const mockGetDocs = vi.fn();
const mockUpdateDoc = vi.fn(() => Promise.resolve());
const mockWhere = vi.fn((...args) => ({ where: args }));

vi.mock('@/lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, col, id) => ({ path: col + '/' + id })),
    setDoc: vi.fn(),
    collection: vi.fn((_db, col) => ({ col })),
    query: vi.fn((col, ...clauses) => ({ col, clauses })),
    where: (...args) => mockWhere(...args),
    getDocs: (...args) => mockGetDocs(...args),
    updateDoc: (...args) => mockUpdateDoc(...args),
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
}));
vi.mock('@/lib/mail.js', () => ({ queueEmail: vi.fn() }));
vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'owner-uid', email: 'owner@example.com' } }))
}));

// Replace the TipTap editor with a stub that exposes the "configure payment
// methods" entry point, and the manager with a stub that saves a fixed list.
vi.mock('@/app/components/TemplateEditor.jsx', () => ({
    default: ({ onConfigurePaymentMethods }) => (
        <button type="button" onClick={onConfigurePaymentMethods}>Configure payment methods</button>
    ),
}));
vi.mock('@/app/components/PaymentMethodsManager.jsx', () => ({
    default: ({ onUpdate }) => (
        <button type="button" onClick={() => onUpdate([
            { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, handle: '@owner', qrCode: 'data:image/png;base64,AAAA' },
            { id: 'pm_2', type: 'zelle', label: 'Zelle', enabled: false },
        ])}>Save methods</button>
    ),
}));

const mockService = {
    updateSettings: vi.fn(),
    getState: vi.fn(() => ({ settings: { emailMessage: 'Hi', paymentMethods: [] } })),
};

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => ({
        familyMembers: [{ id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }],
        bills: [],
        payments: [],
        activeYear: { id: '2026', label: '2026', status: 'open' },
        loading: false,
        service: mockService,
        saveQueue: { subscribe: vi.fn(() => () => {}) },
    })),
}));

import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import InvoicingTab from '@/app/views/Manage/InvoicingTab.jsx';

describe('InvoicingTab payment methods → publicShares sync', () => {
    beforeEach(() => {
        mockGetDocs.mockReset();
        mockUpdateDoc.mockClear();
        mockWhere.mockClear();
        mockService.updateSettings.mockClear();
    });

    it('queries the signed-in owner\'s tokens and updates each active share with enabled methods', async () => {
        mockGetDocs.mockResolvedValue({
            docs: [
                { id: 'hash_active', data: () => ({ revoked: false }) },
                { id: 'hash_revoked', data: () => ({ revoked: true }) },
            ],
        });

        render(<ToastProvider><InvoicingTab /></ToastProvider>);
        fireEvent.click(screen.getByText('Configure payment methods'));
        fireEvent.click(screen.getByText('Save methods'));

        expect(mockService.updateSettings).toHaveBeenCalledWith({ paymentMethods: expect.any(Array) });
        expect(mockWhere).toHaveBeenCalledWith('ownerId', '==', 'owner-uid');
        await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1));

        const [ref, patch] = mockUpdateDoc.mock.calls[0];
        expect(ref).toEqual({ path: 'publicShares/hash_active' });
        expect(patch.updatedAt).toBe('SERVER_TS');
        expect(patch.paymentMethods).toEqual([
            { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, handle: '@owner', hasQrCode: true },
        ]);
    });
});
