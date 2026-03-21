import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import LoginView from './views/LoginView.jsx';

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
            <Route path="/" element={<ProtectedRoute><DashboardPlaceholder /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}

/**
 * GuestRoute — redirects authenticated users to / (mirrors legacy auth.js:174).
 */
function GuestRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (user) return <Navigate to="/" replace />;
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

/**
 * Temporary dashboard placeholder — Phase 1 replaces this with real views.
 */
function DashboardPlaceholder() {
    const { user, signOut } = useAuth();

    return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1>Friends &amp; Family Billing</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ color: '#666', fontSize: '0.875rem' }}>{user?.email}</span>
                    <button onClick={signOut} style={{
                        padding: '0.4rem 0.8rem', border: '1px solid #ccc', borderRadius: 6,
                        background: '#fff', cursor: 'pointer', fontSize: '0.875rem'
                    }}>
                        Sign Out
                    </button>
                </div>
            </div>
            <p style={{ color: '#666' }}>
                React app — Phase 0 scaffold. Auth is working.
                Real views arrive in Phase 1.
            </p>
            <p style={{ fontSize: '0.875rem', color: '#999' }}>
                The legacy app is at <a href="/" style={{ color: '#999' }}>the root URL</a>.
            </p>
        </div>
    );
}
