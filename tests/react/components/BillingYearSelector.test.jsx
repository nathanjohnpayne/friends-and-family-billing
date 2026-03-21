import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockService = {
    switchYear: vi.fn(),
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

import BillingYearSelector from '@/app/components/BillingYearSelector.jsx';
import { useBillingData } from '@/app/hooks/useBillingData.js';

describe('BillingYearSelector', () => {
    it('renders the year selector with options', () => {
        render(<BillingYearSelector />);
        expect(screen.getByText('Billing Controls')).toBeInTheDocument();
        expect(screen.getByLabelText('Active Year')).toBeInTheDocument();
        const select = screen.getByRole('combobox');
        expect(select.value).toBe('2026');
    });

    it('calls switchYear when selection changes', () => {
        render(<BillingYearSelector />);
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: '2025' } });
        expect(mockService.switchYear).toHaveBeenCalledWith('2025');
    });

    it('shows Start Settlement for open year', () => {
        render(<BillingYearSelector />);
        expect(screen.getByText('Start Settlement')).toBeInTheDocument();
        expect(screen.getByText('Start New Year')).toBeInTheDocument();
    });

    it('shows Close Year for settling year', () => {
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'settling' }],
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            service: mockService
        });
        render(<BillingYearSelector />);
        expect(screen.getByText('Close Year')).toBeInTheDocument();
        expect(screen.getByText('Back to Open')).toBeInTheDocument();
    });

    it('shows Archive Year for closed year', () => {
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'closed' }],
            activeYear: { id: '2026', label: '2026', status: 'closed' },
            service: mockService
        });
        render(<BillingYearSelector />);
        expect(screen.getByText('Archive Year')).toBeInTheDocument();
        expect(screen.getByText('Reopen to Settling')).toBeInTheDocument();
    });

    it('hides Start New Year for archived year', () => {
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'archived' }],
            activeYear: { id: '2026', label: '2026', status: 'archived' },
            service: mockService
        });
        render(<BillingYearSelector />);
        expect(screen.queryByText('Start New Year')).toBeNull();
    });
});
