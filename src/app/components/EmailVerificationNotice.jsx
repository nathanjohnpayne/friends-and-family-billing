/**
 * EmailVerificationNotice — shown in Settings when the signed-in account's
 * email address is not verified. Sending email from the app requires a
 * verified sender (enforced server-side by processMailQueue), so this offers a
 * way to (re)send the Firebase verification email. Renders nothing for
 * verified accounts (including Google sign-in).
 */
import { useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '../../lib/firebase.js';

export default function EmailVerificationNotice({ user }) {
    const [status, setStatus] = useState('idle'); // idle | sending | sent | error

    if (!user || !user.email || user.emailVerified !== false) return null;

    async function handleResend() {
        setStatus('sending');
        try {
            await sendEmailVerification((auth && auth.currentUser) || user);
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
