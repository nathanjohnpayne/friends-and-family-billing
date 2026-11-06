import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const control = vi.hoisted(() => ({ held: new Set(), state: null, hashPromise: null }));
vi.mock('@/lib/calculations.js', async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, getHouseholdFinancials: (...args) => control.held.has(args[0].id)
        ? { ok: false, householdId: args[0].id, holds: [{ component: 'R', recordId: 'private-record' }] }
        : actual.getHouseholdFinancials(...args) };
});
vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((_db, ...parts) => parts.join('/')), collection: vi.fn(), query: vi.fn(), where: vi.fn(),
    setDoc: vi.fn(async () => {}), deleteDoc: vi.fn(async () => {}), serverTimestamp: vi.fn(),
    getDocs: vi.fn(async () => ({ docs: [] })), getDoc: vi.fn(async () => ({ exists: () => false }))
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), deleteObject: vi.fn() }));
vi.mock('@/app/hooks/useBillingData.js', () => ({ useBillingData: () => control.state }));
vi.mock('@/app/hooks/useDisputes.js', () => ({ useDisputes: () => ({ disputes: [] }) }));
vi.mock('@/app/hooks/useRefundNotices.js', () => ({ useRefundNotices: () => ({ refundNotices: [] }) }));
vi.mock('@/app/contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: { uid: 'test-user', email: 'test@example.com' } }) }));
vi.mock('@/lib/ChargeNoticeService.js', () => ({ issueChargeNotice: vi.fn(async () => ({})) }));
vi.mock('@/lib/mail.js', () => ({ queueEmail: vi.fn(async () => ({})) }));
vi.mock('@/lib/sms.js', () => ({ openSmsComposer: vi.fn() }));
vi.mock('@/lib/ShareLinkService.js', () => ({ createAndPruneShareLink: vi.fn(async () => ({ url: 'https://example.com/share' })) }));
vi.mock('@/lib/validation.js', async importOriginal => ({ ...await importOriginal(),
    generateRawToken: () => 'synthetic-token', hashToken: () => control.hashPromise || Promise.resolve('synthetic-hash') }));
vi.mock('@/app/components/TemplateEditor.jsx', () => ({ default: () => <div>Template editor</div> }));
vi.mock('@/app/components/SubjectEditor.jsx', () => ({ default: () => <div>Subject editor</div> }));

import SettlementBoard from '@/app/components/SettlementBoard.jsx';
import DashboardView from '@/app/views/Dashboard/DashboardView.jsx';
import InvoicingTab from '@/app/views/Manage/InvoicingTab.jsx';
import EmailInvoiceDialog from '@/app/components/EmailInvoiceDialog.jsx';
import TextInvoiceDialog from '@/app/components/TextInvoiceDialog.jsx';
import ShareLinkDialog from '@/app/components/ShareLinkDialog.jsx';
import PaymentHistoryDialog from '@/app/components/PaymentHistoryDialog.jsx';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import { createAndPruneShareLink } from '@/lib/ShareLinkService.js';
import { queueEmail } from '@/lib/mail.js';
import { issueChargeNotice } from '@/lib/ChargeNoticeService.js';
import { openSmsComposer } from '@/lib/sms.js';
import { getDocs, setDoc, deleteDoc } from 'firebase/firestore';

const members = ['Alice', 'Bob', 'Carol'].map((name, index) => ({
    id: index + 1, name, email: name.toLowerCase() + '@example.com', phone: '+15555550100', linkedMembers: [], avatar: ''
}));
const bills = [{ id: 'bill', amount: 300, billingFrequency: 'annual', members: [1, 2, 3], name: 'Internet' }];
const base = { familyMembers: members, bills, payments: [{ id: 'a', memberId: 1, amount: 100 }, { id: 'b', memberId: 2, amount: 100 }],
    creditAdjustments: [], owedAdjustments: [], activeYear: { id: '2026', label: '2026', status: 'settling' }, settings: {} };
const dialogProps = { ...base, open: true, memberId: 1, memberName: 'Alice', userId: 'test-user', billingYearId: '2026', yearLabel: '2026', onClose: vi.fn() };
const mount = element => render(<MemoryRouter><ToastProvider>{element}</ToastProvider></MemoryRouter>);

beforeEach(() => {
    vi.clearAllMocks();
    control.held.clear();
    control.hashPromise = null;
    control.state = { ...structuredClone(base), loading: false,
        service: { getState: () => control.state, updateSettings: vi.fn(), setYearStatus: vi.fn(), recordPayment: vi.fn(), billDeferredCharges: vi.fn(() => ({ chargeNoticeId: 'notice', charges: [] })) } };
});

describe('inactive held-state consumer contract', () => {
    it('keeps held audit access while withholding money, paid status and financial entry points', async () => {
        const user = userEvent.setup();
        control.held.add(1);
        const onRecordPayment = vi.fn();
        render(<SettlementBoard {...base} readOnly={false} onRecordPayment={onRecordPayment} />);
        const alice = within(screen.getByRole('region', { name: 'Settlement for Alice' }));
        expect(alice.getByText('Financial data unavailable')).toBeInTheDocument();
        expect(alice.getByText('Correct the affected record before settling this household.')).toBeInTheDocument();
        expect(alice.queryByText('Paid')).not.toBeInTheDocument();
        expect(alice.queryByText('Settled')).not.toBeInTheDocument();
        await user.click(alice.getByText('Alice'));
        expect(alice.getByRole('button', { name: 'Payment History' })).toBeInTheDocument();
        expect(alice.queryByText(/\$/)).not.toBeInTheDocument();
        expect(alice.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
        expect(alice.queryByRole('button', { name: 'Text Invoice' })).not.toBeInTheDocument();
        const carol = within(screen.getByRole('region', { name: 'Settlement for Carol' }));
        await user.click(carol.getByText('Carol'));
        await user.click(carol.getByRole('button', { name: 'Record Payment' }));
        await user.type(screen.getByLabelText('Amount ($)'), '200');
        await user.click(screen.getByRole('button', { name: 'Save Payment' }));
        expect(onRecordPayment).toHaveBeenCalledWith(expect.objectContaining({ memberId: 3, amount: 200 }));
        expect(screen.queryByText('private-record')).not.toBeInTheDocument();
    });

    it('withholds linked-member money and keeps their nonfinancial household context', async () => {
        const user = userEvent.setup();
        control.held.add(1);
        render(<SettlementBoard {...base} familyMembers={[{ ...members[0], linkedMembers: [2] }, members[1], members[2]]} readOnly={false} />);
        const alice = within(screen.getByRole('region', { name: 'Settlement for Alice' }));
        await user.click(alice.getByText('Alice'));
        await user.click(alice.getByRole('button', { name: /Bob/ }));
        expect(alice.getByText('Bob')).toBeInTheDocument();
        expect(alice.queryByText(/\$/)).not.toBeInTheDocument();
        expect(alice.queryByText('Paid')).not.toBeInTheDocument();
        expect(alice.queryByText('Settled')).not.toBeInTheDocument();
    });

    it('retains the held recorded-refund warning and reversal access without a projected balance claim', async () => {
        const user = userEvent.setup();
        control.held.add(1);
        const onReverse = vi.fn();
        render(<PaymentHistoryDialog {...dialogProps} readOnly={false} onReverse={onReverse}
            payments={[{ id: 'payment', memberId: 1, amount: 100, receivedAt: '2026-01-01', method: 'cash' }]}
            creditAdjustments={[{ id: 'refund', memberId: 1, type: 'refund', status: 'recorded', amount: 'invalid' }]} />);
        expect(screen.queryByText('Remaining Balance')).not.toBeInTheDocument();
        expect(screen.queryByText('Paid')).not.toBeInTheDocument();
        await user.click(screen.getByTitle('Reverse this payment'));
        const confirm = within(screen.getByRole('dialog', { name: 'Reverse Payment — Refund on Record' }));
        expect(confirm.getByText(/This household has a recorded refund/)).toHaveTextContent('Financial data unavailable');
        expect(confirm.queryByText(/Outstanding/)).not.toBeInTheDocument();
        await user.click(confirm.getByRole('button', { name: 'Reverse' }));
        expect(onReverse).toHaveBeenCalledWith('payment');
    });

    it('counts one valid paid, one valid unpaid and one held household without partial aggregate money', () => {
        control.held.add(1); // Legacy metrics would count Alice and Bob as paid.
        mount(<DashboardView />);
        expect(screen.getByText('1 / 3')).toBeInTheDocument();
        expect(screen.getByText('1 household needs correction')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close Year' })).toBeDisabled();
        expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(4);
        expect(screen.queryByText(/% settled/)).not.toBeInTheDocument();
        expect(screen.queryByText('Settlement complete')).not.toBeInTheDocument();
        expect(screen.queryByText(/Everyone is settled/)).not.toBeInTheDocument();
    });

    it('removes an already-open payment entry point when its household becomes held', async () => {
        const user = userEvent.setup();
        const props = { ...base, payments: [], readOnly: false, onRecordPayment: vi.fn() };
        const view = render(<SettlementBoard {...props} />);
        const alice = within(screen.getByRole('region', { name: 'Settlement for Alice' }));
        await user.click(alice.getByText('Alice'));
        await user.click(alice.getByRole('button', { name: 'Record Payment' }));
        control.held.add(1);
        view.rerender(<SettlementBoard {...props} />);
        expect(screen.queryByRole('button', { name: 'Save Payment' })).not.toBeInTheDocument();
        expect(props.onRecordPayment).not.toHaveBeenCalled();
    });

    it('withholds an already-open Charge Notice preview and confirmation after a household hold', async () => {
        const user = userEvent.setup();
        control.state.owedAdjustments = [{ id: 'usage', kind: 'usage_charge', status: 'deferred', memberId: 1, amount: 12, incurredDate: '2026-01-01', description: 'Roaming' }];
        const view = mount(<DashboardView />);
        const alice = within(screen.getByRole('region', { name: 'Settlement for Alice' }));
        await user.click(alice.getByText('Alice'));
        await user.click(alice.getByRole('button', { name: 'Bill Charges' }));
        expect(within(screen.getByRole('dialog', { name: 'Bill Charges' })).getAllByText('$12.00')).toHaveLength(2);
        control.held.add(1);
        view.rerender(<MemoryRouter><ToastProvider><DashboardView /></ToastProvider></MemoryRouter>);
        const dialog = within(screen.getByRole('dialog', { name: 'Bill Charges' }));
        expect(dialog.getByRole('status')).toHaveTextContent('Financial data unavailable');
        expect(dialog.queryByText(/\$/)).not.toBeInTheDocument();
        expect(dialog.queryByRole('button', { name: 'Bill & Notify' })).not.toBeInTheDocument();
        expect(dialog.getByRole('button', { name: 'Close' })).toBeInTheDocument();
        expect(control.state.service.billDeferredCharges).not.toHaveBeenCalled();
        expect(issueChargeNotice).not.toHaveBeenCalled();
        expect(createAndPruneShareLink).not.toHaveBeenCalled();
        expect(queueEmail).not.toHaveBeenCalled();
    });

    it('rechecks a stale Charge Notice confirmation against live availability before billing', async () => {
        const user = userEvent.setup();
        control.state.owedAdjustments = [{ id: 'usage', kind: 'usage_charge', status: 'deferred', memberId: 1, amount: 12 }];
        mount(<DashboardView />);
        const alice = within(screen.getByRole('region', { name: 'Settlement for Alice' }));
        await user.click(alice.getByText('Alice'));
        await user.click(alice.getByRole('button', { name: 'Bill Charges' }));
        control.held.add(1); // Deliberately do not render: exercise the action-time reader.
        await user.click(screen.getByRole('button', { name: 'Bill & Notify' }));
        expect(control.state.service.billDeferredCharges).not.toHaveBeenCalled();
        expect(issueChargeNotice).not.toHaveBeenCalled();
    });

    it('rechecks availability between valid charge billing and invoking the outbound notice writer', async () => {
        const user = userEvent.setup();
        control.state.owedAdjustments = [{ id: 'usage', kind: 'usage_charge', status: 'deferred', memberId: 1, amount: 12 }];
        control.state.service.billDeferredCharges.mockImplementation(() => {
            control.held.add(1);
            return { chargeNoticeId: 'notice', charges: [] };
        });
        mount(<DashboardView />);
        const alice = within(screen.getByRole('region', { name: 'Settlement for Alice' }));
        await user.click(alice.getByText('Alice'));
        await user.click(alice.getByRole('button', { name: 'Bill Charges' }));
        await user.click(screen.getByRole('button', { name: 'Bill & Notify' }));
        expect(control.state.service.billDeferredCharges).toHaveBeenCalledOnce(); // Invoked while valid; never rolled back.
        expect(issueChargeNotice).not.toHaveBeenCalled();
        expect(queueEmail).not.toHaveBeenCalled();
    });

    it('closes a hidden test-email dialog on member changes and clears its previous recipient', async () => {
        const user = userEvent.setup();
        const view = mount(<InvoicingTab />);
        await user.click(screen.getByRole('button', { name: 'Preview' }));
        await user.click(screen.getByRole('button', { name: 'Send test email' }));
        await user.clear(screen.getByLabelText('Send to'));
        await user.type(screen.getByLabelText('Send to'), 'alice-only@example.com');
        control.held.add(1);
        view.rerender(<MemoryRouter><ToastProvider><InvoicingTab /></ToastProvider></MemoryRouter>);
        expect(screen.queryByRole('dialog', { name: 'Send Test Email' })).not.toBeInTheDocument();
        await user.selectOptions(screen.getByRole('combobox', { name: 'Preview member' }), '2');
        expect(screen.queryByRole('dialog', { name: 'Send Test Email' })).not.toBeInTheDocument();
        expect(queueEmail).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Send test email' }));
        expect(screen.getByLabelText('Send to')).toHaveValue('test@example.com');
        expect(queueEmail).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    it.each([
        [EmailInvoiceDialog, 'Send Email'], [TextInvoiceDialog, 'Open Messages'], [ShareLinkDialog, 'Generate & Copy Link']
    ])('blocks an awaited %s continuation after a valid-to-held change', async (Component, action) => {
        const user = userEvent.setup();
        const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
        let finish;
        createAndPruneShareLink.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const view = render(<Component {...dialogProps} />);
        await user.click(screen.getByRole('button', { name: action }));
        expect(createAndPruneShareLink).toHaveBeenCalledTimes(1); // Invoked while valid; no cancellation claim.
        control.held.add(1);
        view.rerender(<Component {...dialogProps} />);
        await act(async () => { finish({ url: 'https://example.com/stale' }); });
        expect(screen.getByRole('status')).toHaveTextContent('Financial data unavailable');
        expect(screen.queryByText('https://example.com/stale')).not.toBeInTheDocument();
        expect(queueEmail).not.toHaveBeenCalled();
        expect(openSmsComposer).not.toHaveBeenCalled();
        expect(copy).not.toHaveBeenCalled();
    });

    it('keeps held link listing and revocation available without a copy entry point', async () => {
        const user = userEvent.setup();
        control.held.add(1);
        getDocs.mockResolvedValueOnce({ docs: [{ id: 'existing', data: () => ({ rawToken: 'existing-token' }) }] });
        render(<ShareLinkDialog {...dialogProps} initialTab="manage" />);
        await screen.findByRole('button', { name: 'Revoke' });
        expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Revoke' }));
        expect(setDoc).toHaveBeenCalledWith('shareTokens/existing', { revoked: true }, { merge: true });
        expect(deleteDoc).toHaveBeenCalledWith('publicShares/existing');
        expect(createAndPruneShareLink).not.toHaveBeenCalled();
    });

    it('withholds a held invoice preview and copy/send entry points but allows selecting a valid sibling', async () => {
        const user = userEvent.setup();
        control.state.settings.invoiceShareUrl = 'https://example.com/existing';
        control.held.add(1);
        mount(<InvoicingTab />);
        await user.click(screen.getByRole('button', { name: 'Preview' }));
        expect(screen.getByRole('status')).toHaveTextContent('Financial data unavailable');
        expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Send test email' })).not.toBeInTheDocument();
        await user.selectOptions(screen.getByRole('combobox', { name: 'Preview member' }), '2');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send test email' })).toBeEnabled();
        expect(queueEmail).not.toHaveBeenCalled();
    });

    it('rechecks a preview-link entry after token hashing before any write or copy', async () => {
        const user = userEvent.setup();
        const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
        let finish;
        control.hashPromise = new Promise(resolve => { finish = resolve; });
        const view = mount(<InvoicingTab />);
        await user.click(screen.getByRole('button', { name: 'Preview' }));
        await user.click(screen.getByRole('button', { name: 'Generate share link' }));
        control.held.add(1);
        view.rerender(<MemoryRouter><ToastProvider><InvoicingTab /></ToastProvider></MemoryRouter>);
        await act(async () => { finish('hashed'); });
        expect(setDoc).not.toHaveBeenCalled();
        expect(copy).not.toHaveBeenCalled();
        expect(queueEmail).not.toHaveBeenCalled();
    });
});
