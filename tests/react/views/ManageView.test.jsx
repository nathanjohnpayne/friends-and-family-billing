import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock Firebase (needed by ReviewsTab → useDisputes)
vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), doc: vi.fn(), getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
    setDoc: vi.fn(), serverTimestamp: vi.fn(), deleteDoc: vi.fn()
}));
vi.mock('firebase/storage', () => ({
    ref: vi.fn(), deleteObject: vi.fn()
}));

// Mock auth (needed by useDisputes)
vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'test-user' } }))
}));

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => ({
        familyMembers: [{ id: 1, name: 'Alice', email: 'a@b.com', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }],
        bills: [{ id: 'b1', name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1], logo: '', website: '' }],
        payments: [],
        activeYear: { id: '2026', label: '2026', status: 'open' },
        loading: false,
        service: { addMember: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn(), addBill: vi.fn(), updateBill: vi.fn(), removeBill: vi.fn(), toggleBillMember: vi.fn(), updateSettings: vi.fn(), getState: vi.fn(() => ({ settings: { emailMessage: '', paymentMethods: [] } })) },
        saveQueue: { subscribe: vi.fn(() => () => {}) }
    }))
}));

import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import ManageView from '@/app/views/Manage/ManageView.jsx';
import MembersTab from '@/app/views/Manage/MembersTab.jsx';
import BillsTab from '@/app/views/Manage/BillsTab.jsx';
import InvoicingTab from '@/app/views/Manage/InvoicingTab.jsx';
import ReviewsTab from '@/app/views/Manage/ReviewsTab.jsx';

function renderManage(tab = 'members') {
    return render(
        <ToastProvider>
            <MemoryRouter initialEntries={['/manage/' + tab]}>
                <Routes>
                    <Route path="/manage" element={<ManageView />}>
                        <Route path="members" element={<MembersTab />} />
                        <Route path="bills" element={<BillsTab />} />
                        <Route path="invoicing" element={<InvoicingTab />} />
                        <Route path="reviews" element={<ReviewsTab />} />
                    </Route>
                </Routes>
            </MemoryRouter>
        </ToastProvider>
    );
}

describe('ManageView', () => {
    it('renders all four tab links', () => {
        renderManage();
        expect(screen.getByText('Members')).toBeInTheDocument();
        expect(screen.getByText('Bills')).toBeInTheDocument();
        expect(screen.getByText('Invoicing')).toBeInTheDocument();
        expect(screen.getByText('Review Requests')).toBeInTheDocument();
    });

    it('renders MembersTab content when on members route', () => {
        renderManage('members');
        expect(screen.getByText(/Members \(1\)/)).toBeInTheDocument();
    });

    it('renders BillsTab content when on bills route', () => {
        renderManage('bills');
        expect(screen.getByText(/Bills \(1\)/)).toBeInTheDocument();
    });

    it('renders InvoicingTab content', () => {
        renderManage('invoicing');
        expect(screen.getByText('Email Template')).toBeInTheDocument();
    });

    it('renders ReviewsTab content', () => {
        renderManage('reviews');
        expect(screen.getByText(/Review Requests/)).toBeInTheDocument();
    });

    it('marks current tab as active', () => {
        renderManage('bills');
        const billsLink = screen.getByText('Bills').closest('a');
        expect(billsLink).toHaveAttribute('aria-current', 'page');
    });
});
