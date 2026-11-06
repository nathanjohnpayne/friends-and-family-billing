import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dialog from '@/app/components/Dialog.jsx';

function Harness({ initiallyOpen = false, onClose, ...props }) {
    const [open, setOpen] = useState(initiallyOpen);
    return (
        <>
            <button onClick={() => setOpen(true)}>Open</button>
            <Dialog
                open={open}
                onClose={() => { setOpen(false); if (onClose) onClose(); }}
                title="Edit Payment"
                footer={(
                    <>
                        <button onClick={() => setOpen(false)}>Cancel</button>
                        <button>Save</button>
                    </>
                )}
                {...props}
            >
                <label htmlFor="note">Note</label>
                <input id="note" />
            </Dialog>
        </>
    );
}

describe('Dialog', () => {
    it('renders nothing when closed', () => {
        render(<Dialog open={false} onClose={vi.fn()} title="Hidden">body</Dialog>);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('is a modal dialog labelled by its title', () => {
        render(<Dialog onClose={vi.fn()} title="Record Payment">body</Dialog>);
        const dialog = screen.getByRole('dialog', { name: 'Record Payment' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('heading', { name: 'Record Payment' })).toBeInTheDocument();
    });

    it('falls back to ariaLabel when there is no visible title', () => {
        render(<Dialog onClose={vi.fn()} ariaLabel="Untitled">body</Dialog>);
        expect(screen.getByRole('dialog', { name: 'Untitled' })).toBeInTheDocument();
    });

    it('renders into document.body, outside the parent tree', () => {
        const { container } = render(<Dialog onClose={vi.fn()} title="Portalled">body</Dialog>);
        expect(container).toBeEmptyDOMElement();
        expect(document.body).toContainElement(screen.getByRole('dialog'));
    });

    it('renders the footer outside the scrolling content', () => {
        render(<Harness initiallyOpen />);
        const save = screen.getByRole('button', { name: 'Save' });
        const note = screen.getByLabelText('Note');
        // The footer is a sibling of the content region, not inside it.
        expect(note.closest('.dialog-content')).not.toBeNull();
        expect(save.closest('.dialog-content')).toBeNull();
        expect(save.closest('[role="dialog"]')).not.toBeNull();
    });

    it('moves focus to the first control on open and back to the opener on close', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Open' });
        await user.click(opener);
        expect(screen.getByLabelText('Note')).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
    });

    it('honours initialFocusRef', () => {
        function WithRef() {
            const ref = useRef(null);
            return (
                <Dialog onClose={vi.fn()} title="Confirm" initialFocusRef={ref}
                    footer={<button ref={ref}>Confirm</button>}>
                    <input aria-label="first" />
                </Dialog>
            );
        }
        render(<WithRef />);
        expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
    });

    it('keeps an autoFocus child focused', () => {
        render(
            <Dialog onClose={vi.fn()} title="Amount">
                <input aria-label="first" />
                <input aria-label="amount" autoFocus />
            </Dialog>
        );
        expect(screen.getByLabelText('amount')).toHaveFocus();
    });

    it('traps Tab inside the dialog', async () => {
        const user = userEvent.setup();
        render(<Harness initiallyOpen />);
        expect(screen.getByLabelText('Note')).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
        await user.tab();
        expect(screen.getByLabelText('Note')).toHaveFocus();
        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    });

    it('closes on an overlay click but not on a click inside the card', () => {
        const onClose = vi.fn();
        render(<Dialog onClose={onClose} title="Overlay">body</Dialog>);
        fireEvent.click(screen.getByText('body'));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('presentation'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not close when a press starts inside the card and ends on the overlay', () => {
        const onClose = vi.fn();
        render(<Dialog onClose={onClose} title="Drag"><input aria-label="field" /></Dialog>);
        const overlay = screen.getByRole('presentation');
        // A text-selection drag: press in the input, release over the overlay.
        fireEvent.mouseDown(screen.getByLabelText('field'));
        fireEvent.click(overlay);
        expect(onClose).not.toHaveBeenCalled();
        // A press and release on the overlay itself still dismisses.
        fireEvent.mouseDown(overlay);
        fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('can opt out of Escape and overlay dismissal', () => {
        const onClose = vi.fn();
        render(<Dialog onClose={onClose} title="Busy" closeOnEscape={false} closeOnOverlayClick={false}>body</Dialog>);
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(screen.getByRole('presentation'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('wraps content and footer in a form when onSubmit is given', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn(e => e.preventDefault());
        render(
            <Dialog onClose={vi.fn()} title="Form" onSubmit={onSubmit}
                footer={<button type="submit">Save</button>}>
                <input aria-label="field" />
            </Dialog>
        );
        await user.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('locks page scroll while open and restores it on close', () => {
        document.body.style.overflow = 'auto';
        const { rerender } = render(<Dialog onClose={vi.fn()} title="Lock">body</Dialog>);
        expect(document.body.style.overflow).toBe('hidden');
        rerender(<Dialog open={false} onClose={vi.fn()} title="Lock">body</Dialog>);
        expect(document.body.style.overflow).toBe('auto');
        document.body.style.overflow = '';
    });

    describe('stacked dialogs', () => {
        function Stacked({ onOuterClose, onInnerClose }) {
            const [inner, setInner] = useState(false);
            return (
                <Dialog onClose={onOuterClose} title="Payment History"
                    footer={<button onClick={onOuterClose}>Close</button>}>
                    <button onClick={() => setInner(true)}>Edit</button>
                    {inner && (
                        <Dialog onClose={() => { setInner(false); onInnerClose(); }} title="Edit Payment">
                            <input aria-label="Method" />
                        </Dialog>
                    )}
                </Dialog>
            );
        }

        it('paints the inner dialog after (above) the outer one', async () => {
            const user = userEvent.setup();
            render(<Stacked onOuterClose={vi.fn()} onInnerClose={vi.fn()} />);
            await user.click(screen.getByRole('button', { name: 'Edit' }));
            const dialogs = screen.getAllByRole('dialog');
            expect(dialogs[0]).toBe(screen.getByRole('dialog', { name: 'Payment History' }));
            expect(dialogs[1]).toBe(screen.getByRole('dialog', { name: 'Edit Payment' }));
            // Later in document order = painted above at the same z-index.
            expect(dialogs[0].compareDocumentPosition(dialogs[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('Escape closes only the topmost dialog and returns focus to its opener', async () => {
            const user = userEvent.setup();
            const onOuterClose = vi.fn();
            const onInnerClose = vi.fn();
            render(<Stacked onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);
            const edit = screen.getByRole('button', { name: 'Edit' });
            await user.click(edit);
            expect(screen.getByLabelText('Method')).toHaveFocus();
            await user.keyboard('{Escape}');
            expect(onInnerClose).toHaveBeenCalledOnce();
            expect(onOuterClose).not.toHaveBeenCalled();
            expect(screen.getByRole('dialog', { name: 'Payment History' })).toBeInTheDocument();
            expect(edit).toHaveFocus();
        });

        it('a click inside the inner dialog does not close the outer one', async () => {
            const user = userEvent.setup();
            const onOuterClose = vi.fn();
            render(<Stacked onOuterClose={onOuterClose} onInnerClose={vi.fn()} />);
            await user.click(screen.getByRole('button', { name: 'Edit' }));
            await user.click(screen.getByLabelText('Method'));
            expect(onOuterClose).not.toHaveBeenCalled();
        });

        it('an overlay click on the inner dialog closes only the inner one', async () => {
            const user = userEvent.setup();
            const onOuterClose = vi.fn();
            const onInnerClose = vi.fn();
            render(<Stacked onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);
            await user.click(screen.getByRole('button', { name: 'Edit' }));
            const overlays = screen.getAllByRole('presentation');
            fireEvent.click(overlays[overlays.length - 1]);
            expect(onInnerClose).toHaveBeenCalledOnce();
            expect(onOuterClose).not.toHaveBeenCalled();
        });
    });
});
