import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

/**
 * NavBar — persistent top navigation.
 * Brand link, Dashboard/Manage/Settings nav links, user email, sign-out.
 */
export default function NavBar() {
    const { user, signOut } = useAuth();

    return (
        <nav className="nav-bar">
            <div className="nav-bar-inner">
                <NavLink to="/dashboard" className="nav-brand" aria-label="Friends & Family Billing dashboard">
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
                    <span className="nav-brand-copy">
                        <span className="nav-brand-kicker">Settlement Workspace</span>
                        <span className="nav-brand-title">Friends &amp; Family Billing</span>
                    </span>
                </NavLink>

                <div className="nav-links" aria-label="Primary">
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

                <div className="nav-user">
                    <span className="nav-user-label">Signed in as</span>
                    <span className="nav-email">{user?.email}</span>
                    <button onClick={signOut} className="nav-signout">Sign Out</button>
                </div>
            </div>
        </nav>
    );
}
