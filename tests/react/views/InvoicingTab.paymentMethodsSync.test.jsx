import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The Invoicing template editor renders the %payment_methods% block as a card
// with a "Configure" button that opens the payment-methods manager in a
// dialog. Saving there must run the same share sync as the Settings page:
// publicShares.paymentMethods for the owner's active links AND publicQrCodes.
// Real TemplateEditor + PaymentMethodsManager; Firestore is mocked at the
// module boundary.

const fs = vi.hoisted(() => ({
    getDocs: vi.fn(),
    updateDoc: vi.fn(() => Promise.resolve()),
    setDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    where: vi.fn((...args) => ({ where: args })),
}));

vi.mock('@/lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, col, id) => ({ path: col + '/' + id })),
    setDoc: (...a) => fs.setDoc(...a),
    deleteDoc: (...a) => fs.deleteDoc(...a),
    collection: vi.fn((_db, col) => ({ col })),
    query: vi.fn((col, ...clauses) => ({ col, clauses })),
    where: (...a) => fs.where(...a),
    getDocs: (...a) => fs.getDocs(...a),
    updateDoc: (...a) => fs.updateDoc(...a),
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
}));
vi.mock('@/lib/mail.js', () => ({ queueEmail: vi.fn() }));
vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'owner-uid', email: 'owner@example.com' } }))
}));

const QR = 'data:image/png;base64,AAAA';
const mockService = {
    updateSettings: vi.fn(),
    getState: vi.fn(() => ({
        settings: {
            emailMessage: 'Hi %first_name%\n%payment_methods%',
            paymentMethods: [
                { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, handle: '@owner', qrCode: QR },
                { id: 'pm_2', type: 'zelle', label: 'Zelle', enabled: false, email: 'pay@example.com' },
            ],
        },
    })),
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

describe('InvoicingTab payment-methods "Configure" dialog → share sync', () => {
    beforeEach(() => {
        Object.values(fs).forEach(fn => fn.mockClear());
        fs.getDocs.mockReset();
        mockService.updateSettings.mockClear();
    });

    it('syncs publicShares and publicQrCodes for the signed-in owner, like Settings', async () => {
        fs.getDocs.mockResolvedValue({
            docs: [
                { id: 'hash_active', data: () => ({ revoked: false }) },
                { id: 'hash_revoked', data: () => ({ revoked: true }) },
            ],
        });
        const user = userEvent.setup();
        render(<ToastProvider><InvoicingTab /></ToastProvider>);

        await user.click(await screen.findByRole('button', { name: 'Configure' }));
        const dialog = screen.getByText('Payment Methods', { selector: '.dialog-title' }).closest('.dialog');
        await user.click(within(dialog).getAllByRole('button', { name: 'Set as preferred' })[0]);

        expect(mockService.updateSettings).toHaveBeenCalledWith({ paymentMethods: expect.any(Array) });

        // publicShares: owner-filtered token query, only active links, enabled methods, QR stripped.
        expect(fs.where).toHaveBeenCalledWith('ownerId', '==', 'owner-uid');
        await waitFor(() => expect(fs.updateDoc).toHaveBeenCalledTimes(1));
        const [shareRef, sharePatch] = fs.updateDoc.mock.calls[0];
        expect(shareRef).toEqual({ path: 'publicShares/hash_active' });
        expect(sharePatch.paymentMethods).toEqual([
            expect.objectContaining({ id: 'pm_1', hasQrCode: true, preferred: true }),
        ]);
        expect(sharePatch.paymentMethods[0]).not.toHaveProperty('qrCode');

        // publicQrCodes: the QR image is written under the owner's namespace.
        await waitFor(() => expect(fs.setDoc).toHaveBeenCalledWith(
            { path: 'publicQrCodes/owner-uid_pm_1' },
            expect.objectContaining({ ownerId: 'owner-uid', methodId: 'pm_1', qrCode: QR }),
        ));
    });
});
