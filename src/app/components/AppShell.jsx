import { Outlet } from 'react-router-dom';
import NavBar from './NavBar.jsx';
import EmailVerificationNotice from './EmailVerificationNotice.jsx';
import SaveStatusNotice from './SaveStatusNotice.jsx';
import ReloadRequiredDialog from './ReloadRequiredDialog.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBillingData } from '../hooks/useBillingData.js';

/**
 * AppShell — persistent nav bar + <Outlet /> for child routes. Unverified
 * email/password accounts see the email-verification notice on every page
 * (sending email from the app requires a verified address). A year-document write
 * that did not commit shows *Not saved*; a refused stale write puts the tab behind
 * the blocking Reload required dialog (#614).
 */
export default function AppShell() {
    const { user } = useAuth();
    const { saveStatus, writeBlock } = useBillingData();
    return (
        <div className="app-shell">
            <NavBar />
            <main className="app-main">
                <EmailVerificationNotice user={user} />
                <SaveStatusNotice saveStatus={saveStatus} />
                <Outlet />
            </main>
            <ReloadRequiredDialog writeBlock={writeBlock} />
        </div>
    );
}
