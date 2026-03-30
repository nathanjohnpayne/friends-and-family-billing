import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signInWithPopup,
    GoogleAuthProvider
} from 'firebase/auth';
import { auth, analytics } from '@/lib/firebase.js';
import { logEvent } from 'firebase/analytics';

const googleProvider = new GoogleAuthProvider();
const HERO_POINTS = [
    {
        title: 'No more spreadsheets',
        copy: 'See who owes what instantly for the whole year.'
    },
    {
        title: 'One-tap invoicing',
        copy: 'Send clear, itemized summaries by email or text.'
    },
    {
        title: 'Built on trust',
        copy: 'Transparent calculations everyone can verify.'
    }
];

function getErrorMessage(code) {
    switch (code) {
        case 'auth/email-already-in-use':
            return 'This email is already registered. Try signing in instead.';
        case 'auth/invalid-email':
            return 'Invalid email address.';
        case 'auth/user-not-found':
            return 'No account found with this email. It may have been created via Google Sign\u2011In.';
        case 'auth/wrong-password':
            return 'Incorrect password.';
        case 'auth/weak-password':
            return 'Password should be at least 6 characters.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your connection.';
        case 'auth/invalid-credential':
            return 'Invalid credentials. This account may have been created via Google Sign\u2011In.';
        case 'auth/popup-closed-by-user':
            return 'Sign-in cancelled. Please try again.';
        case 'auth/popup-blocked':
            return 'Pop-up blocked. Please allow pop-ups for this site.';
        case 'auth/unauthorized-domain':
            return 'This domain is not authorized. Please contact the administrator.';
        default:
            return 'An error occurred. Please try again.';
    }
}

