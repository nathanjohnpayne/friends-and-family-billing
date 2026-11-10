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
import userEvent from '@testing-library/user-event';
import { invoiceMembers, invoiceBills, invoiceSeeds, invoiceYear } from '../helpers/carriedInvoiceFixture.js';

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

describe('EmailInvoiceDialog — carried from 2026 (#604)', () => {
    const carriedProps = { ...baseProps, familyMembers: invoiceMembers, bills: invoiceBills, owedAdjustments: invoiceSeeds,
        activeYear: { ...invoiceYear, status: 'open' }, settings: { emailMessage: 'Hi %first_name%,\n\nYour household total is %household_total%.\n\n%payment_methods%' } };
    // The dialog's labels are not associated with their fields: [subject, message].
    const message = () => screen.getAllByRole('textbox')[1];
    const subjectField = () => screen.getAllByRole('textbox')[0];

    it('every variant carries the block and the subject never changes', async () => {
        const user = userEvent.setup();
        render(<EmailInvoiceDialog {...carriedProps} />);
        const subject = subjectField().value;
        expect(subject).toBe('Annual Billing Summary 2027—Erik Lindqvist');
        for (const label of ['Text only', 'Text + link', 'Full invoice']) {
            await user.click(screen.getByLabelText(label));
            expect(message().value).toContain('CARRIED FROM 2026\n- Erik: Northline Mobile went from $180 to $198 a month in July.\n  Your share of six months: $12.00');
            expect(message().value).toContain('- Maja: Activation fee (Nov 3): $30.00');
            expect(message().value).toContain('CARRIED TOTAL: +$55.00');
            expect(subjectField().value).toBe(subject);
        }
        expect(message().value).toContain('  2027 bills:                    $668.00\n  Carried from 2026:             +$55.00\n  Combined Annual Total:         $723.00');
    });

    it('a legacy seed shows one line and a household without a carry shows none', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<EmailInvoiceDialog {...carriedProps} memberId={4} />);
        await user.click(screen.getByLabelText('Text only'));
        expect(message().value.match(/Carried from 2026/g)).toHaveLength(1);
        expect(message().value).toContain('Carried from 2026: +$30.00.');
        unmount();
        render(<EmailInvoiceDialog {...carriedProps} memberId={5} />);
        await user.click(screen.getByLabelText('Full invoice'));
        expect(message().value).not.toMatch(/carried/i);
    });
});
