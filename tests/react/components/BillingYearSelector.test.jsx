import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

import BillingYearSelector from '@/app/components/BillingYearSelector.jsx';
import { useBillingData } from '@/app/hooks/useBillingData.js';

describe('BillingYearSelector', () => {
    let confirmSpy;
    let promptSpy;

    beforeEach(() => {
        vi.clearAllMocks();
        confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('2027');
    });

    afterEach(() => {
        confirmSpy.mockRestore();
        promptSpy.mockRestore();
    });

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

    it('shows Start Settlement for open year and calls setYearStatus on click', async () => {
        render(<BillingYearSelector />);
        const btn = screen.getByText('Start Settlement');
        expect(btn).not.toBeDisabled();
        fireEvent.click(btn);
        expect(confirmSpy).toHaveBeenCalled();
        expect(mockService.setYearStatus).toHaveBeenCalledWith('settling');
    });

    it('shows Close Year for settling year and calls setYearStatus', () => {
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'settling' }],
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            service: mockService
        });
        render(<BillingYearSelector />);
        fireEvent.click(screen.getByText('Close Year'));
        expect(mockService.setYearStatus).toHaveBeenCalledWith('closed');
    });

    it('shows Back to Open for settling year', () => {
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'settling' }],
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            service: mockService
        });
        render(<BillingYearSelector />);
        fireEvent.click(screen.getByText('Back to Open'));
        expect(mockService.setYearStatus).toHaveBeenCalledWith('open');
    });

    it('shows Archive Year for closed year and calls setYearStatus', () => {
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'closed' }],
            activeYear: { id: '2026', label: '2026', status: 'closed' },
            service: mockService
        });
        render(<BillingYearSelector />);
        fireEvent.click(screen.getByText('Archive Year'));
        expect(mockService.setYearStatus).toHaveBeenCalledWith('archived');
    });

    it('archive flow chains into start-new-year prompt', async () => {
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'closed' }],
            activeYear: { id: '2026', label: '2026', status: 'closed' },
            service: mockService
        });
        // First confirm = archive, second confirm = start new year, prompt = year label
        confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(true);
        promptSpy.mockReturnValue('2027');

        render(<BillingYearSelector />);
        fireEvent.click(screen.getByText('Archive Year'));

        // Wait for async chain
        await vi.waitFor(() => {
            expect(mockService.setYearStatus).toHaveBeenCalledWith('archived');
            expect(mockService.createYear).toHaveBeenCalledWith('2027');
        });
    });

    it('archive flow does not start new year when declined', async () => {
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'closed' }],
            activeYear: { id: '2026', label: '2026', status: 'closed' },
            service: mockService
        });
        // First confirm = archive, second confirm = decline new year
        confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false);

        render(<BillingYearSelector />);
        fireEvent.click(screen.getByText('Archive Year'));

        await vi.waitFor(() => {
            expect(mockService.setYearStatus).toHaveBeenCalledWith('archived');
        });
        expect(mockService.createYear).not.toHaveBeenCalled();
    });

    it('calls createYear with prompted label for Start New Year', () => {
        render(<BillingYearSelector />);
        fireEvent.click(screen.getByText('Start New Year'));
        expect(promptSpy).toHaveBeenCalled();
        expect(mockService.createYear).toHaveBeenCalledWith('2027');
    });

    it('does not call setYearStatus when confirm is cancelled', () => {
        // Reset mock to open year (previous tests may have changed it)
        useBillingData.mockReturnValue({
            billingYears: [{ id: '2026', label: '2026', status: 'open' }],
            activeYear: { id: '2026', label: '2026', status: 'open' },
            service: mockService
        });
        confirmSpy.mockReturnValue(false);
        render(<BillingYearSelector />);
        fireEvent.click(screen.getByText('Start Settlement'));
        expect(mockService.setYearStatus).not.toHaveBeenCalled();
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
