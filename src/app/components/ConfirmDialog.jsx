/**
 * ConfirmDialog — title, message, Cancel / Confirm, on the shared Dialog primitive.
 * Port of showConfirmationDialog() from main.js:5076.
 * Focus starts on the confirm button; Escape or an overlay click cancels.
 */
import { useRef } from 'react';
import Dialog from './Dialog.jsx';

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

    return (
        <Dialog
            open={open}
            onClose={onCancel}
            title={title}
            className="confirmation-dialog"
            initialFocusRef={confirmRef}
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        ref={confirmRef}
                        type="button"
                        className={'btn ' + (destructive ? 'btn-destructive' : 'btn-ink')}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </>
            )}
        >
            <p className="confirmation-message">{message}</p>
        </Dialog>
    );
}
