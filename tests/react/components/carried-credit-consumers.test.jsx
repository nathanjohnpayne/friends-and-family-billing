// #688 (owner decision on #617, 2026-11-11): a credit carried in from a prior year
// counts as money in the year it arrives. One named test per consumer of
// getHouseholdFinancials, over one fixture household: Bob, $60.00 of bills and a
// $132.00 credit carried in from 2026, so $72.00 of it is unused.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettlementBoard from '@/app/components/SettlementBoard.jsx';
import PaymentHistoryDialog from '@/app/components/PaymentHistoryDialog.jsx';
import { calculateAnnualSummary, calculateSettlementMetrics, getHouseholdFinancials } from '@/lib/calculations.js';
import { calculateOutstandingBalance, buildCarryForwardSummary } from '@/lib/billing-year.js';
import { projectHouseholdDisplay } from '@/lib/financial-display.js';
import { getHouseholdFinancialAvailability, getYearFinancialAvailability } from '@/lib/financial-availability.js';
import { buildHouseholdPreview, computeSourceFingerprint, computePayloadFingerprint } from '@/lib/year-end-review.js';

const members = [{ id: 2, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }];
const bills = [{ id: 101, name: 'Internet', amount: 60, billingFrequency: 'annual', members: [2] }];
const seed = { id: 'coadj_2026_2', memberId: 2, kind: 'carry_opening', status: 'carried_in', fromYear: '2026', amount: -132 };
const billed = amount => ({ id: 'billed', memberId: 2, kind: 'usage_charge', status: 'billed', amount, description: 'Roaming' });
const refund = (amount, id = 'refund-1') => ({ id, memberId: 2, type: 'refund', amount, status: 'recorded' });
const sourceOf = (overrides = {}) => ({ familyMembers: members, bills, payments: [], creditAdjustments: [], owedAdjustments: [seed], ...overrides });
const financials = (overrides, options) => getHouseholdFinancials(members[0], sourceOf(overrides), options);
const board = (overrides = {}, props = {}) => {
    const source = sourceOf(overrides);
    return render(<SettlementBoard familyMembers={source.familyMembers} bills={source.bills} payments={source.payments}
        creditAdjustments={source.creditAdjustments} owedAdjustments={source.owedAdjustments} readOnly={false}
        onIssueRefund={() => {}} onRecordPayment={() => {}} {...props} />);
};
const expandBob = () => fireEvent.click(screen.getByText('Bob').closest('.settlement-card-main'));
const statusOnBoard = label => screen.queryAllByText(label).filter(node => !node.closest('.settlement-filters'));

describe('Settlement board (#688)', () => {
    it('reads the household as in Credit by the unused carried-in credit and offers Issue Refund for it', () => {
        board();
        expect(statusOnBoard('Credit').length).toBeGreaterThan(0);
        expect(statusOnBoard('Outstanding')).toHaveLength(0);
        expandBob();
        fireEvent.click(screen.getByText('Issue Refund'));
        expect(screen.getByLabelText(/Refund amount/).value).toBe('72.00');
    });

    it('reads Settled, with no Issue Refund, once the unused credit has been refunded', () => {
        board({ creditAdjustments: [refund(72)] });
        expect(statusOnBoard('Settled').length).toBeGreaterThan(0);
        expect(statusOnBoard('Credit')).toHaveLength(0);
        expandBob();
        expect(screen.queryByText('Issue Refund')).toBeNull();
    });

    it('lets the leftover carried credit pay a billed Usage Charge: fixture 10h reads Credit $22.00, not Outstanding $50.00', () => {
        board({ owedAdjustments: [seed, billed(50)] });
        expect(statusOnBoard('Outstanding')).toHaveLength(0);
        expandBob();
        fireEvent.click(screen.getByText('Issue Refund'));
        expect(screen.getByLabelText(/Refund amount/).value).toBe('22.00');
    });

    it('keeps the part of a billed charge the leftover cannot cover Outstanding', () => {
        board({ owedAdjustments: [seed, billed(100)] });
        expect(statusOnBoard('Outstanding').length).toBeGreaterThan(0);
        expect(financials({ owedAdjustments: [seed, billed(100)] }).cents).toMatchObject({ balance: 2800, credit: 0 });
    });
});

