/**
 * ActionMenu — three-dot trigger with a dropdown of actions.
 * Port of toggleMemberActionsMenu / toggleBillActionsMenu from main.js.
 * Closes on outside click and Escape key.
 *
 * Styled by `.action-menu-*` in shell.css after the wireframe's `.ico-btn`
 * trigger and `.menu-pop` popover (plans/ffb-wireframes.html § Visual
 * system): a round Graphite ellipsis button and a 10 px Paper menu.
 *
 * The menu hangs from the trigger's right edge. When that would push it past
 * the left edge of the viewport (a trigger near the left of a 390 px phone),
 * it hangs from the trigger's left edge instead, as the wireframe's phone
 * frames draw it (#575).
 */
import { useState, useEffect, useLayoutEffect, useRef } from 'react';

/** Minimum gap, in px, between an open menu and the viewport edge. */
export const MENU_GUTTER = 8;

/**
 * Which trigger edge the menu hangs from: 'end' (right edges aligned, the
 * default) or 'start' (left edges aligned). 'start' only when the default
 * would cross the left gutter and the flipped menu fits, or overflows less.
 * @param {{ triggerLeft: number, triggerRight: number, menuWidth: number, viewportWidth: number }} box
 * @returns {'end'|'start'}
 */
export function menuAlignment({ triggerLeft, triggerRight, menuWidth, viewportWidth }) {
    const endOverflow = Math.max(0, MENU_GUTTER - (triggerRight - menuWidth));
    if (endOverflow === 0) return 'end';
    const startOverflow = Math.max(0, triggerLeft + menuWidth - (viewportWidth - MENU_GUTTER));
    return startOverflow < endOverflow ? 'start' : 'end';
}

/** Lucide "ellipsis" (ISC), inlined so the menu stays dependency-free. */
function EllipsisIcon() {
    return (
        <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
        </svg>
    );
}

/**
 * @param {{ label: string, trigger?: React.ReactNode, children: React.ReactNode }} props
 * label — accessible name for the menu
 * trigger — optional custom trigger (defaults to an ellipsis icon button)
 * children — menu item buttons rendered inside the dropdown
 */
export default function ActionMenu({ label, trigger, children }) {
    const [open, setOpen] = useState(false);
    const [align, setAlign] = useState('end');
    const containerRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);

    // Keep the open menu inside the viewport: measured before paint, and again
    // whenever the viewport resizes while the menu stays open.
    useLayoutEffect(() => {
        if (!open) return;
        function measure() {
            if (!menuRef.current || !triggerRef.current) return;
            const { left, right } = triggerRef.current.getBoundingClientRect();
            setAlign(menuAlignment({
                triggerLeft: left,
                triggerRight: right,
                menuWidth: menuRef.current.offsetWidth,
                viewportWidth: document.documentElement.clientWidth
            }));
        }
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [open]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        function handleClick(e) {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        }
        document.addEventListener('click', handleClick, true);
        return () => document.removeEventListener('click', handleClick, true);
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        function handleKey(e) {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open]);

    function toggle(e) {
        e.stopPropagation();
        setOpen(prev => !prev);
    }

    return (
        <div className="action-menu" ref={containerRef}>
            <button
                ref={triggerRef}
                type="button"
                className="action-menu-trigger"
                onClick={toggle}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                {trigger || <EllipsisIcon />}
            </button>
            {open && (
                <div
                    ref={menuRef}
                    className="action-menu-dropdown"
                    data-align={align}
                    role="menu"
                    aria-label={label}
                >
                    {children}
                </div>
            )}
        </div>
    );
}

/** Hairline between groups of items (wireframe .menu-pop .sep). */
export function ActionMenuSeparator() {
    return <div className="action-menu-separator" role="separator" />;
}

/**
 * Single item inside an ActionMenu dropdown.
 * @param {{ onClick: () => void, danger?: boolean, children: React.ReactNode }} props
 */
export function ActionMenuItem({ onClick, danger, children }) {
    return (
        <button
            type="button"
            role="menuitem"
            className={'action-menu-item' + (danger ? ' action-menu-item--danger' : '')}
            onClick={onClick}
        >
            {children}
        </button>
    );
}
