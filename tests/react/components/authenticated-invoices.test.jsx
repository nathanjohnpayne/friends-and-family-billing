import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'react-dom';

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
    ['copy email', EmailInvoiceDialog, 'Copy'], ['open mail', EmailInvoiceDialog, 'Open Mail App'],
    ['send email', EmailInvoiceDialog, 'Send Email'],
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


describe.each([
    ['Email copy', EmailInvoiceDialog, 'Copy'], ['Email mail', EmailInvoiceDialog, 'Open Mail App'],
    ['Email send', EmailInvoiceDialog, 'Send Email'],
    ['Text copy', TextInvoiceDialog, 'Copy Message'], ['Text SMS', TextInvoiceDialog, 'Open Messages']
])('%s valid context replacement', (_name, Component, actionLabel) => {
    it.each(['resolve', 'reject'])('ignores a stale link %s without unlocking a fresh valid-context action', async outcome => {
        const user = userEvent.setup();
        const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
        const showToast = vi.fn();
        let finishOld, rejectOld, finishFresh;
        createAndPruneShareLink.mockReturnValueOnce(new Promise((resolve, reject) => { finishOld = resolve; rejectOld = reject; }))
            .mockReturnValueOnce(new Promise(resolve => { finishFresh = resolve; }));
        const { rerender } = render(<Component {...base} showToast={showToast} />);
        await user.click(screen.getByRole('button', { name: actionLabel }));
        // Both sources are financially valid; the payment change replaces the
        // invoice context without passing through a household integrity hold.
        const freshProps = { ...base, showToast, payments: [{ ...base.payments[0], amount: .58 }] };
        rerender(<Component {...freshProps} />);
        expect(screen.queryByText('Financial data unavailable')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: actionLabel }));
        await act(async () => {
            if (outcome === 'resolve') finishOld({ url: 'https://example.com/old-context' });
            else rejectOld(new Error('Stale link failure'));
        });
        expect(showToast).not.toHaveBeenCalled();
        for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
        expect(queueEmail).not.toHaveBeenCalled();
        expect(clipboardWrite).not.toHaveBeenCalled();
        expect(openSmsComposer).not.toHaveBeenCalled();
        expect(screen.queryByText('https://example.com/old-context')).not.toBeInTheDocument();
        expect(screen.getAllByRole('textbox').find(field => field.tagName === 'TEXTAREA').value).not.toContain('old-context');
        // Settle the fresh request in an unavailable context: no external action
        // is launched by test cleanup, including the native mail app path.
        rerender(<Component {...freshProps} creditAdjustments={invalid} />);
        await act(async () => { finishFresh({ url: 'https://example.com/fresh-context' }); });
        expect(createAndPruneShareLink).toHaveBeenCalledTimes(2);
        expect(queueEmail).not.toHaveBeenCalled();
        expect(clipboardWrite).not.toHaveBeenCalled();
        expect(openSmsComposer).not.toHaveBeenCalled();
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

describe.each([
    ['Email link', EmailInvoiceDialog, 'Send Email', 'Text + link'],
    ['Email full', EmailInvoiceDialog, 'Send Email', 'Full invoice'],
    ['Email copy', EmailInvoiceDialog, 'Copy', 'Text + link'],
    ['Email mail', EmailInvoiceDialog, 'Open Mail App', 'Full invoice'],
    ['Text copy', TextInvoiceDialog, 'Copy Message', 'Text + link'],
    ['Text SMS', TextInvoiceDialog, 'Open Messages', 'Text + link']
])('%s pending variant change', (_name, Component, actionLabel, selectedLabel) => {
    it('keeps the selected variant fixed and delivers the displayed body after its link resolves', async () => {
        const user = userEvent.setup();
        const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
        let finishLink, finishEmail;
        createAndPruneShareLink.mockReturnValueOnce(new Promise(resolve => { finishLink = resolve; }));
        if (actionLabel === 'Send Email') queueEmail.mockReturnValueOnce(new Promise(resolve => { finishEmail = resolve; }));
        render(<Component {...base} />);
        await user.click(screen.getByRole('radio', { name: selectedLabel }));
        const selected = screen.getByRole('radio', { name: selectedLabel });
        const action = screen.getByRole('button', { name: actionLabel });
        const initialText = screen.getAllByRole('textbox').map(field => field.value);
        await user.click(action);
        expect(action).toBeDisabled();
        for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
        for (const field of screen.getAllByRole('textbox')) {
            expect(field).toBeDisabled();
            await user.type(field, 'Changed while pending');
        }
        expect(screen.getAllByRole('textbox').map(field => field.value)).toEqual(initialText);
        await user.click(screen.getByRole('radio', { name: 'Text only' }));
        expect(selected).toBeChecked();
        expect(screen.getByRole('radio', { name: 'Text only' })).not.toBeChecked();
        await user.click(action);
        expect(createAndPruneShareLink).toHaveBeenCalledOnce();
        expect(queueEmail).not.toHaveBeenCalled();
        expect(openSmsComposer).not.toHaveBeenCalled();
        expect(clipboardWrite).not.toHaveBeenCalled();

        // Intercept the navigation boundary; never launch a real mail app.
        const mailLocation = { href: '' };
        if (actionLabel === 'Open Mail App') {
            const originalWindow = window;
            vi.stubGlobal('window', new Proxy(originalWindow, { get(target, key) {
                return key === 'location' ? mailLocation : Reflect.get(target, key, target);
            } }));
        }
        try {
            await act(async () => { finishLink({ url: 'https://example.com/current-variant' }); });
        } finally {
            vi.unstubAllGlobals();
        }
        const displayedBody = screen.getAllByRole('textbox').find(field => field.tagName === 'TEXTAREA').value;
        expect(displayedBody).toContain('https://example.com/current-variant');
        expect(selected).toBeChecked();
        if (actionLabel === 'Send Email') {
            expect(queueEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                to: 'alice@example.com', body: displayedBody, subject: screen.getAllByRole('textbox')[0].value
            }));
            expect(displayedBody.includes('ANNUAL BILLING SUMMARY')).toBe(selectedLabel === 'Full invoice');
            for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
            await user.click(screen.getByRole('radio', { name: 'Text only' }));
            expect(selected).toBeChecked();
            await act(async () => { finishEmail({}); });
        } else if (actionLabel === 'Open Mail App') {
            const mailto = new URL(mailLocation.href);
            expect(mailto.protocol).toBe('mailto:');
            expect(decodeURIComponent(mailto.pathname)).toBe('alice@example.com');
            expect(mailto.searchParams.get('body')).toBe(displayedBody);
            expect(mailto.searchParams.get('subject')).toBe(screen.getAllByRole('textbox')[0].value);
            expect(displayedBody).toContain('ANNUAL BILLING SUMMARY');
            expect(queueEmail).not.toHaveBeenCalled();
            expect(clipboardWrite).not.toHaveBeenCalled();
        } else if (actionLabel === 'Copy Message' || actionLabel === 'Copy') {
            expect(clipboardWrite).toHaveBeenCalledExactlyOnceWith(displayedBody);
            expect(openSmsComposer).not.toHaveBeenCalled();
        } else {
            expect(openSmsComposer).toHaveBeenCalledExactlyOnceWith('+15555550100', displayedBody, expect.any(Function));
            expect(clipboardWrite).not.toHaveBeenCalled();
        }
        expect(createAndPruneShareLink).toHaveBeenCalledOnce();
        for (const field of screen.getAllByRole('textbox')) expect(field).toBeEnabled();
        for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled();
    });
});


