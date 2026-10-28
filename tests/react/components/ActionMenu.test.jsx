import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionMenu, { ActionMenuItem, ActionMenuSeparator, MENU_GUTTER, menuAlignment } from '@/app/components/ActionMenu.jsx';

function renderMenu(props = {}) {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    return {
        onEdit, onDelete,
        ...render(
            <ActionMenu label="Actions" {...props}>
                <ActionMenuItem onClick={onEdit}>Edit</ActionMenuItem>
                <ActionMenuItem onClick={onDelete} danger>Delete</ActionMenuItem>
            </ActionMenu>
        )
    };
}

describe('ActionMenu', () => {
    it('renders trigger button but not dropdown initially', () => {
        renderMenu();
        expect(screen.getByLabelText('Actions')).toBeInTheDocument();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('opens dropdown on trigger click', () => {
        renderMenu();
        fireEvent.click(screen.getByLabelText('Actions'));
        expect(screen.getByRole('menu')).toBeInTheDocument();
        expect(screen.getByText('Edit')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('closes dropdown on second trigger click', () => {
        renderMenu();
        const trigger = screen.getByLabelText('Actions');
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).toBeInTheDocument();
        fireEvent.click(trigger);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes on Escape key', () => {
        renderMenu();
        fireEvent.click(screen.getByLabelText('Actions'));
        expect(screen.getByRole('menu')).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes on outside click', () => {
        renderMenu();
        fireEvent.click(screen.getByLabelText('Actions'));
        expect(screen.getByRole('menu')).toBeInTheDocument();
        fireEvent.click(document.body);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('calls item onClick handler', () => {
        const { onEdit } = renderMenu();
        fireEvent.click(screen.getByLabelText('Actions'));
        fireEvent.click(screen.getByText('Edit'));
        expect(onEdit).toHaveBeenCalledOnce();
    });

    it('renders danger items as menu items', () => {
        renderMenu();
        fireEvent.click(screen.getByLabelText('Actions'));
        expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('exposes the default trigger as a named menu button with a hidden icon', () => {
        renderMenu();
        const trigger = screen.getByRole('button', { name: 'Actions' });
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        // The ellipsis is decorative; the accessible name comes from the label alone.
        expect(trigger).toHaveTextContent('');
    });

    it('renders a separator between item groups', () => {
        render(
            <ActionMenu label="More">
                <ActionMenuItem onClick={() => {}}>One</ActionMenuItem>
                <ActionMenuSeparator />
                <ActionMenuItem onClick={() => {}}>Two</ActionMenuItem>
            </ActionMenu>
        );
        fireEvent.click(screen.getByLabelText('More'));
        expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('sets aria-expanded on trigger', () => {
        renderMenu();
        const trigger = screen.getByLabelText('Actions');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    describe('viewport collision (#575)', () => {
        // jsdom does no layout, so the trigger's box and the menu's width are stubbed.
        function openAt(triggerLeft, viewportWidth = 390, menuWidth = 190) {
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
                left: triggerLeft, right: triggerLeft + 30, top: 0, bottom: 30, width: 30, height: 30, x: triggerLeft, y: 0
            });
            vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(menuWidth);
            vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(viewportWidth);
            renderMenu();
            fireEvent.click(screen.getByLabelText('Actions'));
            return screen.getByRole('menu');
        }

        afterEach(() => vi.restoreAllMocks());

        it('hangs from the trigger’s right edge when the menu fits to its left', () => {
            expect(openAt(300)).toHaveAttribute('data-align', 'end');
        });

        it('hangs from the trigger’s left edge when the right edge would push it off a phone screen', () => {
            // A trigger at x=140 on a 390 px phone: a 190 px right-aligned menu would start at -20.
            expect(openAt(140)).toHaveAttribute('data-align', 'start');
        });
    });

    describe('menuAlignment', () => {
        const box = (triggerLeft, viewportWidth = 390, menuWidth = 190) =>
            menuAlignment({ triggerLeft, triggerRight: triggerLeft + 30, menuWidth, viewportWidth });

        it('keeps the default end alignment while the menu clears the left gutter', () => {
            expect(box(MENU_GUTTER + 190 - 30)).toBe('end');
            expect(box(1000, 1280)).toBe('end');
        });

        it('flips to start alignment when end alignment would cross the left gutter', () => {
            expect(box(MENU_GUTTER + 190 - 31)).toBe('start');
            expect(box(16)).toBe('start');
        });

        it('stays at the end when flipping would overflow the right side more', () => {
            // 200 px viewport, 190 px menu: neither fits; the end overflow (8 + 190 - 130 = 68)
            // is smaller than the start overflow (100 + 190 - 192 = 98).
            expect(box(100, 200)).toBe('end');
        });
    });
});