export default function LoginView() {
    const navigate = useNavigate();
    const [form, setForm] = useState('login'); // 'login' | 'signup'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    const clearMessages = () => { setError(''); setSuccess(''); };

    async function handleLogin(e) {
        e.preventDefault();
        clearMessages();
        setLoading(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
            if (analytics) logEvent(analytics, 'login', { method: 'email' });
            navigate('/');
        } catch (err) {
            setError(getErrorMessage(err.code));
        } finally {
            setLoading(false);
        }
    }

    async function handleSignup(e) {
        e.preventDefault();
        clearMessages();
        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        setLoading(true);
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            if (analytics) logEvent(analytics, 'sign_up', { method: 'email' });
            setSuccess('Account created! Redirecting…');
            setTimeout(() => navigate('/'), 1000);
        } catch (err) {
            setError(getErrorMessage(err.code));
        } finally {
            setLoading(false);
        }
    }

    async function handleForgotPassword() {
        clearMessages();
        if (!email.trim()) {
            setError('Enter your email address above, then click "Forgot password?" again.');
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            setSuccess('Password reset email sent to ' + email + '. Check your inbox.');
        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                setError('No account found with this email.');
            } else if (err.code === 'auth/invalid-email') {
                setError('Please enter a valid email address.');
            } else {
                setError('Unable to send reset email. Please try again.');
            }
        }
    }

    async function handleGoogleSignIn() {
        clearMessages();
        setLoading(true);
        try {
            const result = await signInWithPopup(auth, googleProvider);
            const isNewUser = result?.additionalUserInfo?.isNewUser || false;
            if (analytics) logEvent(analytics, isNewUser ? 'sign_up' : 'login', { method: 'google' });
            navigate('/');
        } catch (err) {
            setError(getErrorMessage(err.code));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-page">
            <main className="auth-shell">
                <section className="auth-hero" aria-labelledby="login-title">
                    <div className="auth-hero-badge">Split bills without splitting relationships</div>
                    <div className="auth-hero-mark">
                        <AppMark className="auth-hero-mark-icon" gradientId="authHeroGrad" />
                    </div>
                    <h1 id="login-title">Friends &amp; Family Billing</h1>
                    <p className="auth-hero-copy">
                        The easiest way for families and close friends to track, split, and settle shared expenses all year long in one polished workspace.
                    </p>

                    <div className="auth-hero-points" aria-label="Product highlights">
                        {HERO_POINTS.map(point => (
                            <div key={point.title} className="auth-hero-point">
                                <span className="auth-hero-point-title">{point.title}</span>
                                <span className="auth-hero-point-copy">{point.copy}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="auth-card" aria-label="Authentication">
                    <div className="auth-card-header">
                        <div className="auth-card-icon">
                            <AppMark className="auth-card-mark" gradientId="authCardGrad" />
                        </div>
                        <div>
                            <h2>{form === 'login' ? 'Welcome back' : 'Create your account'}</h2>
                            <p>{form === 'login' ? 'Pick up right where you left off.' : 'Set up your billing workspace in a minute.'}</p>
                        </div>
                    </div>

                    <div className="auth-context-banner">
                        Your bills, your people, one shared view.
                    </div>

                    {error && (
                        <div role="alert" className="auth-message auth-message--error">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div role="status" className="auth-message auth-message--success">
                            {success}
                        </div>
                    )}

                    <button type="button" onClick={handleGoogleSignIn} disabled={loading} className="auth-google-btn">
                        <GoogleMark />
                        Continue with Google
                    </button>

                    <div className="auth-divider">
                        {form === 'login' ? 'or sign in with email' : 'or create account with email'}
                    </div>

                    {form === 'login' ? (
                        <form className="auth-form" onSubmit={handleLogin}>
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="login-email">Email address</label>
                                <input
                                    className="auth-input"
                                    id="login-email"
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    required
                                    autoFocus
                                    autoComplete="email"
                                />
                            </div>

                            <div className="auth-field">
                                <label className="auth-label" htmlFor="login-password">Password</label>
                                <input
                                    className="auth-input"
                                    id="login-password"
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Enter your password"
                                    required
                                    autoComplete="current-password"
                                />
                            </div>

                            <button type="button" onClick={handleForgotPassword} className="auth-inline-link auth-inline-link--solo">
                                Forgot password?
                            </button>

                            <button type="submit" disabled={loading} className="auth-submit-btn">
                                {loading ? 'Signing in…' : 'Sign In'}
                            </button>

                            <div className="auth-form-switch">
                                New here?{' '}
                                <button type="button" onClick={() => { clearMessages(); setForm('signup'); }} className="auth-inline-link">
                                    Create an account
                                </button>
                            </div>
                        </form>
                    ) : (
                        <form className="auth-form" onSubmit={handleSignup}>
                            <div className="auth-field">
                                <label className="auth-label" htmlFor="signup-email">Email address</label>
                                <input
                                    className="auth-input"
                                    id="signup-email"
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    required
                                    autoFocus
                                    autoComplete="email"
                                />
                            </div>

                            <div className="auth-field">
                                <label className="auth-label" htmlFor="signup-password">Password</label>
                                <input
                                    className="auth-input"
                                    id="signup-password"
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="At least 6 characters"
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
                                />
                            </div>

                            <div className="auth-field">
                                <label className="auth-label" htmlFor="signup-confirm">Confirm password</label>
                                <input
                                    className="auth-input"
                                    id="signup-confirm"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    placeholder="Re-enter your password"
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
                                />
                            </div>

                            <button type="submit" disabled={loading} className="auth-submit-btn auth-submit-btn--strong">
                                {loading ? 'Creating account…' : 'Create Account'}
                            </button>

                            <div className="auth-form-switch">
                                Already have an account?{' '}
                                <button type="button" onClick={() => { clearMessages(); setForm('login'); }} className="auth-inline-link">
                                    Sign in
                                </button>
                            </div>
                        </form>
                    )}

                    <div className="auth-trust-footer">
                        <div className="auth-trust-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                            </svg>
                        </div>
                        <p>Secured by Google &amp; Firebase. Your data stays private and encrypted, always.</p>
                    </div>

                    <p className="auth-legacy-link">
                        The legacy app is at <a href="/login.html">login.html</a>
                    </p>
                </section>
            </main>
        </div>
    );
}

function AppMark({ className, gradientId }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true">
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#6E78D6" />
                    <stop offset="100%" stopColor="#7B5FAF" />
                </linearGradient>
            </defs>
            <rect width="48" height="48" rx="12" fill={'url(#' + gradientId + ')'} />
            <g transform="translate(6,5) scale(1.5)">
                <path d="M11,10A6,6,0,0,0,6,4.09V4A2,2,0,0,1,8,2H20a2,2,0,0,1,2,2V21a1,1,0,0,1-1.39.92l-1.95-.83-1.94.83a1,1,0,0,1-.78,0L14,21.09l-1.94.83a1,1,0,0,1-.78,0l-1.94-.83-1.94.83A1,1,0,0,1,7,22a1,1,0,0,1-.55-.17A1,1,0,0,1,6,21V15.91A6,6,0,0,0,11,10Z" fill="#fff" />
                <path d="M8,11.5A2.5,2.5,0,0,1,6,14V14a1,1,0,0,1-2,0H3a1,1,0,0,1,0-2H5.5a.5.5,0,0,0,0-1h-1A2.5,2.5,0,0,1,4,6.05V6A1,1,0,0,1,6,6H7A1,1,0,0,1,7,8H4.5a.5.5,0,0,0,0,1h1A2.5,2.5,0,0,1,8,11.5ZM13,16h5a1,1,0,0,0,0-2H13a1,1,0,0,0,0,2Zm2-4h3a1,1,0,0,0,0-2H15a1,1,0,0,0,0,2Z" fill="rgba(255,255,255,0.75)" />
            </g>
        </svg>
    );
}

function GoogleMark() {
    return (
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
    );
}
