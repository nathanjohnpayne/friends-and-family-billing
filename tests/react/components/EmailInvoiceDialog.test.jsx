import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import EmailInvoiceDialog from '@/app/components/EmailInvoiceDialog.jsx';

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

    it('shows action buttons', () => {
        render(<EmailInvoiceDialog {...baseProps} />);
        expect(screen.getByText('Copy Email')).toBeInTheDocument();
        expect(screen.getByText('Open Mail App')).toBeInTheDocument();
    });

    it('shows member email in meta', () => {
        render(<EmailInvoiceDialog {...baseProps} />);
        expect(screen.getByText('alice@test.com')).toBeInTheDocument();
    });

    it('renders nothing when not open', () => {
        const { container } = render(<EmailInvoiceDialog {...baseProps} open={false} />);
        expect(container.innerHTML).toBe('');
    });
});
