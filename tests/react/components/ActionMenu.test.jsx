import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionMenu, { ActionMenuItem } from '@/app/components/ActionMenu.jsx';

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

    it('sets aria-expanded on trigger', () => {
        renderMenu();
        const trigger = screen.getByLabelText('Actions');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });
});
