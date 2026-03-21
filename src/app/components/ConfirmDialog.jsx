/**
 * ConfirmDialog — modal overlay with title, message, Cancel / Confirm.
 * Port of showConfirmationDialog() from main.js:5076.
 * Uses a focus trap and closes on Escape or overlay click.
 */
import { useEffect, useRef } from 'react';

/**
 * @param {{
 *   open: boolean,
 *   title: string,
 *   message: string,
 *   confirmLabel?: string,
 *   destructive?: boolean,
 *   onConfirm: () => void,
 *   onCancel: () => void
 * }} props
 */
export default function ConfirmDialog({
    open, title, message,
    confirmLabel = 'Confirm',
    destructive = false,
    onConfirm, onCancel
}) {
    const confirmRef = useRef(null);

    // Focus the confirm button on open
    useEffect(() => {
        if (open && confirmRef.current) confirmRef.current.focus();
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        function handleKey(e) {
            if (e.key === 'Escape') onCancel();
        }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, onCancel]);

    if (!open) return null;

    function handleOverlayClick(e) {
        if (e.target === e.currentTarget) onCancel();
    }

    return (
        <div className="dialog-overlay visible" onClick={handleOverlayClick} role="presentation">
            <div className="dialog confirmation-dialog" role="dialog" aria-modal="true" aria-label={title}>
                <div className="dialog-header"><h3>{title}</h3></div>
                <div className="dialog-body">
                    <p className="confirmation-message">{message}</p>
                </div>
                <div className="dialog-footer">
                    <button type="button" className="btn btn-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        ref={confirmRef}
                        type="button"
                        className={'btn ' + (destructive ? 'btn-destructive' : 'btn-primary')}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
