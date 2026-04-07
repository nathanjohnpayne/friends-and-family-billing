import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('@/lib/mail.js', () => ({ queueEmail: vi.fn(() => Promise.resolve({ id: 'test' })) }));
vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'test-user', email: 'test@test.com' } }))
}));
vi.mock('@/lib/ShareLinkService.js', () => ({
    createAndPruneShareLink: vi.fn(() => Promise.resolve({ url: 'https://example.com/share?token=test', tokenHash: 'hash', rawToken: 'test' }))
}));

import EmailInvoiceDialog from '@/app/components/EmailInvoiceDialog.jsx';
import { createAndPruneShareLink } from '@/lib/ShareLinkService.js';

const baseProps = {
    open: true,
    memberId: 1,
    familyMembers: [
        { id: 1, name: 'Alice Smith', email: 'alice@test.com', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
    ],
    bills: [{ id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }],
    payments: [],
    activeYear: { id: '2026', label: '2026', status: 'settling' },
    settings: {},
    onClose: vi.fn()
};

describe('EmailInvoiceDialog', () => {
    it('renders dialog with member name', () => {
        render(<EmailInvoiceDialog {...baseProps} />);
        expect(screen.getByText('Email Invoice for Alice Smith')).toBeInTheDocument();
    });

    it('shows variant selector with three options', () => {
        render(<EmailInvoiceDialog {...baseProps} />);
        expect(screen.getByLabelText('Text only')).toBeInTheDocument();
        expect(screen.getByLabelText('Text + link')).toBeInTheDocument();
        expect(screen.getByLabelText('Full invoice')).toBeInTheDocument();
    });

    it('shows subject and body fields', () => {
        render(<EmailInvoiceDialog {...baseProps} />);
        expect(screen.getByText('Subject')).toBeInTheDocument();
        expect(screen.getByText('Message')).toBeInTheDocument();
    });

    it('shows action buttons including Send Email', () => {
        render(<EmailInvoiceDialog {...baseProps} />);
        expect(screen.getByText('Copy')).toBeInTheDocument();
        expect(screen.getByText('Open Mail App')).toBeInTheDocument();
        expect(screen.getByText('Send Email')).toBeInTheDocument();
    });

    it('shows member email in meta', () => {
        render(<EmailInvoiceDialog {...baseProps} />);
        expect(screen.getByText('alice@test.com')).toBeInTheDocument();
    });

    it('renders nothing when not open', () => {
        const { container } = render(<EmailInvoiceDialog {...baseProps} open={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('does not generate a link on dialog open (send-time only)', () => {
        createAndPruneShareLink.mockClear();
        render(<EmailInvoiceDialog {...baseProps} userId="test-user" billingYearId="2026" />);
        expect(createAndPruneShareLink).not.toHaveBeenCalled();
    });
});
