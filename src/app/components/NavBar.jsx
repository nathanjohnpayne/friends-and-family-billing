import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import BrandMark from './BrandMark.jsx';

/**
 * NavBar — persistent top navigation.
 * Brand link, Dashboard/Manage/Settings nav links, user menu dropdown.
 */
export default function NavBar() {
    const { user, signOut } = useAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!menuOpen) return;
        const handleClick = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [menuOpen]);

    const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';

    return (
        <nav className="nav-bar">
            <div className="nav-bar-inner">
                <NavLink to="/" className="nav-brand">
                    <BrandMark />
                    {/* The full name is in the accessible name at every width
                        (visually hidden at phone width). "FFB", the phone-width
                        wordmark (shell.css, max-width 600px), joins the name
                        only where it is shown, so voice control can activate the
                        link by the label it sees (WCAG 2.5.3); elsewhere it is
                        display: none and drops out of the name. */}
                    <span className="nav-brand-long">Friends &amp; Family Billing</span>
                    {' '}
                    <span className="nav-brand-short">FFB</span>
                </NavLink>

                <div className="nav-links">
                    <NavLink to="/dashboard" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                        Dashboard
                    </NavLink>
                    <NavLink to="/manage" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                        Manage
                    </NavLink>
                    <NavLink to="/settings" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                        Settings
                    </NavLink>
                </div>

                <div className="nav-user-menu" ref={menuRef}>
                    <button
                        className="nav-user-trigger"
                        onClick={() => setMenuOpen((v) => !v)}
                        aria-expanded={menuOpen}
                        aria-haspopup="true"
                    >
                        <svg className="nav-user-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                        </svg>
                        <span className="nav-user-name">{displayName}</span>
                        <svg className="nav-user-chevron" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {menuOpen && (
                        <div className="nav-user-dropdown">
                            <button
                                className="nav-user-dropdown-item"
                                onClick={() => { setMenuOpen(false); signOut(); }}
                            >
                                Sign Out
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </nav>
    );
}
