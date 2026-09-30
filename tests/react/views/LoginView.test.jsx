import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockCreateUser = vi.fn();
const mockSendEmailVerification = vi.fn();

vi.mock('@/lib/firebase.js', () => ({ auth: {}, db: {}, storage: {}, analytics: null }));
vi.mock('firebase/analytics', () => ({ logEvent: vi.fn() }));
vi.mock('firebase/auth', () => ({
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: (...args) => mockCreateUser(...args),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: (...args) => mockSendEmailVerification(...args),
    signInWithPopup: vi.fn(),
    GoogleAuthProvider: vi.fn(),
}));

import LoginView from '@/app/views/LoginView.jsx';

async function submitSignup(user) {
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.type(screen.getByLabelText('Confirm Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
}

describe('LoginView sign-up email verification', () => {
    beforeEach(() => {
        mockCreateUser.mockReset();
        mockSendEmailVerification.mockReset();
    });

    it('sends a verification email to the newly created account', async () => {
        const newUser = { uid: 'u1', email: 'new@example.com' };
        mockCreateUser.mockResolvedValue({ user: newUser });
        mockSendEmailVerification.mockResolvedValue();
        const user = userEvent.setup();
        render(<MemoryRouter><LoginView /></MemoryRouter>);

        await submitSignup(user);

        await waitFor(() => expect(mockSendEmailVerification).toHaveBeenCalledWith(newUser));
        expect(await screen.findByRole('status')).toHaveTextContent(/verify your email/i);
    });

    it('still completes sign-up when sending the verification email fails', async () => {
        mockCreateUser.mockResolvedValue({ user: { uid: 'u1' } });
        mockSendEmailVerification.mockRejectedValue(new Error('quota'));
        const user = userEvent.setup();
        render(<MemoryRouter><LoginView /></MemoryRouter>);

        await submitSignup(user);

        expect(await screen.findByRole('status')).toHaveTextContent(/account created/i);
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
