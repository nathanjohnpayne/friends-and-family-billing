/**
 * ToastContext — provides showToast(message, options) to any component.
 * Port of showChangeToast() from main.js:151.
 * Auto-dismisses after 3 seconds.
 *
 * `options.kind` is 'success' (default) or 'failure'. A failure toast is the
 * same pill in the Outstanding red (RD-23, plans/ffb-wireframes.html) and is
 * announced assertively; the message text still names the failure, so the
 * colour is never the only cue.
 */
import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used inside ToastProvider');
    return ctx;
}

export function ToastProvider({ children }) {
    const [toast, setToast] = useState(null);
    const timerRef = useRef(null);

    const showToast = useCallback((msg, options = {}) => {
        const kind = options.kind === 'failure' ? 'failure' : 'success';
        setToast({ message: msg, kind });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setToast(null), 3000);
    }, []);

    const dismiss = useCallback(() => {
        setToast(null);
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const message = toast && toast.message;
    const failure = toast && toast.kind === 'failure';

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {message && (
                <div
                    className={'change-toast visible' + (failure ? ' change-toast--failure' : '')}
                    role={failure ? 'alert' : 'status'}
                    aria-live={failure ? 'assertive' : 'polite'}
                >
                    <span>{message}</span>
                    <button type="button" className="toast-dismiss" onClick={dismiss} aria-label="Dismiss">
                        ×
                    </button>
                </div>
            )}
        </ToastContext.Provider>
    );
}
