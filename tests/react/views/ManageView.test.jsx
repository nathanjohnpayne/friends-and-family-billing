import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => ({
        familyMembers: [{ id: 1, name: 'Alice', linkedMembers: [] }],
        bills: [{ id: 'b1', name: 'Internet', amount: 100, frequency: 'monthly', members: [1] }],
        payments: [],
        loading: false,
        service: {},
        saveQueue: { subscribe: vi.fn(() => () => {}) }
    }))
}));

import ManageView from '@/app/views/Manage/ManageView.jsx';
import MembersTab from '@/app/views/Manage/MembersTab.jsx';
import BillsTab from '@/app/views/Manage/BillsTab.jsx';
import InvoicingTab from '@/app/views/Manage/InvoicingTab.jsx';
import ReviewsTab from '@/app/views/Manage/ReviewsTab.jsx';

function renderManage(tab = 'members') {
    return render(
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
        expect(screen.getByText(/Template editor/)).toBeInTheDocument();
    });

    it('renders ReviewsTab content', () => {
        renderManage('reviews');
        expect(screen.getByText(/Dispute cards/)).toBeInTheDocument();
    });

    it('marks current tab as active', () => {
        renderManage('bills');
        const billsLink = screen.getByText('Bills');
        expect(billsLink.className).toContain('active');
    });
});
