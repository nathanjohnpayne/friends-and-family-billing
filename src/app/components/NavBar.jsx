import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

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
                    <svg className="nav-brand-icon" viewBox="0 0 48 48" aria-hidden="true">
                        <defs>
                            <linearGradient id="navGrad" x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0%" stopColor="#6E78D6" />
                                <stop offset="100%" stopColor="#7B5FAF" />
                            </linearGradient>
                        </defs>
                        <rect width="48" height="48" rx="12" fill="url(#navGrad)" />
                        <g transform="translate(6,5) scale(1.5)">
                            <path d="M11,10A6,6,0,0,0,6,4.09V4A2,2,0,0,1,8,2H20a2,2,0,0,1,2,2V21a1,1,0,0,1-1.39.92l-1.95-.83-1.94.83a1,1,0,0,1-.78,0L14,21.09l-1.94.83a1,1,0,0,1-.78,0l-1.94-.83-1.94.83A1,1,0,0,1,7,22a1,1,0,0,1-.55-.17A1,1,0,0,1,6,21V15.91A6,6,0,0,0,11,10Z" fill="#fff" />
                            <path d="M8,11.5A2.5,2.5,0,0,1,6,14V14a1,1,0,0,1-2,0H3a1,1,0,0,1,0-2H5.5a.5.5,0,0,0,0-1h-1A2.5,2.5,0,0,1,4,6.05V6A1,1,0,0,1,6,6H7A1,1,0,0,1,7,8H4.5a.5.5,0,0,0,0,1h1A2.5,2.5,0,0,1,8,11.5ZM13,16h5a1,1,0,0,0,0-2H13a1,1,0,0,0,0,2Zm2-4h3a1,1,0,0,0,0-2H15a1,1,0,0,0,0,2Z" fill="rgba(255,255,255,0.75)" />
                        </g>
                    </svg>
                    <span>FFB</span>
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
