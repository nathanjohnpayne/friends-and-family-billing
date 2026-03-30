import { NavLink, Outlet } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.jsx';

const TABS = [
    { to: 'members', label: 'Members' },
    { to: 'bills', label: 'Bills' },
    { to: 'invoicing', label: 'Invoicing' },
    { to: 'reviews', label: 'Review Requests' }
];

/**
 * ManageView — tabbed layout with sub-routes.
 * Each tab renders via nested <Outlet />.
 */
export default function ManageView() {
    return (
        <div className="workspace-shell">
            <PageHeader
                kicker="Billing Workspace"
                title="Manage Billing Year"
                description="Keep members, bills, invoicing tools, and review workflows aligned without losing the simpler React layout."
            />
            <nav className="manage-tabs" aria-label="Manage sections">
                {TABS.map(tab => (
                    <NavLink
                        key={tab.to}
                        to={tab.to}
                        className={({ isActive }) => 'manage-tab' + (isActive ? ' active' : '')}
                    >
                        {tab.label}
                    </NavLink>
                ))}
            </nav>
            <div className="workspace-stack">
                <Outlet />
            </div>
        </div>
    );
}