describe.each(['reopen', 'valid-context'])('late queued email after %s', transition => {
    it.each(['resolve', 'reject'])('does not close, toast or unlock the fresh send when the old queue %s completes', async outcome => {
        const user = userEvent.setup();
        const onClose = vi.fn(), showToast = vi.fn();
        let finishOld, rejectOld, finishFresh;
        queueEmail.mockReturnValueOnce(new Promise((resolve, reject) => { finishOld = resolve; rejectOld = reject; }))
            .mockReturnValueOnce(new Promise(resolve => { finishFresh = resolve; }));
        const props = { ...base, onClose, showToast };
        const { rerender } = render(<EmailInvoiceDialog {...props} />);
        await user.click(screen.getByRole('button', { name: 'Send Email' }));
        expect(queueEmail).toHaveBeenCalledOnce();
        let freshProps = props;
        if (transition === 'reopen') {
            rerender(<EmailInvoiceDialog {...props} open={false} />);
        } else freshProps = { ...props, payments: [{ ...base.payments[0], amount: .58 }] };
        rerender(<EmailInvoiceDialog {...freshProps} />);
        await user.click(screen.getByRole('button', { name: 'Send Email' }));
        expect(queueEmail).toHaveBeenCalledTimes(2);
        await act(async () => {
            if (outcome === 'resolve') finishOld({});
            else rejectOld(new Error('Stale queue failure'));
        });
        expect(onClose).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
        for (const field of screen.getAllByRole('textbox')) expect(field).toBeDisabled();
        await act(async () => { finishFresh({}); });
        expect(onClose).toHaveBeenCalledOnce();
        expect(showToast).toHaveBeenCalledExactlyOnceWith('Invoice emailed to alice@example.com');
        expect(queueEmail).toHaveBeenCalledTimes(2);
        for (const field of screen.getAllByRole('textbox')) expect(field).toBeEnabled();
    });
});

