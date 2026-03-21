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
        <div style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }}>
            <h1 style={{ textAlign: 'center' }}>Friends &amp; Family Billing</h1>
            <p style={{ textAlign: 'center', color: '#666', marginBottom: '2rem' }}>
                {form === 'login' ? 'Sign in to continue' : 'Create your account'}
            </p>

            {error && (
                <div role="alert" style={{ padding: '0.75rem', marginBottom: '1rem', background: '#FEE', border: '1px solid #C65A5A', borderRadius: 6, color: '#C65A5A' }}>
                    {error}
                </div>
            )}
            {success && (
                <div role="status" style={{ padding: '0.75rem', marginBottom: '1rem', background: '#EFE', border: '1px solid #5AC65A', borderRadius: 6, color: '#2A7A2A' }}>
                    {success}
                </div>
            )}

            {form === 'login' ? (
                <form onSubmit={handleLogin}>
                    <label htmlFor="login-email" style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Email</label>
                    <input id="login-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                        required autoFocus style={inputStyle} />

                    <label htmlFor="login-password" style={{ display: 'block', marginBottom: 4, marginTop: 12, fontWeight: 500 }}>Password</label>
                    <input id="login-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                        required style={inputStyle} />

                    <button type="submit" disabled={loading} style={btnPrimary}>
                        {loading ? 'Signing in…' : 'Sign In'}
                    </button>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '0.875rem' }}>
                        <button type="button" onClick={handleForgotPassword} style={linkBtn}>Forgot password?</button>
                        <button type="button" onClick={() => { clearMessages(); setForm('signup'); }} style={linkBtn}>Create account</button>
                    </div>
                </form>
            ) : (
                <form onSubmit={handleSignup}>
                    <label htmlFor="signup-email" style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Email</label>
                    <input id="signup-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                        required autoFocus style={inputStyle} />

                    <label htmlFor="signup-password" style={{ display: 'block', marginBottom: 4, marginTop: 12, fontWeight: 500 }}>Password</label>
                    <input id="signup-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                        required minLength={6} style={inputStyle} />

                    <label htmlFor="signup-confirm" style={{ display: 'block', marginBottom: 4, marginTop: 12, fontWeight: 500 }}>Confirm Password</label>
                    <input id="signup-confirm" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                        required minLength={6} style={inputStyle} />

                    <button type="submit" disabled={loading} style={btnPrimary}>
                        {loading ? 'Creating account…' : 'Create Account'}
                    </button>

                    <div style={{ textAlign: 'center', marginTop: 8, fontSize: '0.875rem' }}>
                        <button type="button" onClick={() => { clearMessages(); setForm('login'); }} style={linkBtn}>Back to sign in</button>
                    </div>
                </form>
            )}

            <div style={{ display: 'flex', alignItems: 'center', margin: '1.5rem 0', gap: 8 }}>
                <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #ddd' }} />
                <span style={{ color: '#999', fontSize: '0.8rem' }}>or</span>
                <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #ddd' }} />
            </div>

            <button type="button" onClick={handleGoogleSignIn} disabled={loading} style={btnGoogle}>
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                Continue with Google
            </button>

            <p style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.75rem', color: '#999' }}>
                The legacy app is at <a href="/login.html" style={{ color: '#999' }}>login.html</a>
            </p>
        </div>
    );
}

const inputStyle = {
    width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #ccc',
    borderRadius: 6, fontSize: '1rem', boxSizing: 'border-box'
};

const btnPrimary = {
    width: '100%', padding: '0.7rem', marginTop: 16, border: 'none',
    borderRadius: 6, background: '#6E78D6', color: '#fff', fontSize: '1rem',
    fontWeight: 600, cursor: 'pointer'
};

const btnGoogle = {
    width: '100%', padding: '0.65rem', border: '1px solid #ddd',
    borderRadius: 6, background: '#fff', fontSize: '0.95rem', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
};

const linkBtn = {
    background: 'none', border: 'none', color: '#6E78D6', cursor: 'pointer',
    padding: 0, fontSize: 'inherit', textDecoration: 'underline'
};
