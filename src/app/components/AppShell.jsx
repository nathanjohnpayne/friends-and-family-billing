import { Outlet } from 'react-router-dom';
import NavBar from './NavBar.jsx';
import EmailVerificationNotice from './EmailVerificationNotice.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

/**
 * AppShell — persistent nav bar + <Outlet /> for child routes. Unverified
 * email/password accounts see the email-verification notice on every page
 * (sending email from the app requires a verified address).
 */
export default function AppShell() {
    const { user } = useAuth();
    return (
        <div className="app-shell">
            <NavBar />
            <main className="app-main">
                <EmailVerificationNotice user={user} />
                <Outlet />
            </main>
        </div>
    );
}
