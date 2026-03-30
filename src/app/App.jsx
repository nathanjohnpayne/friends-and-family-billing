import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import LoginView from './views/LoginView.jsx';
import AppShell from './components/AppShell.jsx';
import ManageView from './views/Manage/ManageView.jsx';
import './shell.css';

// Code-split heavy views — loaded on demand
const DashboardView = lazy(() => import('./views/Dashboard/DashboardView.jsx'));
const MembersTab = lazy(() => import('./views/Manage/MembersTab.jsx'));
const BillsTab = lazy(() => import('./views/Manage/BillsTab.jsx'));
const InvoicingTab = lazy(() => import('./views/Manage/InvoicingTab.jsx'));
const ReviewsTab = lazy(() => import('./views/Manage/ReviewsTab.jsx'));
const SettingsView = lazy(() => import('./views/Settings/SettingsView.jsx'));
const ShareView = lazy(() => import('./views/ShareView.jsx'));

/**
 * App root — wraps everything in AuthProvider and BrowserRouter.
 */
export default function App() {
    return (
        <AuthProvider>
            <ToastProvider>
                <BrowserRouter basename="/app">
                    <AppRoutes />
                </BrowserRouter>
            </ToastProvider>
        </AuthProvider>
    );
}

/** Exported for testing without BrowserRouter (use MemoryRouter in tests). */
export function AppRoutes() {
    return (
        <Suspense fallback={<RouteLoading message="Loading…" />}>
        <Routes>
            <Route path="/login" element={<GuestRoute><LoginView /></GuestRoute>} />
            <Route path="/share" element={<ShareView />} />
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
        </Suspense>
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

    if (loading) return <RouteLoading message="Loading…" />;

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return children;
}

function RouteLoading({ message }) {
    return (
        <div className="route-loading" role="status" aria-live="polite">
            <div className="route-loading-card">
                <p className="route-loading-eyebrow">Friends &amp; Family Billing</p>
                <p className="route-loading-message">{message}</p>
            </div>
        </div>
    );
}
