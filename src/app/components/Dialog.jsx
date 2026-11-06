/**
 * Dialog — the one modal primitive every dialog in the app renders through (#527, RD-14).
 *
 * Desktop and tablet: a centred card over a dimmed overlay. Phone (≤600 px): the same
 * markup becomes a bottom sheet with a grab handle and full-width footer buttons
 * (CSS only, see `.dialog` in shell.css). The body scrolls while the title and footer
 * stay visible, so the actions are reachable without scrolling.
 *
 * Behaviour:
 * - Rendered into document.body through a portal, so a dialog opened from inside
 *   another dialog (Edit Payment over Payment History) stacks above it.
 * - Focus moves into the dialog on open (initialFocusRef, else an autoFocus child,
 *   else the first focusable control, else the dialog itself), Tab is trapped inside
 *   the topmost dialog, and focus returns to the opener on close.
 * - Escape and a click on the overlay close only the topmost dialog.
 * - role="dialog", aria-modal="true", labelled by its title.
 * - Page scroll is locked while any dialog is open.
 */
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = [
    'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', 'iframe', '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

/** Open dialogs, oldest first. The last entry is the topmost. */
const stack = [];
let savedBodyOverflow = null;

function isTop(entry) {
    return stack.length > 0 && stack[stack.length - 1] === entry;
}

function focusableIn(node) {
    return Array.from(node.querySelectorAll(FOCUSABLE)).filter(el => {
        if (el.closest('[hidden]') || el.closest('[inert]')) return false;
        // Skip display:none controls (e.g. a hidden file input). jsdom has no layout,
        // so fall back to the computed style rather than offsetParent.
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    });
}

/**
 * @param {{
 *   open?: boolean,
 *   onClose: () => void,
 *   title?: import('react').ReactNode,
 *   titleAside?: import('react').ReactNode,
 *   ariaLabel?: string,
 *   footer?: import('react').ReactNode,
 *   footerClassName?: string,
 *   onSubmit?: (e: import('react').FormEvent) => void,
 *   wide?: boolean,
 *   className?: string,
 *   initialFocusRef?: import('react').RefObject<HTMLElement>,
 *   closeOnOverlayClick?: boolean,
 *   closeOnEscape?: boolean,
 *   children?: import('react').ReactNode
 * }} props
 */
export default function Dialog({
    open = true,
    onClose,
    title,
    titleAside,
    ariaLabel,
    footer,
    footerClassName,
    onSubmit,
    wide = false,
    className,
    initialFocusRef,
    closeOnOverlayClick = true,
    closeOnEscape = true,
    children
}) {
    const titleId = useId();
    const dialogRef = useRef(null);
    const entryRef = useRef(null);
    const openerRef = useRef(null);
    // Whether the current press began on the overlay itself. A drag that starts
    // inside the card (selecting input text) and is released over the overlay
    // fires click on the overlay, which must not dismiss. null = no press seen
    // (a synthetic click), which keeps a bare overlay click dismissing.
    const pressStartRef = useRef(null);
    // Latest handlers, read by the long-lived document listener.
    const latest = useRef({ onClose, closeOnEscape });
    latest.current = { onClose, closeOnEscape };

    // Capture the opener during render, before an autoFocus child steals focus in the commit.
    if (open && openerRef.current === null && typeof document !== 'undefined') {
        openerRef.current = document.activeElement;
    }
    if (!open) openerRef.current = null;

    // Register on the stack, lock page scroll, and restore focus on close.
    useLayoutEffect(() => {
        if (!open) return undefined;
        const entry = {};
        entryRef.current = entry;
        stack.push(entry);
        if (stack.length === 1) {
            savedBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        const opener = openerRef.current;
        return () => {
            const i = stack.indexOf(entry);
            if (i !== -1) stack.splice(i, 1);
            if (stack.length === 0) {
                document.body.style.overflow = savedBodyOverflow || '';
                savedBodyOverflow = null;
            }
            if (opener && typeof opener.focus === 'function' && opener.isConnected) {
                opener.focus();
            }
        };
    }, [open]);

    // Move focus into the dialog on open.
    useEffect(() => {
        if (!open) return;
        const node = dialogRef.current;
        if (!node) return;
        if (initialFocusRef && initialFocusRef.current) {
            initialFocusRef.current.focus();
            return;
        }
        if (node.contains(document.activeElement)) return; // an autoFocus child already has it
        const first = focusableIn(node.querySelector('.dialog-content') || node)[0];
        (first || node).focus();
        // initialFocusRef is a ref; reading .current at open time is the intent.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Escape closes, Tab is trapped — only for the topmost dialog.
    useEffect(() => {
        if (!open) return undefined;
        function handleKey(e) {
            const entry = entryRef.current;
            if (!isTop(entry)) return;
            if (e.key === 'Escape') {
                if (!latest.current.closeOnEscape) return;
                e.stopPropagation();
                latest.current.onClose();
                return;
            }
            if (e.key !== 'Tab') return;
            const node = dialogRef.current;
            if (!node) return;
            const items = focusableIn(node);
            if (items.length === 0) {
                e.preventDefault();
                node.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && (active === first || !node.contains(active))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || !node.contains(active))) {
                e.preventDefault();
                first.focus();
            }
        }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open]);

    if (!open || typeof document === 'undefined') return null;

    function handleOverlayClick(e) {
        // target === currentTarget: a click inside a stacked (portalled) child dialog
        // bubbles through the React tree but never targets this overlay.
        if (e.target !== e.currentTarget) return;
        const startedInsideCard = pressStartRef.current === false;
        pressStartRef.current = null;
        if (startedInsideCard) return;
        if (!closeOnOverlayClick || !isTop(entryRef.current)) return;
        onClose();
    }

    const hasTitle = title !== undefined && title !== null && title !== false;
    const header = hasTitle ? (
        titleAside ? (
            <div className="dialog-head">
                <h2 className="dialog-title" id={titleId}>{title}</h2>
                {titleAside}
            </div>
        ) : (
            <h2 className="dialog-title" id={titleId}>{title}</h2>
        )
    ) : null;

    const body = (
        <>
            <div className="dialog-content">{children}</div>
            {footer ? (
                <div className={'dialog-buttons' + (footerClassName ? ' ' + footerClassName : '')}>{footer}</div>
            ) : null}
        </>
    );

    const classes = ['dialog', wide ? 'dialog--wide' : '', className || ''].filter(Boolean).join(' ');

    return createPortal(
        <div
            className="dialog-overlay"
            onMouseDown={e => { pressStartRef.current = e.target === e.currentTarget; }}
            onClick={handleOverlayClick}
            role="presentation"
        >
            <div
                ref={dialogRef}
                className={classes}
                role="dialog"
                aria-modal="true"
                aria-labelledby={hasTitle ? titleId : undefined}
                aria-label={hasTitle ? undefined : ariaLabel}
                tabIndex={-1}
            >
                <div className="dialog-grab" aria-hidden="true" />
                {header}
                {onSubmit ? (
                    <form className="dialog-form" onSubmit={onSubmit}>{body}</form>
                ) : body}
            </div>
        </div>,
        document.body
    );
}