describe.each([['Email', EmailInvoiceDialog, 'Copy'], ['Text', TextInvoiceDialog, 'Copy Message']])(
    '%s clipboard completion context', (_name, Component, copyLabel) => {
        it.each(['unchanged', 'reopen', 'valid-context'])('updates Copied only for its original %s context', async transition => {
            const user = userEvent.setup();
            let finishClipboard;
            const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText')
                .mockReturnValueOnce(new Promise(resolve => { finishClipboard = resolve; }));
            const { rerender } = render(<Component {...base} />);
            await user.click(screen.getByRole('button', { name: copyLabel }));
            expect(clipboardWrite).toHaveBeenCalledOnce();
            if (transition === 'reopen') {
                rerender(<Component {...base} open={false} />);
                rerender(<Component {...base} />);
            } else if (transition === 'valid-context') {
                rerender(<Component {...base} payments={[{ ...base.payments[0], amount: .58 }]} />);
            }
            await act(async () => { finishClipboard(); });
            expect(screen.queryByRole('button', { name: 'Copied!' }) !== null).toBe(transition === 'unchanged');
            expect(clipboardWrite).toHaveBeenCalledOnce();
            expect(queueEmail).not.toHaveBeenCalled();
            expect(openSmsComposer).not.toHaveBeenCalled();
        });
    });

describe('late SMS clipboard fallback feedback', () => {
    it.each(['unchanged', 'reopen', 'valid-context'])('toasts only in its original %s context', async transition => {
        const user = userEvent.setup();
        const showToast = vi.fn();
        const { rerender } = render(<TextInvoiceDialog {...base} showToast={showToast} />);
        await user.click(screen.getByRole('button', { name: 'Open Messages' }));
        expect(openSmsComposer).toHaveBeenCalledOnce();
        const copiedFallback = openSmsComposer.mock.calls[0][2];
        if (transition === 'reopen') {
            rerender(<TextInvoiceDialog {...base} showToast={showToast} open={false} />);
            rerender(<TextInvoiceDialog {...base} showToast={showToast} />);
        } else if (transition === 'valid-context') {
            rerender(<TextInvoiceDialog {...base} showToast={showToast} payments={[{ ...base.payments[0], amount: .58 }]} />);
        }
        await act(async () => { copiedFallback(); });
        expect(showToast).toHaveBeenCalledTimes(transition === 'unchanged' ? 1 : 0);
        expect(openSmsComposer).toHaveBeenCalledOnce();
    });
});


describe.each([['Email', EmailInvoiceDialog, 'Copy'], ['Text', TextInvoiceDialog, 'Copy Message']])(
    '%s link result continuation', (_name, Component, copyLabel) => {
        it('keeps the fresh composed body when context changes between helper return and caller continuation', async () => {
            const user = userEvent.setup();
            const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText');
            let finishLink;
            createAndPruneShareLink.mockReturnValueOnce(new Promise(resolve => { finishLink = resolve; }));
            const { rerender } = render(<Component {...base} />);
            await user.click(screen.getByRole('button', { name: copyLabel }));
            await act(async () => {
                finishLink({ url: 'https://example.com/old-helper-result' });
                queueMicrotask(() => flushSync(() => rerender(<Component {...base} payments={[{ ...base.payments[0], amount: .58 }]} />)));
            });
            const freshBody = screen.getAllByRole('textbox').find(field => field.tagName === 'TEXTAREA').value;
            expect(freshBody).not.toContain('old-helper-result');
            expect(freshBody).not.toContain('$0.01');
            expect(clipboardWrite).not.toHaveBeenCalled();
            expect(queueEmail).not.toHaveBeenCalled();
            expect(openSmsComposer).not.toHaveBeenCalled();
        });
    });
