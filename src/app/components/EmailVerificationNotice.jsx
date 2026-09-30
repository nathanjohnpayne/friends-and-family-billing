/**
 * EmailVerificationNotice — shown at the top of every signed-in page (AppShell)
 * when the account's email address is not verified. Sending email from the app
 * requires a verified sender (enforced server-side by processMailQueue), so this
 * offers a way to (re)send the Firebase verification email. Renders nothing for
 * verified accounts (including Google sign-in).
 *
 * Sign-up redirects to the dashboard as soon as the account is created, so
 * the notice can mount before the verification send settles. LoginView records
 * the outcome in sessionStorage (VERIFICATION_SEND_FAILED_KEY, read on mount)
 * and dispatches VERIFICATION_SEND_EVENT (for a notice that is already
 * mounted), and this notice surfaces a failed send after the redirect.
 */
import { useEffect, useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '../../lib/firebase.js';

export const VERIFICATION_SEND_FAILED_KEY = 'ffb.verificationSendFailed';
export const VERIFICATION_SEND_EVENT = 'ffb:verification-send-result';

/** Record the sign-up verification send outcome for the notice (see header). */
export function reportVerificationSend(sent) {
    try {
        if (sent) window.sessionStorage.removeItem(VERIFICATION_SEND_FAILED_KEY);
        else window.sessionStorage.setItem(VERIFICATION_SEND_FAILED_KEY, '1');
    } catch (_) { /* storage unavailable; the event below still reaches a mounted notice */ }
    try {
        window.dispatchEvent(new CustomEvent(VERIFICATION_SEND_EVENT, { detail: { failed: !sent } }));
    } catch (_) { /* non-browser environment */ }
}

function readSendFailed() {
    try { return window.sessionStorage.getItem(VERIFICATION_SEND_FAILED_KEY) === '1'; } catch (_) { return false; }
}

function clearSendFailed() {
    try { window.sessionStorage.removeItem(VERIFICATION_SEND_FAILED_KEY); } catch (_) { /* storage unavailable */ }
}

export default function EmailVerificationNotice({ user }) {
    const [status, setStatus] = useState('idle'); // idle | sending | sent | error
    const [signupSendFailed, setSignupSendFailed] = useState(readSendFailed);

    useEffect(() => {
        const onResult = e => setSignupSendFailed(!!(e.detail && e.detail.failed));
        window.addEventListener(VERIFICATION_SEND_EVENT, onResult);
        return () => window.removeEventListener(VERIFICATION_SEND_EVENT, onResult);
    }, []);

    if (!user || !user.email || user.emailVerified !== false) return null;

    async function handleResend() {
        setStatus('sending');
        try {
            await sendEmailVerification((auth && auth.currentUser) || user);
            clearSendFailed();
            setStatus('sent');
        } catch (_) {
            setStatus('error');
        }
    }

    return (
        <div className="status-banner status-banner--warning" role="region" aria-label="Email verification">
            <p>
                Your email address ({user.email}) isn&rsquo;t verified yet. You need a verified
                address to send invoices and notices by email from the app.
            </p>
            {signupSendFailed && status !== 'sent' && (
                <p role="alert">We couldn&rsquo;t send your verification email when you signed up. Use the button below to send it again.</p>
            )}
            {status === 'sent' && (
                <p role="status">Verification email sent. After you open the link, reload this page.</p>
            )}
            {status === 'error' && (
                <p role="alert">We couldn&rsquo;t send the verification email. Please try again in a few minutes.</p>
            )}
            <div>
                <button type="button" className="btn btn-sm btn-secondary" onClick={handleResend} disabled={status === 'sending'}>
                    {status === 'sending' ? 'Sending…' : 'Resend verification email'}
                </button>
            </div>
        </div>
    );
}
