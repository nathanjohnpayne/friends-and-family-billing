import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const authMocks = vi.hoisted(() => ({
    signInWithEmailAndPassword: vi.fn(() => Promise.resolve()),
    createUserWithEmailAndPassword: vi.fn(() => Promise.resolve()),
    sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
    signInWithPopup: vi.fn(() => Promise.resolve({ additionalUserInfo: { isNewUser: false } }))
}));

vi.mock('@/lib/firebase.js', () => ({ auth: {}, analytics: null }));
vi.mock('firebase/analytics', () => ({ logEvent: vi.fn() }));
vi.mock('firebase/auth', () => ({
    signInWithEmailAndPassword: authMocks.signInWithEmailAndPassword,
    createUserWithEmailAndPassword: authMocks.createUserWithEmailAndPassword,
    sendPasswordResetEmail: authMocks.sendPasswordResetEmail,
    signInWithPopup: authMocks.signInWithPopup,
    GoogleAuthProvider: vi.fn()
}));

import LoginView from '@/app/views/LoginView.jsx';

function renderLoginView() {
    return render(
        <MemoryRouter>
            <LoginView />
        </MemoryRouter>
    );
}

describe('LoginView', () => {
    beforeEach(() => {
        Object.values(authMocks).forEach(mock => mock.mockClear());
    });

    it('renders branded hero and login form', () => {
        renderLoginView();
        expect(screen.getByRole('heading', { name: 'Friends & Family Billing' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
        expect(screen.getByText('Split bills without splitting relationships')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
        expect(screen.getByLabelText('Email address')).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('switches between login and signup forms', async () => {
        const user = userEvent.setup();
        renderLoginView();

        await user.click(screen.getByRole('button', { name: 'Create an account' }));
        expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
        expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    });

    it('shows an inline error when forgot password is clicked without an email', async () => {
        const user = userEvent.setup();
        renderLoginView();

        await user.click(screen.getByRole('button', { name: 'Forgot password?' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email address above');
        expect(authMocks.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('submits the login form with the current credentials', async () => {
        const user = userEvent.setup();
        renderLoginView();

        await user.type(screen.getByLabelText('Email address'), 'alice@example.com');
        await user.type(screen.getByLabelText('Password'), 'secret123');
        await user.click(screen.getByRole('button', { name: 'Sign In' }));

        expect(authMocks.signInWithEmailAndPassword).toHaveBeenCalledWith({}, 'alice@example.com', 'secret123');
    });
});
