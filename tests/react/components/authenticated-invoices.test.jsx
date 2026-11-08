import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('@/lib/mail.js', () => ({ queueEmail: vi.fn(async () => ({})) }));
vi.mock('@/lib/sms.js', () => ({ openSmsComposer: vi.fn() }));
vi.mock('@/lib/ShareLinkService.js', () => ({ createAndPruneShareLink: vi.fn() }));
vi.mock('@/app/contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: { uid: 'test' } }) }));

import EmailInvoiceDialog from '@/app/components/EmailInvoiceDialog.jsx';
import TextInvoiceDialog from '@/app/components/TextInvoiceDialog.jsx';
import { createAndPruneShareLink } from '@/lib/ShareLinkService.js';
import { queueEmail } from '@/lib/mail.js';
import { openSmsComposer } from '@/lib/sms.js';

const base = {
    open: true, memberId: 1, userId: 'test', billingYearId: '2026', onClose: vi.fn(), settings: {},
    activeYear: { id: '2026' }, familyMembers: [{ id: 1, name: 'Alice', email: 'alice@example.com', phone: '+15555550100', linkedMembers: [] }],
    bills: [{ id: 'b', name: 'Internet', billingFrequency: 'annual', amount: 1.15, members: [1, 2] }],
    payments: [{ id: 'p', memberId: 1, amount: .57 }], creditAdjustments: [], owedAdjustments: []
};
const invalid = [{ id: 'r', memberId: 1, type: 'refund', status: 'recorded', amount: '1' }];

beforeEach(() => {
    vi.clearAllMocks();
    createAndPruneShareLink.mockResolvedValue({ url: 'https://example.com/share' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});

describe.each([['Email', EmailInvoiceDialog], ['Text', TextInvoiceDialog]])('%s invoice real-source transitions', (_name, Component) => {
    it('removes stale edits through valid → held → still held → valid without an automatic output action', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<Component {...base} />);
        // Email also has a subject input; find the message by its existing content.
        const body = screen.getAllByRole('textbox').find(field => field.tagName === 'TEXTAREA');
        expect(body.value).toContain('$0.01');
        await user.clear(body);
        await user.type(body, 'STALE money');
        rerender(<Component {...base} creditAdjustments={invalid} />);
        expect(screen.getByText('Correct the affected record before settling this household.')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        rerender(<Component {...base} creditAdjustments={[...invalid]} />);
        expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
        expect(createAndPruneShareLink).not.toHaveBeenCalled();
        rerender(<Component {...base} />);
        expect(screen.getAllByRole('textbox').find(field => field.tagName === 'TEXTAREA').value).toContain('$0.01');
        expect(screen.getAllByRole('textbox').find(field => field.tagName === 'TEXTAREA').value).not.toContain('STALE');
        expect(queueEmail).not.toHaveBeenCalled();
    });
});

describe.each([
    ['copy email', EmailInvoiceDialog, 'Copy'], ['send email', EmailInvoiceDialog, 'Send Email'],
    ['copy text', TextInvoiceDialog, 'Copy Message'], ['open SMS', TextInvoiceDialog, 'Open Messages']
])('pending %s', (_name, Component, action) => {
    it('cannot resume across a real hold even when the source becomes valid again before the link resolves', async () => {
        const user = userEvent.setup();
        const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
        let finish;
        createAndPruneShareLink.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const { rerender } = render(<Component {...base} />);
        await user.click(screen.getByRole('button', { name: action }));
        expect(createAndPruneShareLink).toHaveBeenCalledOnce();
        rerender(<Component {...base} creditAdjustments={invalid} />);
        rerender(<Component {...base} />);
        await act(async () => { finish({ url: 'https://example.com/stale' }); });
        expect(clipboardWrite).not.toHaveBeenCalled();
        expect(queueEmail).not.toHaveBeenCalled();
        expect(openSmsComposer).not.toHaveBeenCalled();
        expect(screen.queryByText('https://example.com/stale')).not.toBeInTheDocument();
    });
});


describe('invoice refund metadata at the actual consumer', () => {
    it.each([20, 30])('shows gross Paid basis and one Refunded row for R=%s', R => {
        render(<EmailInvoiceDialog {...base} bills={[{ ...base.bills[0], amount: 100, members: [1] }]}
            payments={[{ id: 'p', memberId: 1, amount: 120 }]}
            creditAdjustments={[{ id: 'r', memberId: 1, type: 'refund', status: 'recorded', amount: R }]} />);
        expect(screen.getAllByText('Refunded')).toHaveLength(1);
        expect(screen.getByText('$' + R.toFixed(2))).toBeInTheDocument();
        expect(screen.getByText('$' + (R - 20).toFixed(2))).toBeInTheDocument();
    });
});


describe.each([['Email', EmailInvoiceDialog, 'Copy'], ['Text', TextInvoiceDialog, 'Copy Message']])('%s variant cache', (_name, Component, copyLabel) => {
    it('reuses the generated link after changing variants without minting/pruning again', async () => {
        const user = userEvent.setup();
        const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
        render(<Component {...base} />);
        const copy = screen.getByRole('button', { name: copyLabel });
        await user.click(copy);
        await waitFor(() => expect(clipboardWrite).toHaveBeenCalledOnce());
        await user.click(screen.getByLabelText('Text only'));
        await user.click(screen.getByLabelText('Text + link'));
        expect(screen.getAllByRole('textbox').find(field => field.tagName === 'TEXTAREA').value).toContain('https://example.com/share');
        await user.click(copy);
        await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(2));
        expect(createAndPruneShareLink).toHaveBeenCalledOnce();
        expect(clipboardWrite.mock.calls[1][0]).toContain('https://example.com/share');
    });
});

describe.each([['Email', EmailInvoiceDialog, 'Send Email'], ['Text', TextInvoiceDialog, 'Open Messages']])('%s pending variant change', (_name, Component, actionLabel) => {
    it('keeps actions disabled while the original link request is pending', async () => {
        const user = userEvent.setup();
        let finish;
        createAndPruneShareLink.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        render(<Component {...base} />);
        const action = screen.getByRole('button', { name: actionLabel });
        await user.click(action);
        expect(action).toBeDisabled();
        await user.click(screen.getByLabelText('Text only'));
        expect(action).toBeDisabled();
        await user.click(action);
        expect(createAndPruneShareLink).toHaveBeenCalledOnce();
        expect(queueEmail).not.toHaveBeenCalled();
        expect(openSmsComposer).not.toHaveBeenCalled();
        await act(async () => { finish({ url: 'https://example.com/share' }); });
        if (Component === EmailInvoiceDialog) expect(queueEmail).toHaveBeenCalledOnce();
        else expect(openSmsComposer).toHaveBeenCalledOnce();
        expect(createAndPruneShareLink).toHaveBeenCalledOnce();
    });
});
