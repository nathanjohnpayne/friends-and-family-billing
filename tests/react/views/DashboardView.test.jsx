import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stub the Charge Notice issuance service so the wiring test does not touch
// Firestore/email — we only assert the dashboard calls the service + issuance.
const mockIssueChargeNotice = vi.fn(async () => ({ tokenHash: 'h', shareUrl: 'u' }));
vi.mock('@/lib/ChargeNoticeService.js', () => ({
    issueChargeNotice: (...args) => mockIssueChargeNotice(...args)
}));

// Mock Firebase (needed by ShareLinkDialog and useDisputes)
vi.mock('@/lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(), setDoc: vi.fn(), getDocs: vi.fn(() => Promise.resolve({ docs: [] })), collection: vi.fn(),
    query: vi.fn(), where: vi.fn(), deleteDoc: vi.fn(), serverTimestamp: vi.fn()
}));
vi.mock('firebase/storage', () => ({
    ref: vi.fn(), deleteObject: vi.fn()
}));

// Mock useBillingData with controllable state
const mockState = {
    activeYear: { id: '2026', label: '2026', status: 'open' },
    familyMembers: [
        { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
        { id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
    ],
    bills: [
        { id: 'b1', name: 'Internet', amount: 1200, billingFrequency: 'annual', members: [1, 2] }
    ],
    payments: [],
    billingEvents: [],
    settings: null,
    loading: false,
    error: null,
    service: { getState: vi.fn(() => ({ settings: {} })), recordPayment: vi.fn(), reversePayment: vi.fn(), setYearStatus: vi.fn(), issueRefund: vi.fn(() => ({ id: 'cadj_1', amount: 68.98, method: 'venmo', reason: 'Overpaid', type: 'refund', status: 'recorded' })) },
    saveQueue: { subscribe: vi.fn(() => () => {}) }
};

vi.mock('@/app/hooks/useBillingData.js', () => ({
    useBillingData: vi.fn(() => mockState)
}));

vi.mock('@/app/contexts/AuthContext.jsx', () => ({
    useAuth: vi.fn(() => ({ user: { uid: 'test-user' } }))
}));

// Refund Notice issuance (#319) — mocked so the dashboard test can assert wiring
// without touching Firestore/email.
const mockIssueRefundNotice = vi.fn(() => Promise.resolve({ noticeId: 'n1', shareUrl: null }));
vi.mock('@/lib/RefundNoticeService.js', () => ({
    issueRefundNotice: (...args) => mockIssueRefundNotice(...args)
}));

// useRefundNotices (#319) — controllable so a test can feed an active not_received
// and assert the ADR-0003 credit re-open. Defaults to empty for every other test.
const refundNoticesMock = vi.hoisted(() => ({
    value: { refundNotices: [], loading: false, error: null, activeNotReceivedCount: 0, reload: () => {}, resolveNotice: () => {} }
}));
vi.mock('@/app/hooks/useRefundNotices.js', () => ({
    useRefundNotices: () => refundNoticesMock.value
}));

import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import DashboardView from '@/app/views/Dashboard/DashboardView.jsx';
import { useBillingData } from '@/app/hooks/useBillingData.js';
import { getDocs } from 'firebase/firestore';
import { CHARGE_NOTICE_KIND } from '@/lib/chargeNotice.js';

function renderDashboard(overrides = {}) {
    useBillingData.mockReturnValue({ ...mockState, ...overrides });
    return render(<MemoryRouter><ToastProvider><DashboardView /></ToastProvider></MemoryRouter>);
}

describe('DashboardView', () => {
    it('titles the hero with the year under a Billing year eyebrow, without a status badge', () => {
        renderDashboard();
        const year = screen.getByRole('heading', { level: 1, name: '2026' });
        expect(year).toHaveAccessibleDescription('Billing year');
        // "Open" appears once in the lifecycle bar only (badge removed)
        const openElements = screen.getAllByText('Open');
        expect(openElements.length).toBe(1);
        expect(screen.getByText('Planning in progress')).toBeInTheDocument();
    });

    it('renders KPI cards without Status card', () => {
        renderDashboard();
        expect(screen.getAllByText('Outstanding').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Settled').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Open Reviews')).toBeInTheDocument();
        expect(screen.getByText('Review requests')).toBeInTheDocument();
        // Open Reviews KPI shows real dispute count
        expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    });

    it('renders lifecycle bar with checkmarks on completed steps', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' }
        });
        // Open is completed — should have checkmark prefix
        expect(screen.getByText(/✓ Open/)).toBeInTheDocument();
        // Settling is active (current) — no checkmark
        expect(screen.getByText('Settling')).toBeInTheDocument();
        expect(screen.getByText('Closed')).toBeInTheDocument();
        expect(screen.getByText('Archived')).toBeInTheDocument();
    });

    it('renders progress bar and settlement message', () => {
        renderDashboard();
        expect(screen.getByText('0% settled')).toBeInTheDocument();
        expect(screen.getByText(/Review totals/)).toBeInTheDocument();
    });

    it('shows empty state when no members', () => {
        renderDashboard({ familyMembers: [] });
        expect(screen.getByText(/Add members and bills/)).toBeInTheDocument();
    });

    it('shows loading state', () => {
        renderDashboard({ loading: true });
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('shows settling status with progress', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [{ id: 'source-1', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }]
        });
        expect(screen.getByText('Settlement in progress')).toBeInTheDocument();
    });

    it('shows Ready to Close when settling and all members paid', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [
                { id: 'source-2', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { id: 'source-3', memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
            ]
        });
        expect(screen.getByText('Settlement complete')).toBeInTheDocument();
    });

    // Lifecycle action button tests

    it('shows Start Settlement button when status is open', () => {
        renderDashboard();
        expect(screen.getByRole('button', { name: 'Start Settlement' })).toBeInTheDocument();
    });

    it('shows Close Year button with ready hint when ready to close', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [
                { id: 'source-4', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { id: 'source-5', memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
            ]
        });
        const btn = screen.getByRole('button', { name: 'Close Year' });
        expect(btn).toBeInTheDocument();
        expect(btn).not.toBeDisabled();
        expect(screen.getByText(/All members settled/)).toBeInTheDocument();
    });

    it('shows disabled Close Year button with hint when settling but not ready', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [{ id: 'source-6', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }]
        });
        const btn = screen.getByRole('button', { name: 'Close Year' });
        expect(btn).toBeDisabled();
        expect(screen.getByText('1 member still outstanding')).toBeInTheDocument();
    });

    it('shows Archive Year button when status is closed', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'closed' }
        });
        expect(screen.getByRole('button', { name: 'Archive Year' })).toBeInTheDocument();
    });

    it('shows no action button when status is archived', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'archived' }
        });
        expect(screen.queryByRole('button', { name: 'Start Settlement' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Close Year' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Archive Year' })).not.toBeInTheDocument();
    });

    it('shows corrected headline when open and 100% settled', () => {
        renderDashboard({
            payments: [
                { id: 'source-7', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { id: 'source-8', memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
            ]
        });
        expect(screen.getByText('Ready to start settlement')).toBeInTheDocument();
        expect(screen.queryByText('Planning in progress')).not.toBeInTheDocument();
    });

    // ──────────────── Owed to Members KPI (#316) ────────────────

    it('renders an "Owed to Members" KPI card distinct from Outstanding', () => {
        renderDashboard();
        // Scope to the KPI cards so the test verifies the dashboard KPI path,
        // not the same labels elsewhere on the page ("Outstanding" also appears
        // as settlement-board status badges).
        const owedCard = screen.getByText('Owed to Members').closest('.kpi-card');
        const outstandingCard = screen.getAllByText('Outstanding')
            .map(el => el.closest('.kpi-card'))
            .find(Boolean);
        expect(owedCard).not.toBeNull();
        expect(outstandingCard).not.toBeNull();
        expect(owedCard).not.toBe(outstandingCard);
    });

    it('"Owed to Members" KPI reflects the sum of unresolved household credits', () => {
        // Annual bill 1200 split two ways → 600 owed each. Bob overpays to 668.98 → 68.98 credit.
        renderDashboard({
            payments: [
                { id: 'source-9', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
                { id: 'source-10', memberId: 2, amount: 668.98, method: 'cash', note: '', date: new Date().toISOString() }
            ]
        });
        // Scope to the KPI card so the assertion verifies the dashboard KPI path,
        // not the same credit mirrored on Bob's settlement-board card.
        const owedCard = screen.getByText('Owed to Members').closest('.kpi-card');
        expect(owedCard).not.toBeNull();
        expect(within(owedCard).getByText('$68.98')).toBeInTheDocument();
    });

    // ──────────── Bill Charges → Charge Notice wiring (#320) ────────────
    describe('Bill Charges (Charge Notice)', () => {
        function renderWithDeferred() {
            const billDeferredCharges = vi.fn(() => ({
                chargeNoticeId: 'cn_1',
                memberId: 2,
                amount: 12.5,
                chargeIds: ['o1'],
                charges: [{ id: 'o1', description: 'Roaming', amount: 12.5, incurredDate: '2026-06-03' }]
            }));
            const service = {
                // getState reflects the POST-billDeferredCharges state: o1 is now 'billed'
                // (the real service flips it synchronously). The handler must read THIS fresh
                // state, not the stale 'deferred' prop, when minting the Charge Notice link.
                getState: vi.fn(() => ({ activeYear: mockState.activeYear, familyMembers: mockState.familyMembers,
                    bills: mockState.bills, payments: mockState.payments, creditAdjustments: [], settings: {}, owedAdjustments: [
                    { id: 'o1', memberId: 2, kind: 'usage_charge', amount: 12.5, status: 'billed', description: 'Roaming', incurredDate: '2026-06-03' }
                ] })),
                recordPayment: vi.fn(), reversePayment: vi.fn(), setYearStatus: vi.fn(),
                billDeferredCharges
            };
            const owedAdjustments = [
                { id: 'o1', memberId: 2, kind: 'usage_charge', amount: 12.5, status: 'deferred', description: 'Roaming', incurredDate: '2026-06-03' }
            ];
            renderDashboard({ owedAdjustments, service });
            return { service, billDeferredCharges };
        }

        it('opens the Charge Notice preview from the board Bill Charges action', () => {
            renderWithDeferred();
            // Expand Bob's card and click Bill Charges
            fireEvent.click(screen.getByText('Bob').closest('.settlement-card-main'));
            fireEvent.click(screen.getByText('Bill Charges'));
            // The preview dialog opens
            expect(screen.getByText('Bill & Notify')).toBeInTheDocument();
            expect(screen.getByText('Roaming')).toBeInTheDocument();
        });

        it('confirming bills the charges and fires the Charge Notice issuance', () => {
            const { billDeferredCharges } = renderWithDeferred();
            fireEvent.click(screen.getByText('Bob').closest('.settlement-card-main'));
            fireEvent.click(screen.getByText('Bill Charges'));
            fireEvent.click(screen.getByText('Bill & Notify'));

            expect(billDeferredCharges).toHaveBeenCalledTimes(1);
            const arg = billDeferredCharges.mock.calls[0][0];
            expect(arg.memberId).toBe(2);
            expect(arg.chargeIds).toEqual(['o1']);
            // The outbound Charge Notice (email + share link) is issued with the result.
            expect(mockIssueChargeNotice).toHaveBeenCalledTimes(1);
            // P1.2: it receives the POST-mutation owedAdjustments (o1 now 'billed'), not the
            // stale 'deferred' prop — so the minted share link never shows the just-billed
            // charge as pending/not-yet-due.
            const noticeArg = mockIssueChargeNotice.mock.calls[0][0];
            expect(noticeArg.owedAdjustments).toEqual([
                expect.objectContaining({ id: 'o1', status: 'billed' })
            ]);
        });

        it('uses one complete fresh post-billing source and identity for Notice issuance', async () => {
            const user = userEvent.setup();
            const { service, billDeferredCharges } = renderWithDeferred();
            const fresh = { activeYear: { id: '2026', label: 'Fresh label' }, settings: { emailSubject: 'Fresh settings' },
                familyMembers: mockState.familyMembers.map(row => row.id === 2 ? { ...row, name: 'Fresh Bob', email: 'fresh@example.com' } : row),
                bills: [{ ...mockState.bills[0], amount: 1400 }],
                payments: [{ id: 'fresh-payment', memberId: 2, amount: 1 }],
                creditAdjustments: [{ id: 'fresh-refund', memberId: 2, amount: .5, type: 'refund', status: 'recorded' }],
                owedAdjustments: [{ id: 'o1', memberId: 2, kind: 'usage_charge', status: 'billed', amount: 12.5 }] };
            const originalBill = billDeferredCharges.getMockImplementation();
            billDeferredCharges.mockImplementation(args => {
                service.getState.mockReturnValue(fresh);
                service.getState.mockClear();
                return originalBill(args);
            });
            let snapshotReadsAtIssuance;
            mockIssueChargeNotice.mockImplementationOnce(() => {
                snapshotReadsAtIssuance = service.getState.mock.calls.length;
                return Promise.resolve({ emailError: null });
            });
            await user.click(screen.getByText('Bob').closest('.settlement-card-main'));
            await user.click(screen.getByText('Bill Charges'));
            await user.click(screen.getByText('Bill & Notify'));
            expect(snapshotReadsAtIssuance).toBe(1);
            const opts = mockIssueChargeNotice.mock.calls[0][0];
            for (const field of ['familyMembers', 'bills', 'payments', 'creditAdjustments', 'owedAdjustments', 'activeYear', 'settings']) {
                expect(opts[field]).toBe(fresh[field]);
            }
            expect(opts).toMatchObject({ memberName: 'Fresh Bob', memberEmail: 'fresh@example.com', yearLabel: 'Fresh label' });
            expect(opts).not.toHaveProperty('getState');
            expect(opts).not.toHaveProperty('getAvailability');
        });

        async function billAndNotify() {
            const user = userEvent.setup();
            renderWithDeferred();
            await user.click(screen.getByText('Bob').closest('.settlement-card-main'));
            await user.click(screen.getByText('Bill Charges'));
            await user.click(screen.getByText('Bill & Notify'));
        }

        it('confirms the Charge Notice was sent when the member email went out', async () => {
            mockIssueChargeNotice.mockResolvedValueOnce({ tokenHash: 'h', shareUrl: 'u', emailError: null });
            await billAndNotify();
            expect(await screen.findByText('Charges billed—Charge Notice sent.')).toBeInTheDocument();
        });

        it('reports a failed Charge Notice email instead of claiming it was sent', async () => {
            mockIssueChargeNotice.mockResolvedValueOnce({ tokenHash: 'h', shareUrl: 'u', emailError: 'Verify your account email address' });
            await billAndNotify();
            expect(await screen.findByText(/Charge Notice recorded, but the email to the member could not be sent: Verify your account email address/)).toBeInTheDocument();
            expect(screen.queryByText('Charges billed—Charge Notice sent.')).toBeNull();
        });

        it('an unpaid BILLED charge raises the dashboard Outstanding KPI (ADR 0006)', () => {
            // Both members fully paid on the 1200 bill (600 each); Alice has a $40 unpaid
            // BILLED charge → Outstanding should read $40, not "Paid".
            renderDashboard({
                payments: [
                    { id: 'source-11', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
                    { id: 'source-12', memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }
                ],
                owedAdjustments: [
                    { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'billed', description: 'Roaming', incurredDate: '2026-06-03' }
                ]
            });
            const outstandingCard = screen.getAllByText('Outstanding')
                .map(el => el.closest('.kpi-card')).find(Boolean);
            expect(within(outstandingCard).getByText('$40.00')).toBeInTheDocument();
        });

        it('bills a linked member deferred charge through the full wiring (ADR 0001)', () => {
            // Alice (primary) links Carol; only Carol has a deferred charge. Billing the
            // household must reach Carol's charge — the dialog previews it and the
            // confirm passes its real id to billDeferredCharges keyed to the primary.
            const billDeferredCharges = vi.fn(() => ({
                chargeNoticeId: 'cn_1', memberId: 1, amount: 9, chargeIds: ['c1'],
                charges: [{ id: 'c1', description: 'Carol roaming', amount: 9, incurredDate: '2026-06-04' }]
            }));
            const service = {
                getState: vi.fn(() => ({ settings: {} })),
                recordPayment: vi.fn(), reversePayment: vi.fn(), setYearStatus: vi.fn(),
                billDeferredCharges
            };
            renderDashboard({
                familyMembers: [
                    { id: 1, name: 'Alice', email: 'a@x.com', phone: '', avatar: '', linkedMembers: [3], paymentReceived: 0 },
                    { id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
                    { id: 3, name: 'Carol', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
                ],
                owedAdjustments: [
                    { id: 'c1', memberId: 3, kind: 'usage_charge', amount: 9, status: 'deferred', description: 'Carol roaming', incurredDate: '2026-06-04' }
                ],
                service
            });
            // Alice's household card carries the Bill Charges action (household-grain).
            fireEvent.click(screen.getByText('Alice').closest('.settlement-card-main'));
            fireEvent.click(screen.getByText('Bill Charges'));
            expect(screen.getByText('Carol roaming')).toBeInTheDocument(); // previewed in the dialog
            fireEvent.click(screen.getByText('Bill & Notify'));
            const arg = billDeferredCharges.mock.calls[0][0];
            expect(arg.memberId).toBe(1);          // keyed to the primary
            expect(arg.chargeIds).toEqual(['c1']);  // the linked member's charge
        });

        it('a DEFERRED charge does NOT raise the dashboard Outstanding KPI', () => {
            renderDashboard({
                payments: [
                    { id: 'source-13', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
                    { id: 'source-14', memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }
                ],
                owedAdjustments: [
                    { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 40, status: 'deferred', description: 'Roaming', incurredDate: '2026-06-03' }
                ]
            });
            const outstandingCard = screen.getAllByText('Outstanding')
                .map(el => el.closest('.kpi-card')).find(Boolean);
            expect(within(outstandingCard).getByText('Paid')).toBeInTheDocument();
        });
    });

    it('re-opens a not-received refund into the "Owed to Members" KPI while the year is open (#319, ADR 0003)', () => {
        // Bob overpaid (668.98 of 600) and the 68.98 refund was recorded — the credit
        // is optimistically disposed, so with no member response nothing is owed.
        const payments = [
            { id: 'source-15', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
            { id: 'source-16', memberId: 2, amount: 668.98, method: 'cash', note: '', date: new Date().toISOString() }
        ];
        const creditAdjustments = [{ id: 'cadj_1', memberId: 2, type: 'refund', amount: 68.98, status: 'recorded' }];

        refundNoticesMock.value = { ...refundNoticesMock.value, refundNotices: [] };
        const { unmount } = renderDashboard({ payments, creditAdjustments });
        expect(within(screen.getByText('Owed to Members').closest('.kpi-card')).getByText('None')).toBeInTheDocument();
        unmount();

        // Bob reports the refund never arrived → the active not_received re-opens the
        // credit, so the KPI shows the amount owed again (ADR 0003).
        refundNoticesMock.value = {
            ...refundNoticesMock.value,
            refundNotices: [{ id: 'n1', kind: 'refund_notice', memberId: 2, confirmation: 'not_received', creditAdjustmentId: 'cadj_1' }]
        };
        renderDashboard({ payments, creditAdjustments });
        expect(within(screen.getByText('Owed to Members').closest('.kpi-card')).getByText('$68.98')).toBeInTheDocument();

        refundNoticesMock.value = { ...refundNoticesMock.value, refundNotices: [] };
    });

    it('does NOT re-open a not-received refund on a read-only (closed) year (ADR 0007)', () => {
        // Same disposed refund, but the year is closed — a not_received arriving after
        // close is corrected forward and never reanimates the frozen credit.
        const payments = [
            { id: 'source-17', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
            { id: 'source-18', memberId: 2, amount: 668.98, method: 'cash', note: '', date: new Date().toISOString() }
        ];
        const creditAdjustments = [{ id: 'cadj_1', memberId: 2, type: 'refund', amount: 68.98, status: 'recorded' }];
        refundNoticesMock.value = {
            ...refundNoticesMock.value,
            refundNotices: [{ id: 'n1', kind: 'refund_notice', memberId: 2, confirmation: 'not_received', creditAdjustmentId: 'cadj_1' }]
        };
        renderDashboard({ activeYear: { id: '2026', label: '2026', status: 'closed' }, payments, creditAdjustments });
        expect(within(screen.getByText('Owed to Members').closest('.kpi-card')).getByText('None')).toBeInTheDocument();

        refundNoticesMock.value = { ...refundNoticesMock.value, refundNotices: [] };
    });

    // ──────────────── Refund Notice issuance (#319) ────────────────

    it('issuing a refund records the creditAdjustment AND fires a Refund Notice keyed to it', () => {
        mockIssueRefundNotice.mockClear();
        // Bob (id 2) overpays → household carries a 68.98 credit, so "Issue Refund" appears.
        renderDashboard({
            payments: [
                { id: 'source-19', memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
                { id: 'source-20', memberId: 2, amount: 668.98, method: 'cash', note: '', date: new Date().toISOString() }
            ]
        });

        // Expand Bob's settlement-board card to reveal its actions, then open the
        // refund dialog. Bob (id 2) holds the household credit, so the card shows
        // "Issue Refund". Scope to Bob's card so the right one expands.
        const bobCard = screen.getByText('Bob').closest('.settlement-card');
        fireEvent.click(within(bobCard).getByText('Details ▼'));
        const issueBtn = within(bobCard).getByRole('button', { name: 'Issue Refund' });
        fireEvent.click(issueBtn);

        // Fill a valid reason and submit (amount is prefilled to the credit).
        fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Returned overpayment' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Refund' }));

        // The Refund Notice is sent with the creditAdjustment id from issueRefund.
        expect(mockIssueRefundNotice).toHaveBeenCalledTimes(1);
        const args = mockIssueRefundNotice.mock.calls[0][0];
        expect(args.creditAdjustmentId).toBe('cadj_1');
        expect(args.memberId).toBe(2);
        expect(args.billingYearId).toBe('2026');
        expect(args.userId).toBe('test-user');
    });

    // ── Deferred charges indicator (#322) ─────────────────────────────────
    it('shows a "Deferred charges" indicator when a household carries deferred usage charges', () => {
        renderDashboard({
            owedAdjustments: [
                { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 42.5, status: 'deferred' }
            ]
        });
        const indicator = screen.getByTestId('deferred-charges-indicator');
        expect(indicator).toBeInTheDocument();
        expect(indicator).toHaveTextContent(/deferred charges/i);
        expect(indicator).toHaveTextContent('$42.50');
    });

    it('does not show the "Deferred charges" indicator when there are none', () => {
        renderDashboard({ owedAdjustments: [] });
        expect(screen.queryByTestId('deferred-charges-indicator')).toBeNull();
    });

    it('excludes already-carried and voided charges from the deferred indicator', () => {
        renderDashboard({
            owedAdjustments: [
                { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'carried_forward' },
                { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 20, status: 'voided' }
            ]
        });
        expect(screen.queryByTestId('deferred-charges-indicator')).toBeNull();
    });

    it('passes its Review Requests into the board: Open review chip and card badge (RD-03)', async () => {
        // useDisputes reads the disputes subcollection; a Refund Notice and a Charge
        // Notice ride the same collection but are not Review Requests.
        const doc = (id, data) => ({ id, data: () => ({ ...data }) });
        vi.mocked(getDocs).mockResolvedValueOnce({
            docs: [
                doc('d1', { memberId: 1, status: 'open' }),
                doc('n1', { memberId: 2, kind: 'refund_notice', status: 'open' }),
                doc('n2', { memberId: 2, kind: CHARGE_NOTICE_KIND, status: 'open' })
            ]
        });
        renderDashboard();
        expect(await screen.findByRole('button', { name: 'Open review 1' })).toBeInTheDocument();
        const alice = screen.getByText('Alice').closest('.settlement-card');
        expect(within(alice).getByText('Review request')).toBeInTheDocument();
        const bob = screen.getByText('Bob').closest('.settlement-card');
        expect(within(bob).queryByText('Review request')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Open review 1' }));
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.queryByText('Bob')).toBeNull();
    });
});


describe('Dashboard aggregate integrity', () => {
    it('withholds unsafe year totals without claiming valid households need correction', async () => {
        const user = userEvent.setup();
        renderDashboard({ activeYear: { id: '2026', label: '2026', status: 'settling' }, bills: [],
            payments: [{ id: 'large-a', memberId: 1, amount: 60000000000000 },
                { id: 'large-b', memberId: 2, amount: 60000000000000 }] });
        expect(screen.getByText('2 / 2')).toBeInTheDocument();
        expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(3);
        expect(screen.queryByText(/households? needs? correction/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close Year' })).toBeDisabled();
        const alice = within(screen.getByRole('region', { name: 'Settlement for Alice' }));
        await user.click(alice.getByText('Alice'));
        expect(alice.getByRole('button', { name: 'Issue Refund' })).toBeInTheDocument();
        expect(alice.queryByText('Financial data unavailable')).not.toBeInTheDocument();
    });
});


describe('deferred display integrity counts', () => {
    it('counts later households after an earlier Annual display overflow and preserves valid sibling actions', async () => {
        const user = userEvent.setup();
        renderDashboard({ bills: [{ id: 'big', name: 'Large', amount: 60000000000000, billingFrequency: 'annual', members: [1] }],
            payments: [], owedAdjustments: [
                { id: 'opening', memberId: 1, kind: 'carry_opening', status: 'carried_in', amount: 60000000000000 },
                { id: 'credit', memberId: 1, kind: 'service_credit', status: 'active', amount: 60000000000000 },
                { id: 'a', memberId: 1, kind: 'usage_charge', status: 'deferred', amount: .01 },
                { id: 'b', memberId: 2, kind: 'usage_charge', status: 'deferred', amount: .02 }
            ] });
        expect(screen.getByTestId('deferred-charges-indicator')).toHaveTextContent('Unavailable (2 charges)');
        const bob = within(screen.getByRole('region', { name: 'Settlement for Bob' }));
        await user.click(bob.getByText('Bob'));
        expect(bob.getByRole('button', { name: 'Bill Charges' })).toBeEnabled();
    });
});

// ── Year-End Review prompt card (#610) ────────────────────────────────────
describe('DashboardView Year-End Review prompt', () => {
    const PROMPT = 'year-end-review-prompt';
    function renderAt(today, overrides = {}) {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(today + 'T12:00:00'));
        return renderDashboard(overrides);
    }
    afterEach(() => { vi.useRealTimers(); });

    it('is shown on 2026-11-01 for an open 2026 with no 2027', () => {
        renderAt('2026-11-01');
        const card = screen.getByTestId(PROMPT);
        expect(within(card).getByText('Ready for 2027? Review 2026 first.')).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: 'Review & start 2027' })).toBeInTheDocument();
        expect(card).toHaveTextContent('set 2027’s prices—then start 2027');
        expect(card.textContent).not.toContain('\\u');
    });

    it('is hidden on 2026-10-31 for an open year with no successor', () => {
        renderAt('2026-10-31');
        expect(screen.queryByTestId(PROMPT)).toBeNull();
    });

    it('is shown for a settling year from November 1 and in any later year', () => {
        renderAt('2027-03-15', { activeYear: { id: '2026', label: '2026', status: 'settling' } });
        expect(screen.getByTestId(PROMPT)).toBeInTheDocument();
    });

    it('is hidden for a settling year before November 1', () => {
        renderAt('2026-06-15', { activeYear: { id: '2026', label: '2026', status: 'settling' } });
        expect(screen.queryByTestId(PROMPT)).toBeNull();
    });

    it('is shown for a Closed year in any month', () => {
        renderAt('2026-03-02', { activeYear: { id: '2026', label: '2026', status: 'closed' } });
        expect(screen.getByTestId(PROMPT)).toBeInTheDocument();
    });

    it('is hidden once a successor exists by event or by a higher label, whatever the status or date', () => {
        for (const status of ['open', 'settling', 'closed']) {
            const activeYear = { id: '2026', label: '2026', status };
            const byLabel = renderAt('2026-12-01', { activeYear, billingYears: [activeYear, { id: '2027', label: '2027', status: 'open' }] });
            expect(screen.queryByTestId(PROMPT)).toBeNull();
            byLabel.unmount();
            const byEvent = renderAt('2026-12-01', { activeYear, billingYears: [activeYear], billingEvents: [{ eventType: 'YEAR_ROLLED_OVER', payload: { nextYearLabel: '2027' } }] });
            expect(screen.queryByTestId(PROMPT)).toBeNull();
            byEvent.unmount();
        }
    });

    it('is never shown for an archived year', () => {
        renderAt('2026-12-01', { activeYear: { id: '2026', label: '2026', status: 'archived' } });
        expect(screen.queryByTestId(PROMPT)).toBeNull();
    });

    it('uses the Closed trigger only for a label that is not four digits', () => {
        const open = renderAt('2030-12-01', { activeYear: { id: 'y', label: '2026-27', status: 'open' } });
        expect(screen.queryByTestId(PROMPT)).toBeNull();
        open.unmount();
        renderAt('2026-01-01', { activeYear: { id: 'y', label: '2026-27', status: 'closed' } });
        expect(screen.getByTestId(PROMPT)).toBeInTheDocument();
    });

    it('is a pure link: the button only navigates to /year-end-review and writes nothing', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-05T12:00:00'));
        const setYearStatus = vi.fn();
        useBillingData.mockReturnValue({ ...mockState, service: { ...mockState.service, setYearStatus } });
        render(
            <MemoryRouter initialEntries={['/']}>
                <ToastProvider>
                    <Routes>
                        <Route path="/" element={<DashboardView />} />
                        <Route path="/year-end-review" element={<p>review page</p>} />
                    </Routes>
                </ToastProvider>
            </MemoryRouter>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Review & start 2027' }));
        expect(screen.getByText('review page')).toBeInTheDocument();
        expect(setYearStatus).not.toHaveBeenCalled();
    });

    it('says the review lists deferred charges only while the card shows', () => {
        const owedAdjustments = [{ id: 'o1', memberId: 1, kind: 'usage_charge', amount: 42.5, status: 'deferred' }];
        const shown = renderAt('2026-11-02', { owedAdjustments });
        expect(screen.getByTestId('deferred-charges-indicator')).toHaveTextContent('the review lists them');
        shown.unmount();
        renderAt('2026-05-02', { owedAdjustments });
        expect(screen.getByTestId('deferred-charges-indicator')).not.toHaveTextContent('the review lists them');
    });
});

// After a reload: the unsaved changes a stale tab kept on this device (#669, RD-34).
describe('DashboardView — unsaved changes from a stale tab', () => {
    const KEY = 'ffb.unsaved.v1.test-user.2026';
    const record = {
        version: 1, uid: 'test-user', yearId: '2026', yearLabel: '2026', reason: 'stale',
        detectedAt: '2026-11-10T15:12:00', baselineAt: '2026-11-10T15:09:00', baselineKind: 'saved',
        changes: [
            { kind: 'event', label: 'Payment recorded', detail: 'Alice', amount: 50, at: '2026-11-10T15:10:00' },
            { kind: 'member', label: 'Member added', detail: 'Priya Natarajan', amount: null, at: null }
        ],
        payload: { label: '2026' }
    };
    afterEach(() => { window.localStorage.clear(); });

    it('shows the kept list after a reload until it is dismissed', async () => {
        window.localStorage.setItem(KEY, JSON.stringify(record));
        renderDashboard();
        const notice = screen.getByRole('region', { name: 'Unsaved changes in 2026' });
        expect(notice).toHaveTextContent(/You had unsaved changes from (Nov 10, )?3:12\s?pm/);
        const items = within(within(notice).getByRole('list', { name: 'Unsaved changes' })).getAllByRole('listitem');
        expect(items.map(i => i.textContent)).toEqual([
            expect.stringContaining('Payment recorded · Alice'),
            expect.stringContaining('Member added · Priya Natarajan')
        ]);
        await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }));
        expect(screen.queryByRole('region', { name: 'Unsaved changes in 2026' })).toBeNull();
        expect(window.localStorage.getItem(KEY)).toBeNull();
    });

    it('copies the details from the notice', async () => {
        window.localStorage.setItem(KEY, JSON.stringify(record));
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        try {
            renderDashboard();
            await userEvent.click(within(screen.getByRole('region', { name: 'Unsaved changes in 2026' })).getByRole('button', { name: 'Copy details' }));
            expect(writeText.mock.calls[0][0]).toContain('- Member added: Priya Natarajan');
            expect(screen.getByText('Details copied.')).toBeInTheDocument();
        } finally {
            delete navigator.clipboard;
        }
    });

    it('shows nothing when no record is kept, or while this tab is itself read-only', () => {
        const first = renderDashboard();
        expect(screen.queryByRole('region', { name: /Unsaved changes in/ })).toBeNull();
        first.unmount();
        window.localStorage.setItem(KEY, JSON.stringify(record));
        renderDashboard({ writeBlock: { ...record, keptOnDevice: true } });
        expect(screen.queryByRole('region', { name: /Unsaved changes in/ })).toBeNull();
    });

    it('works when storage is unavailable', () => {
        window.localStorage.setItem(KEY, JSON.stringify(record));
        const spy = vi.spyOn(Storage.prototype, 'key').mockImplementation(() => { throw new Error('denied'); });
        try {
            renderDashboard();
            expect(screen.queryByRole('region', { name: /Unsaved changes in/ })).toBeNull();
            expect(screen.getByRole('heading', { level: 1, name: '2026' })).toBeInTheDocument();
        } finally {
            spy.mockRestore();
        }
    });
});
