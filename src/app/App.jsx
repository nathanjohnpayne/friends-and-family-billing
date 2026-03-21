import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

/**
 * Phase 0 shell — proves the React build pipeline works.
 * Actual views (Dashboard, Manage, Settings) arrive in Phase 1.
 */
export default function App() {
    return (
        <BrowserRouter basename="/app">
            <AppRoutes />
        </BrowserRouter>
    );
}

/** Exported for testing without BrowserRouter (use MemoryRouter in tests). */
export function AppRoutes() {
    return (
        <Routes>
            <Route path="/" element={<Placeholder title="Dashboard" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}

export function Placeholder({ title }) {
    return (
        <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
            <h1>Friends &amp; Family Billing</h1>
            <p>React app — Phase 0 scaffold. View: <strong>{title}</strong></p>
            <p style={{ color: '#666', fontSize: '0.875rem' }}>
                The legacy app is still live at <a href="/">the root URL</a>.
            </p>
        </div>
    );
}
