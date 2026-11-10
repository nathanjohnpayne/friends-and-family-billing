import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReloadRequiredDialog from '@/app/components/ReloadRequiredDialog.jsx';
import SaveStatusNotice from '@/app/components/SaveStatusNotice.jsx';

// The read-only Reload required state (#669, RD-34, #fx-dashboard-stale-desk / -ph).

const block = (extra = {}) => ({
    version: 1, uid: 'u1', yearId: '2026', yearLabel: '2026', reason: 'stale',
    detectedAt: '2026-11-10T15:12:00', baselineAt: '2026-11-10T15:09:00', baselineKind: 'saved',
    changes: [
        { kind: 'event', label: 'Payment recorded', detail: 'Ada Okafor', amount: 50, at: '2026-11-10T15:10:00' },
        { kind: 'event', label: 'Service credit', detail: 'Meridian Music · “Outage, March”', amount: 12, at: '2026-11-10T15:11:00' },
        { kind: 'member', label: 'Member edited', detail: 'Kenji Nakamura · phone number', amount: null, at: null }
    ],
    payload: { label: '2026' },
    keptOnDevice: true, storageError: null,
    ...extra
});

function stubClipboard(impl) {
    const writeText = vi.fn(impl || (async () => {}));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    return writeText;
}

afterEach(() => {
    delete navigator.clipboard;
});

describe('ReloadRequiredDialog', () => {
    it('renders nothing while the tab can write', () => {
        const { container } = render(<ReloadRequiredDialog writeBlock={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('blocks the tab with the last successful save, the unsaved list, Copy details and Reload', async () => {
        const onReload = vi.fn();
        render(<ReloadRequiredDialog writeBlock={block()} onReload={onReload} />);
        const dialog = screen.getByRole('dialog', { name: 'Reload to continue' });
        expect(dialog).toHaveTextContent('2026 was changed in another tab or device');
        expect(dialog).toHaveTextContent(/since your last successful save at 3:09\s?pm was saved/);
        expect(dialog).toHaveTextContent(/Not saved since 3:09\s?pm · 3 changes/);
        const items = within(screen.getByRole('list', { name: 'Unsaved changes' })).getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(items[0]).toHaveTextContent('Payment recorded · Ada Okafor');
        expect(items[0]).toHaveTextContent('$50.00');
        expect(items[2]).toHaveTextContent('no event—found by comparing the unsaved data');
        expect(dialog).toHaveTextContent('This list is kept on this device and shown again after you reload');
        const reload = screen.getByRole('button', { name: 'Reload' });
        expect(reload).toBeEnabled();
        await userEvent.click(reload);
        expect(onReload).toHaveBeenCalledTimes(1);
    });

    it('does not close on Escape', async () => {
        render(<ReloadRequiredDialog writeBlock={block()} onReload={() => {}} />);
        await userEvent.keyboard('{Escape}');
        expect(screen.getByRole('dialog', { name: 'Reload to continue' })).toBeInTheDocument();
    });

    it('copies the summary and the full payload JSON', async () => {
        const writeText = stubClipboard();
        render(<ReloadRequiredDialog writeBlock={block()} onReload={() => {}} />);
        await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));
        expect(writeText).toHaveBeenCalledTimes(1);
        const text = writeText.mock.calls[0][0];
        expect(text).toContain('- Payment recorded: Ada Okafor (50.00)');
        expect(text).toContain('Unsaved data (JSON):');
        expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    it('when the list could not be kept, Reload waits for a copy', async () => {
        stubClipboard();
        render(<ReloadRequiredDialog writeBlock={block({ keptOnDevice: false, storageError: 'This device is out of storage space.' })} onReload={() => {}} />);
        expect(screen.getByRole('alert')).toHaveTextContent('This list could not be kept on this device (This device is out of storage space.)—copy it before you reload.');
        expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
        await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));
        expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
    });

    it('when the list could not be kept, Reload without copying is an explicit choice', async () => {
        render(<ReloadRequiredDialog writeBlock={block({ keptOnDevice: false, storageError: 'Storage is unavailable on this device.' })} onReload={() => {}} />);
        expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
        await userEvent.click(screen.getByRole('checkbox', { name: 'Reload without copying' }));
        expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
    });

    it('shows the text to copy by hand when the clipboard refuses, without enabling Reload', async () => {
        stubClipboard(async () => { throw new Error('denied'); });
        render(<ReloadRequiredDialog writeBlock={block({ keptOnDevice: false })} onReload={() => {}} />);
        await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));
        expect(screen.getByRole('textbox', { name: 'Unsaved details' }).value).toContain('Unsaved data (JSON):');
        expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    });

    it('explains a refused write (permission-denied) the same way', () => {
        render(<ReloadRequiredDialog writeBlock={block({ reason: 'permission-denied' })} onReload={() => {}} />);
        expect(screen.getByRole('dialog')).toHaveTextContent('The server refused this tab’s save of 2026');
    });
});

describe('SaveStatusNotice', () => {
    it('reads Not saved for a write that did not commit, and nothing otherwise', () => {
        const { rerender, container } = render(<SaveStatusNotice saveStatus={{ state: 'not_saved', message: 'You’re offline, so nothing was written. It is retried with your next change.' }} />);
        expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Not saved. You’re offline, so nothing was written.');
        rerender(<SaveStatusNotice saveStatus={null} />);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByText(/saved/i)).toBeNull();
    });
});
