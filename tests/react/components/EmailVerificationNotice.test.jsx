import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockSendEmailVerification, mockAuth } = vi.hoisted(() => ({
    mockSendEmailVerification: vi.fn(),
    mockAuth: { currentUser: null },
}));

vi.mock('@/lib/firebase.js', () => ({ auth: mockAuth }));
vi.mock('firebase/auth', () => ({
    sendEmailVerification: (...args) => mockSendEmailVerification(...args),
}));

import EmailVerificationNotice, { reportVerificationSend, VERIFICATION_SEND_FAILED_KEY } from '@/app/components/EmailVerificationNotice.jsx';
import { act } from '@testing-library/react';

describe('EmailVerificationNotice', () => {
    beforeEach(() => {
        mockSendEmailVerification.mockReset();
        mockAuth.currentUser = null;
        window.sessionStorage.clear();
    });

    it('renders nothing for verified accounts or when signed out', () => {
        const { container, rerender } = render(<EmailVerificationNotice user={{ email: 'a@example.com', emailVerified: true }} />);
        expect(container).toBeEmptyDOMElement();
        rerender(<EmailVerificationNotice user={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('resends the verification email for an unverified account', async () => {
        const user = { uid: 'u1', email: 'a@example.com', emailVerified: false };
        mockAuth.currentUser = user;
        mockSendEmailVerification.mockResolvedValue();
        render(<EmailVerificationNotice user={user} />);

        expect(screen.getByText(/isn.t verified yet/i)).toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('button', { name: 'Resend verification email' }));

        expect(mockSendEmailVerification).toHaveBeenCalledWith(user);
        expect(await screen.findByRole('status')).toHaveTextContent(/verification email sent/i);
    });

    it('shows an error and keeps the button when resending fails', async () => {
        mockSendEmailVerification.mockRejectedValue(new Error('auth/too-many-requests'));
        render(<EmailVerificationNotice user={{ uid: 'u1', email: 'a@example.com', emailVerified: false }} />);

        await userEvent.setup().click(screen.getByRole('button', { name: 'Resend verification email' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t send/i);
        expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeEnabled();
    });

    it('surfaces a failed sign-up send recorded before it mounted, and clears it after a resend', async () => {
        reportVerificationSend(false);
        mockSendEmailVerification.mockResolvedValue();
        render(<EmailVerificationNotice user={{ uid: 'u1', email: 'a@example.com', emailVerified: false }} />);
        expect(screen.getByText(/when you signed up/i)).toBeInTheDocument();

        await userEvent.setup().click(screen.getByRole('button', { name: 'Resend verification email' }));

        expect(await screen.findByRole('status')).toHaveTextContent(/verification email sent/i);
        expect(screen.queryByText(/when you signed up/i)).toBeNull();
        expect(window.sessionStorage.getItem(VERIFICATION_SEND_FAILED_KEY)).toBeNull();
    });

    it('surfaces a failed sign-up send reported after it mounted', () => {
        render(<EmailVerificationNotice user={{ uid: 'u1', email: 'a@example.com', emailVerified: false }} />);
        expect(screen.queryByText(/when you signed up/i)).toBeNull();
        act(() => reportVerificationSend(false));
        expect(screen.getByText(/when you signed up/i)).toBeInTheDocument();
    });
});
