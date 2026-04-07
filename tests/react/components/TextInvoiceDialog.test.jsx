import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('@/lib/ShareLinkService.js', () => ({
    createAndPruneShareLink: vi.fn(() => Promise.resolve({ url: 'https://example.com/share?token=test', tokenHash: 'hash', rawToken: 'test' }))
}));

import TextInvoiceDialog from '@/app/components/TextInvoiceDialog.jsx';
import { createAndPruneShareLink } from '@/lib/ShareLinkService.js';

const baseProps = {
    open: true,
    memberId: 1,
    familyMembers: [
        { id: 1, name: 'Alice Smith', email: '', phone: '+14155551212', avatar: '', linkedMembers: [], paymentReceived: 0 }
    ],
    bills: [{ id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }],
    payments: [],
    activeYear: { id: '2026', label: '2026', status: 'settling' },
    settings: {},
    onClose: vi.fn(),
    showToast: vi.fn()
};

describe('TextInvoiceDialog', () => {
    it('renders dialog with member name', () => {
        render(<TextInvoiceDialog {...baseProps} />);
        expect(screen.getByText('Text Invoice for Alice Smith')).toBeInTheDocument();
    });

    it('shows variant selector with two options', () => {
        render(<TextInvoiceDialog {...baseProps} />);
        expect(screen.getByLabelText('Text only')).toBeInTheDocument();
        expect(screen.getByLabelText('Text + link')).toBeInTheDocument();
    });

    it('shows action buttons', () => {
        render(<TextInvoiceDialog {...baseProps} />);
        expect(screen.getByText('Copy Message')).toBeInTheDocument();
        expect(screen.getByText('Open Messages')).toBeInTheDocument();
    });

    it('shows phone in meta', () => {
        render(<TextInvoiceDialog {...baseProps} />);
        expect(screen.getByText('+14155551212')).toBeInTheDocument();
    });

    it('renders nothing when not open', () => {
        const { container } = render(<TextInvoiceDialog {...baseProps} open={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('does not generate a link on dialog open (send-time only)', () => {
        createAndPruneShareLink.mockClear();
        render(<TextInvoiceDialog {...baseProps} userId="user-1" billingYearId="2026" />);
        expect(createAndPruneShareLink).not.toHaveBeenCalled();
    });
});
