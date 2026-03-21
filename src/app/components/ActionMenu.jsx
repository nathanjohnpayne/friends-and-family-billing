/**
 * ActionMenu — three-dot trigger with a dropdown of actions.
 * Port of toggleMemberActionsMenu / toggleBillActionsMenu from main.js.
 * Closes on outside click and Escape key.
 */
import { useState, useEffect, useRef } from 'react';

/**
 * @param {{ label: string, trigger?: React.ReactNode, children: React.ReactNode }} props
 * label — accessible name for the menu
 * trigger — optional custom trigger (defaults to "•••" button)
 * children — menu item buttons rendered inside the dropdown
 */
export default function ActionMenu({ label, trigger, children }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const triggerRef = useRef(null);

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
                aria-expanded={open}
            >
                {trigger || '•••'}
            </button>
            {open && (
                <div className="action-menu-dropdown" role="menu" aria-label={label}>
                    {children}
                </div>
            )}
        </div>
    );
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
