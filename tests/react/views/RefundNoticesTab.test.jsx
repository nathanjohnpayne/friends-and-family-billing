import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'test-user' } }))
}));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), doc: vi.fn(), getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
    setDoc: vi.fn(), serverTimestamp: vi.fn()
}));

const mockResolveNotice = vi.fn(() => Promise.resolve());
const mockReload = vi.fn();
let mockHookValue;

vi.mock('@/app/hooks/useRefundNotices.js', () => ({
    useRefundNotices: vi.fn(() => mockHookValue)
}));

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => ({
        familyMembers: [{ id: 1, name: 'Alice', email: 'alice@test.com', linkedMembers: [] }],
        activeYear: { id: '2026', label: '2026', status: 'settling' }
    }))
}));

import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import RefundNoticesTab from '@/app/views/Manage/RefundNoticesTab.jsx';

function renderTab() {
    return render(<ToastProvider><RefundNoticesTab /></ToastProvider>);
}

const activeNotReceived = {
    id: 'rn1', kind: 'refund_notice', memberId: 1, memberName: 'Alice', amount: 68.98,
    method: 'venmo', reason: 'Returned overpayment', confirmation: 'not_received',
    createdAt: '2026-03-01T00:00:00Z'
};
const confirmedNotice = {
    id: 'rn2', kind: 'refund_notice', memberId: 1, memberName: 'Alice', amount: 20,
    method: 'zelle', reason: 'Q2 credit', confirmation: 'confirmed_by_member',
    createdAt: '2026-02-01T00:00:00Z'
};
const pendingNotice = {
    id: 'rn3', kind: 'refund_notice', memberId: 1, memberName: 'Alice', amount: 5,
    method: 'cash', reason: 'rounding', confirmation: null, createdAt: '2026-01-01T00:00:00Z'
};

describe('RefundNoticesTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockHookValue = {
            refundNotices: [activeNotReceived, confirmedNotice, pendingNotice],
            loading: false,
            error: null,
            activeNotReceivedCount: 1,
            reload: mockReload,
            resolveNotice: mockResolveNotice
        };
    });

    it('renders the refund notices with amount, member, and confirmation state', () => {
        renderTab();
        expect(screen.getByText('$68.98')).toBeInTheDocument();
        // Each card shows its member and confirmation badge.
        const card1 = screen.getByText('$68.98').closest('.refund-notice-card');
        expect(within(card1).getByText('Not Received')).toBeInTheDocument();
        const card2 = screen.getByText('$20.00').closest('.refund-notice-card');
        expect(within(card2).getByText('Confirmed')).toBeInTheDocument();
        const card3 = screen.getByText('$5.00').closest('.refund-notice-card');
        expect(within(card3).getByText('Sent')).toBeInTheDocument();
    });

    it('surfaces an actionable follow-up banner counting active not_received', () => {
        renderTab();
        // The count of active not_received reports is shown prominently in the banner.
        const banner = document.querySelector('.refund-followup-banner');
        expect(banner).not.toBeNull();
        expect(banner.textContent).toMatch(/1 refund/i);
        expect(banner.textContent).toMatch(/follow-?up/i);
    });

    it('offers re-send / cancel / dismiss actions on an active not_received notice', () => {
        renderTab();
        const card = screen.getByText('$68.98').closest('.refund-notice-card');
        expect(within(card).getByRole('button', { name: /re-?send/i })).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: /cancel/i })).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('does NOT offer resolution actions on a confirmed notice', () => {
        renderTab();
        const card = screen.getByText('$20.00').closest('.refund-notice-card');
        expect(within(card).queryByRole('button', { name: /re-?send/i })).not.toBeInTheDocument();
        expect(within(card).queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    });

    it('re-send resolves the notice with type "resent"', () => {
        renderTab();
        const card = screen.getByText('$68.98').closest('.refund-notice-card');
        fireEvent.click(within(card).getByRole('button', { name: /re-?send/i }));
        expect(mockResolveNotice).toHaveBeenCalledWith('rn1', expect.objectContaining({ type: 'resent' }));
    });

    it('cancel resolves the notice with type "cancelled"', () => {
        renderTab();
        const card = screen.getByText('$68.98').closest('.refund-notice-card');
        fireEvent.click(within(card).getByRole('button', { name: /cancel/i }));
        expect(mockResolveNotice).toHaveBeenCalledWith('rn1', expect.objectContaining({ type: 'cancelled' }));
    });

    it('dismiss requires a logged reason before resolving with type "dismissed"', () => {
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Paid via Zelle on 3/1');
        renderTab();
        const card = screen.getByText('$68.98').closest('.refund-notice-card');
        fireEvent.click(within(card).getByRole('button', { name: /dismiss/i }));
        expect(mockResolveNotice).toHaveBeenCalledWith('rn1', { type: 'dismissed', note: 'Paid via Zelle on 3/1' });
        promptSpy.mockRestore();
    });

    it('dismiss is aborted when the reason prompt is cancelled (no logged reason)', () => {
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
        renderTab();
        const card = screen.getByText('$68.98').closest('.refund-notice-card');
        fireEvent.click(within(card).getByRole('button', { name: /dismiss/i }));
        expect(mockResolveNotice).not.toHaveBeenCalled();
        promptSpy.mockRestore();
    });

    it('shows an empty state when there are no refund notices', () => {
        mockHookValue = { refundNotices: [], loading: false, error: null, activeNotReceivedCount: 0, reload: mockReload, resolveNotice: mockResolveNotice };
        renderTab();
        expect(screen.getByText(/no refund notices/i)).toBeInTheDocument();
    });

    it('shows a resolved badge once an active not_received has been resolved', () => {
        mockHookValue = {
            refundNotices: [{ ...activeNotReceived, resolution: { type: 'dismissed', note: 'paid' } }],
            loading: false, error: null, activeNotReceivedCount: 0, reload: mockReload, resolveNotice: mockResolveNotice
        };
        renderTab();
        // No longer actionable.
        const card = screen.getByText('$68.98').closest('.refund-notice-card');
        expect(within(card).queryByRole('button', { name: /re-?send/i })).not.toBeInTheDocument();
        expect(within(card).getByText(/resolved/i)).toBeInTheDocument();
    });

    it('shows loading and error states', () => {
        mockHookValue = { refundNotices: [], loading: true, error: null, activeNotReceivedCount: 0, reload: mockReload, resolveNotice: mockResolveNotice };
        const { rerender } = renderTab();
        expect(screen.getByText(/loading/i)).toBeInTheDocument();

        mockHookValue = { refundNotices: [], loading: false, error: 'boom', activeNotReceivedCount: 0, reload: mockReload, resolveNotice: mockResolveNotice };
        rerender(<ToastProvider><RefundNoticesTab /></ToastProvider>);
        expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
});
