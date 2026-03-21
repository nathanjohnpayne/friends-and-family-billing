import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockService = {
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn()
};

const mockState = {
    familyMembers: [
        { id: 1, name: 'Alice', email: 'a@b.com', phone: '+14155551212', avatar: '', linkedMembers: [2], paymentReceived: 0 },
        { id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
    ],
    bills: [],
    payments: [],
    activeYear: { id: '2026', label: '2026', status: 'open' },
    loading: false,
    service: mockService,
    saveQueue: { subscribe: vi.fn(() => () => {}) }
};

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => mockState)
}));

import { useBillingData } from '@/app/hooks/useBillingData.js';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import MembersTab from '@/app/views/Manage/MembersTab.jsx';

function renderTab(overrides = {}) {
    if (Object.keys(overrides).length > 0) {
        useBillingData.mockReturnValue({ ...mockState, ...overrides });
    }
    return render(<ToastProvider><MembersTab /></ToastProvider>);
}

describe('MembersTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useBillingData.mockReturnValue(mockState);
    });

    it('renders member count in header', () => {
        renderTab();
        expect(screen.getByText('Members (2)')).toBeInTheDocument();
    });

    it('renders member cards with names', () => {
        renderTab();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        // Bob appears both as a member card name and as a linked-pill inside Alice's card
        expect(screen.getAllByText('Bob').length).toBeGreaterThanOrEqual(1);
    });

    it('shows email and phone for members', () => {
        renderTab();
        expect(screen.getByText('a@b.com')).toBeInTheDocument();
        expect(screen.getByText('+14155551212')).toBeInTheDocument();
    });

    it('shows household pills for linked members', () => {
        renderTab();
        // Alice has Bob linked — Household label + Bob pill
        expect(screen.getByText('Household')).toBeInTheDocument();
        const pills = document.querySelectorAll('.linked-member-pill');
        expect(pills.length).toBe(1);
        expect(pills[0].textContent).toBe('Bob');
    });

    it('shows placeholder text for missing email', () => {
        renderTab();
        // Bob has no email
        expect(screen.getAllByText('Email not provided').length).toBeGreaterThanOrEqual(1);
    });

    it('shows Add Member button when year is open', () => {
        renderTab();
        expect(screen.getByText('+ Add Member')).toBeInTheDocument();
    });

    it('hides Add Member button when year is read-only', () => {
        renderTab({ activeYear: { id: '2024', label: '2024', status: 'closed' } });
        expect(screen.queryByText('+ Add Member')).toBeNull();
    });

    it('opens composer on Add Member click', () => {
        renderTab();
        fireEvent.click(screen.getByText('+ Add Member'));
        expect(screen.getByPlaceholderText('Name *')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    });

    it('calls service.addMember on form submit', () => {
        mockService.addMember.mockReturnValue({ id: 99, name: 'Carol' });
        renderTab();
        fireEvent.click(screen.getByText('+ Add Member'));
        fireEvent.change(screen.getByPlaceholderText('Name *'), { target: { value: 'Carol' } });
        fireEvent.click(screen.getByText('Add Member'));
        expect(mockService.addMember).toHaveBeenCalledWith({ name: 'Carol', email: '', phone: '' });
    });

    it('shows error when addMember throws', () => {
        mockService.addMember.mockImplementation(() => { throw new Error('already exists'); });
        renderTab();
        fireEvent.click(screen.getByText('+ Add Member'));
        fireEvent.change(screen.getByPlaceholderText('Name *'), { target: { value: 'Alice' } });
        fireEvent.click(screen.getByText('Add Member'));
        expect(screen.getByText('already exists')).toBeInTheDocument();
    });

    it('shows delete confirmation dialog', () => {
        renderTab();
        // Open action menu for Alice
        const triggers = screen.getAllByLabelText(/Actions for/);
        fireEvent.click(triggers[0]);
        fireEvent.click(screen.getByText('Delete Member'));
        expect(screen.getByText(/Remove Alice from family members/)).toBeInTheDocument();
    });

    it('calls service.removeMember on confirm', () => {
        renderTab();
        const triggers = screen.getAllByLabelText(/Actions for/);
        fireEvent.click(triggers[0]);
        fireEvent.click(screen.getByText('Delete Member'));
        fireEvent.click(screen.getByText('Remove'));
        expect(mockService.removeMember).toHaveBeenCalledWith(1);
    });

    it('shows empty state when no members', () => {
        renderTab({ familyMembers: [] });
        expect(screen.getByText('No family members yet')).toBeInTheDocument();
    });

    it('shows loading state', () => {
        renderTab({ loading: true });
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });
});