describe('Record Refund cap (#688)', () => {
    it('caps the board dialog at a Credit that includes the unused carried-in credit', async () => {
        const user = userEvent.setup();
        const onIssueRefund = vi.fn();
        board({}, { onIssueRefund });
        await user.click(screen.getByText('Bob'));
        await user.click(screen.getByText('Issue Refund'));
        await user.type(screen.getByLabelText(/Reason/), 'Unused 2026 credit');
        await user.clear(screen.getByRole('spinbutton'));
        await user.type(screen.getByRole('spinbutton'), '72.01');
        await user.click(screen.getByText('Save Refund'));
        // The field itself is bounded by the Credit, so an over-cap amount never submits.
        expect(screen.getByRole('spinbutton')).toHaveAttribute('max', '72.00');
        expect(screen.getByRole('spinbutton')).toBeInvalid();
        expect(onIssueRefund).not.toHaveBeenCalled();
        expect(screen.getByText('Save Refund')).toBeInTheDocument();
        await user.clear(screen.getByRole('spinbutton'));
        await user.type(screen.getByRole('spinbutton'), '72.00');
        await user.click(screen.getByText('Save Refund'));
        expect(onIssueRefund).toHaveBeenCalledWith(expect.objectContaining({ memberId: 2, amount: 72, reason: 'Unused 2026 credit' }));
    });

    it('a recorded refund of the whole Credit leaves the household Settled, never Outstanding', () => {
        expect(financials().cents).toMatchObject({ owed: 0, N: 0, U: 7200, balance: -7200, credit: 7200 });
        expect(financials({ creditAdjustments: [refund(72)] }).cents).toMatchObject({ owed: 0, N: -7200, contributed: 6000, charges: 6000, balance: 0, credit: 0 });
        expect(financials({ creditAdjustments: [refund(72.01)] }).cents).toMatchObject({ balance: 1, credit: 0 });
    });

    it('re-opens the refunded carried credit while a not_received report is active, and only on the board context', () => {
        const refunded = { creditAdjustments: [refund(72)] };
        // The board passes the re-opened set (ADR 0003): the $72.00 is owed back again.
        expect(financials(refunded, { reopenedAdjustmentIds: new Set(['refund-1']) }).cents).toMatchObject({ balance: -7200, credit: 7200 });
        board(refunded, { reopenedAdjustmentIds: new Set(['refund-1']) });
        expect(statusOnBoard('Credit').length).toBeGreaterThan(0);
        // The service cap and the carry read with null re-opening: nothing left to refund twice.
        expect(financials(refunded, { reopenedAdjustmentIds: null }).cents).toMatchObject({ balance: 0, credit: 0 });
        const carry = buildCarryForwardSummary(members, bills, [], refunded.creditAdjustments, [seed],
            { fromYearLabel: '2027', nextYearLabel: '2028', reopenedAdjustmentIds: new Set(['refund-1']) });
        expect(carry).toMatchObject({ ok: true, memberCount: 0, carriedCreditRecords: [] });
    });
});

describe('close gate (#688)', () => {
    it('does not block on an unused carried-in credit, nor on a billed charge it covers', () => {
        const outstanding = overrides => {
            const s = sourceOf(overrides);
            return calculateOutstandingBalance(s.familyMembers, s.bills, s.payments, s.creditAdjustments, s.owedAdjustments);
        };
        expect(outstanding()).toBe(0);
        expect(outstanding({ owedAdjustments: [seed, billed(50)] })).toBe(0);
        expect(outstanding({ creditAdjustments: [refund(72)] })).toBe(0);
        // What the credit cannot cover still blocks: $60 + $100 − $132 = $28.
        expect(outstanding({ owedAdjustments: [seed, billed(100)] })).toBe(28);
    });
});

describe('Dashboard metrics (#688)', () => {
    it('counts the unused carried-in credit in Owed to Members, with no Outstanding and the household settled', () => {
        const metrics = overrides => {
            const s = sourceOf(overrides);
            return calculateSettlementMetrics(s.familyMembers, s.bills, s.payments, s.creditAdjustments, null, s.owedAdjustments);
        };
        expect(metrics()).toMatchObject({ ok: true, totalAnnual: 0, totalPayments: 0, totalOutstanding: 0, totalCreditsOwed: 72, paidCount: 1 });
        expect(metrics({ creditAdjustments: [refund(72)] })).toMatchObject({ totalOutstanding: 0, totalCreditsOwed: 0, paidCount: 1 });
        expect(metrics({ owedAdjustments: [seed, billed(50)] })).toMatchObject({ totalAnnual: 50, totalOutstanding: 0, totalCreditsOwed: 22, paidCount: 1, percentage: 100 });
        expect(getYearFinancialAvailability(sourceOf()).available).toBe(true);
        expect(getHouseholdFinancialAvailability(sourceOf(), 2).available).toBe(true);
    });
});

describe('Annual Summary (#688)', () => {
    it('keeps the bill split and the Annual figure unchanged: the carried credit still lowers the bills side', () => {
        expect(calculateAnnualSummary(members, bills)[2].total).toBe(60);
        const display = projectHouseholdDisplay(sourceOf(), members[0]);
        // Annual = max(0, G + O) and the displayed owed are what they were before #688.
        expect(display).toMatchObject({ ok: true, annual: 0, owed: 0, invoice: 0, credit: 72, balance: -72 });
        // A carried credit smaller than the bills changes nothing at all.
        const partial = { ...seed, amount: -20 };
        expect(projectHouseholdDisplay(sourceOf({ owedAdjustments: [partial] }), members[0]))
            .toMatchObject({ annual: 40, owed: 40, invoice: 40, credit: 0, balance: 40, invoiceBalance: 40 });
    });
});

