import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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

// useRefundNotices (#319) — the selector reads it to hold back a re-opened credit
// from carry-forward (#322). Mock it so the component does not pull in Firebase.
vi.mock('@/app/hooks/useRefundNotices.js', () => ({
    useRefundNotices: vi.fn(() => ({ refundNotices: [] }))
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
    return render(
        <MemoryRouter initialEntries={['/settings']}>
            <ToastProvider>
                <Routes>
                    <Route path="/settings" element={<BillingYearSelector />} />
                    <Route path="/year-end-review" element={<p>Year-End Review page</p>} />
                </Routes>
            </ToastProvider>
        </MemoryRouter>
    );
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

    // #609: Start New Year and its label dialog are replaced by the Year-End Review entry
    // point (the label is suggested and checked on the review's last step, and the
    // re-opened credit set is passed there). These were the label dialog's tests and now
    // assert its replacement.
    it('Review & start opens the Year-End Review instead of a label dialog', async () => {
        const user = userEvent.setup();
        renderSelector();
        await user.click(screen.getByRole('button', { name: 'Review & start 2027' }));
        expect(screen.getByText('Year-End Review page')).toBeInTheDocument();
        expect(screen.queryByText('Start New Billing Year')).toBeNull();
        expect(screen.queryByLabelText('Billing year label')).toBeNull();
    });

    it('never creates a year from Settings; the review is the only path', async () => {
        renderSelector();
        expect(screen.queryByText('Start New Year')).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Review & start 2027' }));
        });
        expect(mockService.createYear).not.toHaveBeenCalled();
    });

    it('names the suggested next year and explains the review', () => {
        renderSelector({
            billingYears: [{ id: '2030', label: '2030', status: 'open' }],
            activeYear: { id: '2030', label: '2030', status: 'open' }
        });
        expect(screen.getByRole('button', { name: 'Review & start 2031' })).toBeEnabled();
        expect(screen.getByText(/sets 2031’s prices before 2031 is created/)).toBeInTheDocument();
    });

    it('disables the review with the ADR 0007 pointer once the next year exists', () => {
        renderSelector({
            billingYears: [{ id: '2027', label: '2027', status: 'open' }, { id: '2026', label: '2026', status: 'closed' }],
            activeYear: { id: '2026', label: '2026', status: 'closed' }
        });
        const button = screen.getByRole('button', { name: 'Review & start 2027' });
        expect(button).toBeDisabled();
        expect(screen.getByText('2027 already exists.')).toBeInTheDocument();
        expect(screen.getByText(/Record new charges, credits and refunds in 2027, the open year/)).toBeInTheDocument();
        fireEvent.click(button);
        expect(screen.queryByText('Year-End Review page')).toBeNull();
    });

    it('treats a rollover event on the year as a successor even without a higher label', () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'settling' }],
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            billingEvents: [{ id: 'e1', eventType: 'YEAR_ROLLED_OVER', payload: { toYear: '2026-27' } }]
        });
        expect(screen.getByRole('button', { name: 'Review & start 2026-27' })).toBeDisabled();
    });

    it('hides the review for an archived year', () => {
        renderSelector({
            billingYears: [{ id: '2026', label: '2026', status: 'archived' }],
            activeYear: { id: '2026', label: '2026', status: 'archived' }
        });
        expect(screen.queryByText('Start New Year')).toBeNull();
        expect(screen.queryByRole('button', { name: /Review & start/ })).toBeNull();
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
        expect(screen.getByRole('button', { name: 'Review & start 2027' })).toBeEnabled();
    });
});
