import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '@/app/components/ConfirmDialog.jsx';

describe('ConfirmDialog', () => {
    it('renders nothing when closed', () => {
        const { container } = render(
            <ConfirmDialog open={false} title="Test" message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders title, message, and buttons when open', () => {
        render(
            <ConfirmDialog open={true} title="Delete item?" message="This cannot be undone."
                confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />
        );
        expect(screen.getByText('Delete item?')).toBeInTheDocument();
        expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('calls onConfirm when confirm button clicked', () => {
        const onConfirm = vi.fn();
        render(
            <ConfirmDialog open={true} title="Sure?" message="msg"
                confirmLabel="Yes" onConfirm={onConfirm} onCancel={vi.fn()} />
        );
        fireEvent.click(screen.getByText('Yes'));
        expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('calls onCancel when cancel button clicked', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmDialog open={true} title="Sure?" message="msg"
                onConfirm={vi.fn()} onCancel={onCancel} />
        );
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('calls onCancel on Escape key', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmDialog open={true} title="Sure?" message="msg"
                onConfirm={vi.fn()} onCancel={onCancel} />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('calls onCancel on overlay click', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmDialog open={true} title="Sure?" message="msg"
                onConfirm={vi.fn()} onCancel={onCancel} />
        );
        // Click the overlay (outermost div)
        fireEvent.click(screen.getByRole('presentation'));
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('uses destructive button style when destructive=true', () => {
        render(
            <ConfirmDialog open={true} title="Delete?" message="msg" destructive={true}
                confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />
        );
        expect(screen.getByText('Delete').className).toContain('btn-destructive');
    });

    it('uses primary button style by default', () => {
        render(
            <ConfirmDialog open={true} title="Proceed?" message="msg"
                confirmLabel="OK" onConfirm={vi.fn()} onCancel={vi.fn()} />
        );
        expect(screen.getByText('OK').className).toContain('btn-primary');
    });
});
