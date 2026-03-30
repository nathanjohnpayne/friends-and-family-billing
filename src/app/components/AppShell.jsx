import { Outlet } from 'react-router-dom';
import NavBar from './NavBar.jsx';

/**
 * AppShell — persistent nav bar + <Outlet /> for child routes.
 */
export default function AppShell() {
    return (
        <div className="app-shell">
            <div className="app-shell-backdrop" aria-hidden="true">
                <span className="app-shell-glow app-shell-glow--violet" />
                <span className="app-shell-glow app-shell-glow--mint" />
            </div>
            <NavBar />
            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
