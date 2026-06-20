import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

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

import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import DashboardView from '@/app/views/Dashboard/DashboardView.jsx';
import { useBillingData } from '@/app/hooks/useBillingData.js';

function renderDashboard(overrides = {}) {
    useBillingData.mockReturnValue({ ...mockState, ...overrides });
    return render(<MemoryRouter><ToastProvider><DashboardView /></ToastProvider></MemoryRouter>);
}

describe('DashboardView', () => {
    it('renders year pill without status badge', () => {
        renderDashboard();
        expect(screen.getByText('Billing Year 2026')).toBeInTheDocument();
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
            payments: [{ memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }]
        });
        expect(screen.getByText('Settlement in progress')).toBeInTheDocument();
    });

    it('shows Ready to Close when settling and all members paid', () => {
        renderDashboard({
            activeYear: { id: '2026', label: '2026', status: 'settling' },
            payments: [
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
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
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
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
            payments: [{ memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }]
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
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' },
                { memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString(), type: 'payment' }
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
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
                { memberId: 2, amount: 668.98, method: 'cash', note: '', date: new Date().toISOString() }
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
                getState: vi.fn(() => ({ settings: {}, owedAdjustments: [
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

        it('an unpaid BILLED charge raises the dashboard Outstanding KPI (ADR 0006)', () => {
            // Both members fully paid on the 1200 bill (600 each); Alice has a $40 unpaid
            // BILLED charge → Outstanding should read $40, not "Paid".
            renderDashboard({
                payments: [
                    { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
                    { memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }
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
                    { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
                    { memberId: 2, amount: 600, method: 'cash', note: '', date: new Date().toISOString() }
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
            { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
            { memberId: 2, amount: 668.98, method: 'cash', note: '', date: new Date().toISOString() }
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
            { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
            { memberId: 2, amount: 668.98, method: 'cash', note: '', date: new Date().toISOString() }
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
                { memberId: 1, amount: 600, method: 'cash', note: '', date: new Date().toISOString() },
                { memberId: 2, amount: 668.98, method: 'cash', note: '', date: new Date().toISOString() }
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
});
