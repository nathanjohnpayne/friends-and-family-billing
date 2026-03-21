/**
 * ToastContext — provides showToast(message) to any component.
 * Port of showChangeToast() from main.js:151.
 * Auto-dismisses after 3 seconds.
 */
import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used inside ToastProvider');
    return ctx;
}

export function ToastProvider({ children }) {
    const [message, setMessage] = useState(null);
    const timerRef = useRef(null);

    const showToast = useCallback((msg) => {
        setMessage(msg);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setMessage(null), 3000);
    }, []);

    const dismiss = useCallback(() => {
        setMessage(null);
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {message && (
                <div className="change-toast visible" role="status" aria-live="polite">
                    <span>{message}</span>
                    <button type="button" className="toast-dismiss" onClick={dismiss} aria-label="Dismiss">
                        ×
                    </button>
                </div>
            )}
        </ToastContext.Provider>
    );
}
