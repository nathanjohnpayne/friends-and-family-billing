import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Settings → Payment Methods: editing methods persists settings and syncs the
// owner's share pages (publicShares.paymentMethods + publicQrCodes) through the
// shared src/lib/paymentMethodsSync.js helper.

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
vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'owner-uid', email: 'owner@example.com' } }))
}));
vi.mock('@/app/components/BillingYearSelector.jsx', () => ({ default: () => null }));

const QR = 'data:image/png;base64,AAAA';
const mockService = {
    updateSettings: vi.fn(),
    getState: vi.fn(() => ({
        settings: {
            paymentMethods: [
                { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, handle: '@owner', qrCode: QR },
                { id: 'pm_2', type: 'zelle', label: 'Zelle', enabled: true, email: 'pay@example.com', hasQrCode: false },
            ],
        },
    })),
};

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => ({
        activeYear: { id: '2026', label: '2026', status: 'open' },
        loading: false,
        service: mockService,
    })),
}));

import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import SettingsView from '@/app/views/Settings/SettingsView.jsx';

describe('SettingsView payment methods → share sync', () => {
    beforeEach(() => {
        Object.values(fs).forEach(fn => fn.mockClear());
        fs.getDocs.mockReset();
        mockService.updateSettings.mockClear();
    });

    it('persists the update and syncs publicShares and publicQrCodes for the owner', async () => {
        fs.getDocs.mockResolvedValue({
            docs: [
                { id: 'hash_active', data: () => ({ revoked: false }) },
                { id: 'hash_revoked', data: () => ({ revoked: true }) },
            ],
        });
        const user = userEvent.setup();
        render(<ToastProvider><SettingsView /></ToastProvider>);

        await user.click(screen.getAllByRole('button', { name: 'Set as preferred' })[1]);

        expect(mockService.updateSettings).toHaveBeenCalledWith({ paymentMethods: expect.any(Array) });
        expect(await screen.findByText('Payment methods updated')).toBeInTheDocument();

        expect(fs.where).toHaveBeenCalledWith('ownerId', '==', 'owner-uid');
        await waitFor(() => expect(fs.updateDoc).toHaveBeenCalledTimes(1));
        const [shareRef, sharePatch] = fs.updateDoc.mock.calls[0];
        expect(shareRef).toEqual({ path: 'publicShares/hash_active' });
        expect(sharePatch.paymentMethods.map(m => m.id)).toEqual(['pm_1', 'pm_2']);
        expect(sharePatch.paymentMethods[0]).toEqual(expect.objectContaining({ hasQrCode: true }));
        expect(sharePatch.paymentMethods[0]).not.toHaveProperty('qrCode');

        expect(fs.setDoc).toHaveBeenCalledWith(
            { path: 'publicQrCodes/owner-uid_pm_1' },
            expect.objectContaining({ ownerId: 'owner-uid', methodId: 'pm_1', qrCode: QR }),
        );
        // A method explicitly without a QR code has its public QR doc removed.
        await waitFor(() => expect(fs.deleteDoc).toHaveBeenCalledWith({ path: 'publicQrCodes/owner-uid_pm_2' }));
    });
});

describe('SettingsView payment-method switch (#575 F14)', () => {
    beforeEach(() => {
        Object.values(fs).forEach(fn => fn.mockClear());
        fs.getDocs.mockReset();
        fs.getDocs.mockResolvedValue({ docs: [] });
        mockService.updateSettings.mockClear();
    });

    it('exposes each On / Off control as a switch with a visible state word', () => {
        render(<ToastProvider><SettingsView /></ToastProvider>);

        const switches = screen.getAllByRole('switch');
        expect(switches).toHaveLength(2);
        switches.forEach(sw => expect(sw).toBeChecked());
        // The state is also written out, so it is never carried by colour alone.
        expect(screen.getAllByText('On')).toHaveLength(2);
        expect(screen.queryByText('Off')).not.toBeInTheDocument();
    });

    it('turns a method Off from the keyboard', async () => {
        const user = userEvent.setup();
        render(<ToastProvider><SettingsView /></ToastProvider>);

        const [first] = screen.getAllByRole('switch');
        first.focus();
        expect(first).toHaveFocus();
        await user.keyboard(' ');

        expect(mockService.updateSettings).toHaveBeenCalledTimes(1);
        const { paymentMethods } = mockService.updateSettings.mock.calls[0][0];
        expect(paymentMethods.find(m => m.id === 'pm_1').enabled).toBe(false);
        expect(paymentMethods.find(m => m.id === 'pm_2').enabled).toBe(true);
    });

    it('offers Add Payment Method as a button', () => {
        render(<ToastProvider><SettingsView /></ToastProvider>);
        expect(screen.getByRole('button', { name: 'Add Payment Method' })).toBeInTheDocument();
    });
});
