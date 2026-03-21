import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import LoginView from './views/LoginView.jsx';
import AppShell from './components/AppShell.jsx';
import DashboardView from './views/Dashboard/DashboardView.jsx';
import ManageView from './views/Manage/ManageView.jsx';
import MembersTab from './views/Manage/MembersTab.jsx';
import BillsTab from './views/Manage/BillsTab.jsx';
import InvoicingTab from './views/Manage/InvoicingTab.jsx';
import ReviewsTab from './views/Manage/ReviewsTab.jsx';
import SettingsView from './views/Settings/SettingsView.jsx';
import './shell.css';

/**
 * App root — wraps everything in AuthProvider and BrowserRouter.
 */
export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter basename="/app">
                <AppRoutes />
            </BrowserRouter>
        </AuthProvider>
    );
}

/** Exported for testing without BrowserRouter (use MemoryRouter in tests). */
export function AppRoutes() {
    return (
        <Routes>
            <Route path="/login" element={<GuestRoute><LoginView /></GuestRoute>} />
            <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<DashboardView />} />
                <Route path="manage" element={<ManageView />}>
                    <Route index element={<Navigate to="members" replace />} />
                    <Route path="members" element={<MembersTab />} />
                    <Route path="bills" element={<BillsTab />} />
                    <Route path="invoicing" element={<InvoicingTab />} />
                    <Route path="reviews" element={<ReviewsTab />} />
                </Route>
                <Route path="settings" element={<SettingsView />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
    );
}

/**
 * GuestRoute — redirects authenticated users to /dashboard (mirrors legacy auth.js:174).
 */
function GuestRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (user) return <Navigate to="/dashboard" replace />;
    return children;
}

/**
 * ProtectedRoute — redirects to /login if no auth user.
 * Shows a loading spinner while auth state is resolving.
 */
function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
                <p style={{ color: '#666', fontFamily: 'system-ui, sans-serif' }}>Loading…</p>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return children;
}
