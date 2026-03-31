import { Outlet } from 'react-router-dom';
import NavBar from './NavBar.jsx';

/**
 * AppShell — persistent nav bar + <Outlet /> for child routes.
 */
export default function AppShell() {
    return (
        <div className="app-shell">
            <NavBar />
            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
