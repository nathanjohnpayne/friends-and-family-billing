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

    it('shows Start Settlement for open year and opens confirm dialog', () => {
        renderSelector();
        fireEvent.click(screen.getByText('Start Settlement'));
        // ConfirmDialog should appear
        expect(screen.getByText('Confirm Action')).toBeInTheDocument();
        expect(screen.getByText(/Start settlement for 2026/)).toBeInTheDocument();
    });

    it('calls setYearStatus when confirm dialog is accepted', async () => {
        renderSelector();
        fireEvent.click(screen.getByText('Start Settlement'));
        await act(async () => {
            fireEvent.click(screen.getByText('Confirm'));
        });
        expect(mockService.setYearStatus).toHaveBeenCalledWith('settling');
    });

    it('does not call setYearStatus when confirm is cancelled', () => {
        renderSelector();
        fireEvent.click(screen.getByText('Start Settlement'));
        fireEvent.click(screen.getByText('Cancel'));
        expect(mockService.setYearStatus).not.toHaveBeenCalled();
    });

    it('shows Close Year for settling year', () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'settling' }],
            activeYear: { id: '2026', label: '2026', status: 'settling' }
        });
        expect(screen.getByText('Close Year')).toBeInTheDocument();
        expect(screen.getByText('Back to Open')).toBeInTheDocument();
    });

    it('shows Archive Year for closed year', () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'closed' }],
            activeYear: { id: '2026', label: '2026', status: 'closed' }
        });
        expect(screen.getByText('Archive Year')).toBeInTheDocument();
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

    it('archive flow offers to start new year after archiving', async () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'closed' }],
            activeYear: { id: '2026', label: '2026', status: 'closed' }
        });
        fireEvent.click(screen.getByText('Archive Year'));
        // First confirm: archive
        await act(async () => {
            fireEvent.click(screen.getByText('Confirm'));
        });
        expect(mockService.setYearStatus).toHaveBeenCalledWith('archived');
        // Post-archive offer dialog appears
        expect(screen.getByText('Year Archived')).toBeInTheDocument();
    });
});
