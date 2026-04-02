import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockService = {
    switchYear: vi.fn(),
    setYearStatus: vi.fn(() => Promise.resolve()),
    createYear: vi.fn(() => Promise.resolve()),
    getSaveQueue: vi.fn(() => ({ subscribe: vi.fn(() => () => {}) }))
};

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => ({
        billingYears: [
            { id: '2025', label: '2025', status: 'archived' },
            { id: '2026', label: '2026', status: 'open' }
        ],
        activeYear: { id: '2026', label: '2026', status: 'open' },
        service: mockService,
        saveQueue: { subscribe: vi.fn(() => () => {}) }
    }))
}));

import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import BillingYearSelector from '@/app/components/BillingYearSelector.jsx';
import { useBillingData } from '@/app/hooks/useBillingData.js';

function renderSelector(overrides = {}) {
    if (Object.keys(overrides).length > 0) {
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'open' }],
            activeYear: { id: '2026', label: '2026', status: 'open' },
            service: mockService,
            saveQueue: { subscribe: vi.fn(() => () => {}) },
            ...overrides
        });
    }
    return render(<ToastProvider><BillingYearSelector /></ToastProvider>);
}

describe('BillingYearSelector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useBillingData.mockReturnValue({
            billingYears: [
                { id: '2025', label: '2025', status: 'archived' },
                { id: '2026', label: '2026', status: 'open' }
            ],
            activeYear: { id: '2026', label: '2026', status: 'open' },
            service: mockService,
            saveQueue: { subscribe: vi.fn(() => () => {}) }
        });
    });

    it('renders the year selector with options', () => {
        renderSelector();
        expect(screen.getByText('Billing Controls')).toBeInTheDocument();
        expect(screen.getByLabelText('Active Year')).toBeInTheDocument();
        const select = screen.getByRole('combobox');
        expect(select.value).toBe('2026');
    });

    it('calls switchYear when selection changes', () => {
        renderSelector();
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: '2025' } });
        expect(mockService.switchYear).toHaveBeenCalledWith('2025');
    });

    it('does not show forward transitions (moved to dashboard)', () => {
        renderSelector();
        // Start Settlement is now on the dashboard, not here
        expect(screen.queryByText('Start Settlement')).toBeNull();
    });

    it('shows Back to Open for settling year', () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'settling' }],
            activeYear: { id: '2026', label: '2026', status: 'settling' }
        });
        expect(screen.getByText('Back to Open')).toBeInTheDocument();
        // Close Year is on the dashboard now
        expect(screen.queryByText('Close Year')).toBeNull();
    });

    it('calls setYearStatus via Back to Open with confirmation', async () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'settling' }],
            activeYear: { id: '2026', label: '2026', status: 'settling' }
        });
        fireEvent.click(screen.getByText('Back to Open'));
        expect(screen.getByText('Confirm Action')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByText('Confirm'));
        });
        expect(mockService.setYearStatus).toHaveBeenCalledWith('open');
    });

    it('shows Reopen to Settling for closed year (no Archive Year)', () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'closed' }],
            activeYear: { id: '2026', label: '2026', status: 'closed' }
        });
        expect(screen.getByText('Reopen to Settling')).toBeInTheDocument();
        // Archive Year is on the dashboard now
        expect(screen.queryByText('Archive Year')).toBeNull();
    });

    it('does not call setYearStatus when confirm is cancelled', () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'settling' }],
            activeYear: { id: '2026', label: '2026', status: 'settling' }
        });
        fireEvent.click(screen.getByText('Back to Open'));
        fireEvent.click(screen.getByText('Cancel'));
        expect(mockService.setYearStatus).not.toHaveBeenCalled();
    });

    it('Start New Year opens label input dialog', () => {
        renderSelector();
        fireEvent.click(screen.getByText('Start New Year'));
        expect(screen.getByText('Start New Billing Year')).toBeInTheDocument();
        expect(screen.getByLabelText('Billing year label')).toBeInTheDocument();
    });

    it('calls createYear with entered label', async () => {
        renderSelector();
        fireEvent.click(screen.getByText('Start New Year'));
        const input = screen.getByLabelText('Billing year label');
        fireEvent.change(input, { target: { value: '2027' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Create Year'));
        });
        expect(mockService.createYear).toHaveBeenCalledWith('2027');
    });

    it('shows error for duplicate year label', () => {
        renderSelector();
        fireEvent.click(screen.getByText('Start New Year'));
        const input = screen.getByLabelText('Billing year label');
        fireEvent.change(input, { target: { value: '2026' } });
        fireEvent.click(screen.getByText('Create Year'));
        expect(screen.getByText(/already exists/)).toBeInTheDocument();
        expect(mockService.createYear).not.toHaveBeenCalled();
    });

    it('hides Start New Year for archived year', () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'archived' }],
            activeYear: { id: '2026', label: '2026', status: 'archived' }
        });
        expect(screen.queryByText('Start New Year')).toBeNull();
    });

    it('does not show archive or forward buttons for closed year', () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'closed' }],
            activeYear: { id: '2026', label: '2026', status: 'closed' }
        });
        expect(screen.queryByText('Archive Year')).toBeNull();
        expect(screen.queryByText('Close Year')).toBeNull();
        // But backward transition and new year are present
        expect(screen.getByText('Reopen to Settling')).toBeInTheDocument();
        expect(screen.getByText('Start New Year')).toBeInTheDocument();
    });
});