describe('payment-reversal warning (#688)', () => {
    it('states the Outstanding a reversal leaves after the carried credit was refunded', async () => {
        // $30.00 paid on top of the $72.00 unused credit: Credit $102.00, all of it refunded.
        const payments = [{ id: 'pay-a', memberId: 2, amount: 30, receivedAt: '2027-02-15T00:00:00Z', method: 'cash', note: '' }];
        const creditAdjustments = [refund(102)];
        expect(financials({ payments, creditAdjustments }).cents).toMatchObject({ balance: 0, credit: 0 });
        const onReverse = vi.fn();
        render(<PaymentHistoryDialog open memberId={2} memberName="Bob" familyMembers={members} bills={bills} payments={payments}
            creditAdjustments={creditAdjustments} owedAdjustments={[seed]} readOnly={false} onReverse={onReverse} onClose={() => {}} />);
        const user = userEvent.setup();
        await user.click(screen.getAllByTitle('Reverse this payment')[0]);
        const dialog = screen.getByRole('dialog', { name: 'Reverse Payment — Refund on Record' });
        expect(dialog).toHaveTextContent('$102.00 refund');
        expect(dialog).toHaveTextContent('Reversing the $30.00 payment');
        expect(dialog).toHaveTextContent('Outstanding by $30.00');
    });
});

describe('Year-End Review preview and commit inputs (#688)', () => {
    it('previews the carried credit that remains after the first invoice, and carries it with one ordinary record', () => {
        const carry = buildCarryForwardSummary(members, bills, [], [], [seed], { fromYearLabel: '2027', nextYearLabel: '2028', itemized: true });
        expect(carry).toMatchObject({ ok: true, memberCount: 1, totalOpeningBalance: -72 });
        expect(carry.carriedCreditRecords).toMatchObject([{ id: 'cadj_carry_2028_2', type: 'carry_forward', amount: 72 }]);
        expect(carry.priorYear.owedAdjustments).toEqual([seed]);
        const nextBills = [{ ...bills[0], amount: 50 }];
        const [preview] = buildHouseholdPreview({ familyMembers: members, sourceBills: bills, nextBills, carry });
        expect(preview).toMatchObject({ ok: true, carriedTotal: -72, firstInvoiceTotal: 0, remainingCredit: 22 });
    });

    it('leaves both review fingerprints untouched: they hash the raw source and the entries, not the computed carry', () => {
        const state = { activeYear: { id: '2027', label: '2027', status: 'open' }, ...sourceOf(), billingEvents: [], settings: {} };
        const before = computeSourceFingerprint(state);
        expect(before).toBe(computeSourceFingerprint(structuredClone(state)));
        // Only a change to the stored records moves it (a pre-#688 stamp is such a change).
        expect(computeSourceFingerprint({ ...state, owedAdjustments: [{ ...seed, carriedForwardTo: '2028' }] })).not.toBe(before);
        const reconciliation = { reconciliationId: 'rec-1', sourceYearId: '2027', sourceFingerprint: before, confirmations: { noBillChanges: true } };
        expect(computePayloadFingerprint(reconciliation, '2028')).toBe(computePayloadFingerprint({ ...reconciliation, sourceFingerprint: 'other' }, '2028'));
    });
});

describe('Share writers receive the year\'s refunds and carry-forwards (#688)', () => {
    it('every caller of a dialog that publishes share data passes creditAdjustments', async () => {
        const { readFileSync, readdirSync, statSync } = await import('node:fs');
        const { join } = await import('node:path');
        const walk = dir => readdirSync(dir).flatMap(name => {
            const path = join(dir, name);
            return statSync(path).isDirectory() ? walk(path) : path.endsWith('.jsx') ? [path] : [];
        });
        const uses = walk(join(process.cwd(), 'src/app')).flatMap(path => {
            const text = readFileSync(path, 'utf8');
            return [...text.matchAll(/<(ShareLinkDialog|TextInvoiceDialog|EmailInvoiceDialog)\b[\s\S]*?\/>/g)]
                .map(match => ({ path, dialog: match[1], passes: /creditAdjustments=\{/.test(match[0]) }));
        });
        // Without the prop the dialog defaults to [] and a refunded credit is published as still remaining.
        expect(uses.length).toBeGreaterThanOrEqual(4);
        expect(uses.filter(use => !use.passes)).toEqual([]);
    });
});
