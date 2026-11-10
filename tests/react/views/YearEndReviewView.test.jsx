import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Year-End Review page, Steps 1–3 (#608): rows, validation, the existing-credit
// answers, the local draft (save, restore, refuse, stale, unavailable) and the
// Step 3 composer. The math itself is tested in tests/react/lib/year-end-review.test.js.

const mocks = vi.hoisted(() => ({ state: null, service: {}, notices: null, user: { uid: 'owner-uid', email: 'owner@example.com' } }));

vi.mock('@/app/hooks/useBillingData.js', () => ({ useBillingData: () => ({ ...mocks.state, service: mocks.service }) }));
vi.mock('@/app/contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));
// Step 4 reads the re-opened refund set (#319) so a re-opened refund never carries.
vi.mock('@/app/hooks/useRefundNotices.js', () => ({ useRefundNotices: () => mocks.notices }));

import { ToastProvider } from '@/app/contexts/ToastContext.jsx';
import YearEndReviewView from '@/app/views/YearEndReview/YearEndReviewView.jsx';
import { createDraft, draftStorageKey, fingerprintOf, snapshotExistingCredit, snapshotStorageKey, sourceCounts } from '@/app/views/YearEndReview/yearEndReviewModel.js';
import { computeEnded } from '@/lib/year-end-review.js';
import { buildReconciliationPayload } from '@/app/views/YearEndReview/reconciliationPayload.js';
import { COMMIT_CODES } from '@/app/views/YearEndReview/commitOutcome.js';
import { BILL, MEMBER, NEW_BILL, pineconeCredits, wireframeEntries, wireframeReviewState, yearEndState } from '../helpers/yearEndReviewFixture.js';

const KEY = draftStorageKey('owner-uid', '2026');

function sourceOf(state) {
    return {
        sourceYear: state.activeYear, bills: state.bills, familyMembers: state.familyMembers, owedAdjustments: state.owedAdjustments,
        payments: state.payments, creditAdjustments: state.creditAdjustments, billingEvents: state.billingEvents
    };
}

/** A draft saved on this device, with the fingerprint of today's source data unless overridden. */
function seedDraft(patch = {}, { fingerprint } = {}) {
    const draft = {
        ...createDraft({ userId: 'owner-uid', sourceYear: mocks.state.activeYear, nextYearLabel: '2027', sourceFingerprint: fingerprintOf(sourceOf(mocks.state)) }),
        reconciliationId: 'rec_fixed',
        ...patch
    };
    if (fingerprint) draft.sourceFingerprint = fingerprint;
    window.localStorage.setItem(KEY, JSON.stringify(draft));
    return draft;
}

const stored = () => JSON.parse(window.localStorage.getItem(KEY));
const renderPage = () => render(<MemoryRouter><ToastProvider><YearEndReviewView /></ToastProvider></MemoryRouter>);
const billRow = id => within(screen.getByTestId('bill-' + id));
const nextButton = () => screen.getByRole('button', { name: /^Next:/ });

async function choose(user, row, label, option) {
    await user.click(within(row.getByRole('group', { name: label })).getByRole('button', { name: option }));
}

const NORTHLINE = { change: 'price_change', newAmount: 198, firstMonth: '2026-07' };
const HARBOR = { change: 'price_change', newAmount: 144, firstMonth: '2026-03' };
const PINECONE = { change: 'ended', lastMonth: '2026-08' };

beforeEach(() => {
    window.localStorage.clear();
    mocks.state = yearEndState();
    mocks.service = {};
    mocks.notices = { refundNotices: [], loading: false, error: null };
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Step 1 — the five-bill fixture', () => {
    it('renders Northline and Harbor Cloud as price changes, Pinecone Vault ended, Cloudstream with a 2027 price and no True-up', () => {
        seedDraft({ bills: {
            [BILL.nl]: NORTHLINE, [BILL.hc]: HARBOR, [BILL.pv]: PINECONE,
            [BILL.cs]: { change: 'unchanged', nextYearAmount: 26 }
        } });
        renderPage();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review 2026 and start 2027');
        const northline = within(screen.getByTestId('calc-' + BILL.nl));
        expect(northline.getByText('True-up · $108.00')).toBeInTheDocument();
        expect(northline.getByText('($198.00 − $180.00) × 6 months = $108.00 ÷ 9 members = $12.00 each')).toBeInTheDocument();
        const harbor = within(screen.getByTestId('calc-' + BILL.hc));
        expect(harbor.getByText('True-up · $20.00')).toBeInTheDocument();
        expect(harbor.getByText('($144.00 − $120.00) ÷ 12 × 10 months = $20.00 ÷ 4 members = $5.00 each')).toBeInTheDocument();
        const pinecone = within(screen.getByTestId('calc-' + BILL.pv));
        expect(pinecone.getByText('Service credit · $20.00')).toBeInTheDocument();
        expect(pinecone.getByText('$60.00 ÷ 12 × 4 months (Sep–Dec) = $20.00 ÷ 5 members = $4.00 each')).toBeInTheDocument();
        expect(billRow(BILL.pv).getByText('Left out of 2027')).toBeInTheDocument();
        expect(screen.queryByTestId('calc-' + BILL.cs)).toBeNull();
        expect(screen.getByLabelText('2027 price / month', { selector: '#next-' + BILL.cs })).toHaveValue(26);
        expect(screen.getByText(/2 price changes · 1 ended · 2 unchanged\./)).toBeInTheDocument();
        expect(nextButton()).toBeEnabled();
    });

    it('computes a price change entered through the form and defaults the 2027 price to the new price', async () => {
        const user = userEvent.setup();
        renderPage();
        const row = billRow(BILL.nl);
        await choose(user, row, 'Northline Mobile: what changed in 2026', 'Price changed');
        await user.type(row.getByLabelText('New price / month'), '198');
        await user.selectOptions(row.getByLabelText('First month billed at it'), '2026-07');
        expect(row.getByText('True-up · $108.00')).toBeInTheDocument();
        expect(row.getByLabelText('2027 price / month')).toHaveValue(198);
        // The draft is mirrored to this device with a stable reconciliation id.
        expect(stored().bills[BILL.nl]).toMatchObject({ change: 'price_change', newAmount: 198, firstMonth: '2026-07' });
        expect(stored().reconciliationId).toMatch(/^rec_/);
    });

    it('shows the January hint, an override with the computed amount kept, and the annual remainder split', async () => {
        const user = userEvent.setup();
        seedDraft({ bills: { [BILL.hc]: { change: 'price_change', newAmount: 144, firstMonth: '2026-01' } } });
        renderPage();
        expect(screen.getByText('This bills all twelve months at the new price.')).toBeInTheDocument();
        const row = billRow(BILL.hc);
        await user.type(row.getByLabelText('True-up amount ($)'), '20');
        expect(row.getByText(/computed \$24\.00 → entered \$20\.00/)).toBeInTheDocument();
    });

    it('"No price changes this year" marks every bill Unchanged and records the confirmation', async () => {
        const user = userEvent.setup();
        seedDraft({ bills: { [BILL.nl]: NORTHLINE } });
        renderPage();
        await user.click(screen.getByRole('button', { name: 'No price changes this year' }));
        expect(screen.queryByTestId('calc-' + BILL.nl)).toBeNull();
        expect(screen.getByText('Confirmed: no closing-year bill changes.')).toBeInTheDocument();
        expect(stored().confirmations.noBillChanges).toBe(true);
        expect(stored().bills[BILL.nl].change).toBe('unchanged');
    });
});

describe('Step 1 — validation disables Next', () => {
    it('a new price equal to the old price', async () => {
        seedDraft({ bills: { [BILL.nl]: { ...NORTHLINE, newAmount: 180 } } });
        renderPage();
        expect(billRow(BILL.nl).getByText('No change—leave the bill Unchanged or enter a different price.')).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
    });

    it('a $0.00 price', () => {
        seedDraft({ bills: { [BILL.hc]: { ...HARBOR, newAmount: 0 } } });
        renderPage();
        expect(billRow(BILL.hc).getByText('Enter a price greater than $0.00.')).toBeInTheDocument();
        expect(screen.getByLabelText('New price / year')).toHaveAttribute('aria-invalid', 'true');
        expect(nextButton()).toBeDisabled();
        expect(screen.queryByText(/price changes? ·/)).toBeNull();
    });

    it('a missing first month', () => {
        seedDraft({ bills: { [BILL.nl]: { change: 'price_change', newAmount: 198 } } });
        renderPage();
        expect(billRow(BILL.nl).getByText('Choose the first month billed at $198.00.')).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
    });

    it('an override of zero or less', async () => {
        const user = userEvent.setup();
        seedDraft({ bills: { [BILL.nl]: NORTHLINE } });
        renderPage();
        await user.type(billRow(BILL.nl).getByLabelText('True-up amount ($)'), '0');
        expect(billRow(BILL.nl).getByText(/An override of \$0\.00 is not allowed/)).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
    });

    it('a missing last month on an ended bill', () => {
        seedDraft({ bills: { [BILL.pv]: { change: 'ended' } } });
        renderPage();
        expect(billRow(BILL.pv).getByText('Choose the last month of service.')).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
    });

    it('a bill ended in December records nothing and is left out of 2027, without an error', () => {
        seedDraft({ bills: { [BILL.pv]: { change: 'ended', lastMonth: '2026-12' } } });
        renderPage();
        expect(billRow(BILL.pv).getByText('Ended in December—records nothing, left out of 2027.')).toBeInTheDocument();
        expect(nextButton()).toBeEnabled();
    });

    it('a memberless bill shows the nothing-to-credit line instead of a computed panel, and no error', () => {
        mocks.state.bills = [{ id: 201, name: 'Orphan Plan', amount: 12, billingFrequency: 'monthly', members: [] }];
        seedDraft({ bills: { 201: { change: 'ended', lastMonth: '2026-08' } } });
        renderPage();
        expect(screen.getByText(/No members on this bill—nothing to credit or charge\./)).toBeInTheDocument();
        expect(screen.queryByText(/Service credit ·/)).toBeNull();
        expect(nextButton()).toBeEnabled();
    });

    it('Back keeps what was entered and the step strip names the four steps', async () => {
        const user = userEvent.setup();
        seedDraft({ bills: { [BILL.nl]: NORTHLINE } });
        renderPage();
        await user.click(nextButton());
        expect(screen.getByRole('heading', { name: 'New subscriptions' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /Back/ }));
        expect(screen.getByTestId('calc-' + BILL.nl)).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Year-End Review steps' })).toHaveTextContent('Review & start 2027');
    });
});

describe('Step 1 — credits already on the bill (D-B, no default)', () => {
    beforeEach(() => { mocks.state = yearEndState({ credits: true }); });
    const credits = () => within(screen.getByTestId('credits-' + BILL.pv));
    const recordGroup = name => credits().getByRole('group', { name });

    it('lists every record with three answers and no default, and disables Next until each is answered', () => {
        seedDraft({ bills: { [BILL.pv]: PINECONE } });
        renderPage();
        expect(screen.getByText('Credits already on this bill in 2026')).toBeInTheDocument();
        expect(credits().getAllByRole('group', { name: /Does .*’s credit cover this change\?/ })).toHaveLength(7);
        for (const button of credits().getAllByRole('button', { name: 'Unrelated' })) expect(button).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByText(/Say whether Ada Okafor’s \$3\.00 credit from Sep 2, 2026 covers this change\./)).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
    });

    async function answerAll(user, answers) {
        for (const [label, option] of Object.entries(answers)) {
            const group = recordGroup(label);
            await user.click(within(group).getByRole('button', { name: option }));
        }
    }
    const ALL = {
        'Ada Okafor’s $3.00 credit from Sep 2, 2026': 'Covers this change',
        'Erik Lindqvist’s $3.00 credit from Sep 2, 2026': 'Covers this change',
        'Kenji Nakamura’s $3.00 credit from Sep 2, 2026': 'Covers this change',
        'Dede Osei’s $3.00 credit from Sep 2, 2026': 'Covers this change',
        'Rosa Delgado’s $3.00 credit from Sep 2, 2026': 'Covers this change',
        'Dede Osei’s $10.00 credit from Mar 14, 2026': 'Unrelated'
    };

    it('previews the resulting credit per member and keeps the existing credits untouched', async () => {
        const user = userEvent.setup();
        const before = structuredClone(mocks.state.owedAdjustments);
        seedDraft({ bills: { [BILL.pv]: PINECONE } });
        renderPage();
        await answerAll(user, ALL);
        // Rosa's $6.00 credit exceeds her remaining $1.00: Covers is unavailable, Covers in part… takes an amount.
        const rosa = recordGroup('Rosa Delgado’s $6.00 credit from Oct 20, 2026');
        expect(within(rosa).getByRole('button', { name: 'Covers this change' })).toBeDisabled();
        expect(within(rosa).getByText(/larger than Rosa Delgado’s remaining \$1\.00/)).toBeInTheDocument();
        await user.click(within(rosa).getByRole('button', { name: 'Covers in part…' }));
        expect(nextButton()).toBeDisabled();
        await user.type(within(rosa).getByLabelText('Covering amount ($)'), '17');
        expect(within(rosa).getByText(/Enter at most \$1\.00/)).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
        await user.clear(within(rosa).getByLabelText('Covering amount ($)'));
        await user.type(within(rosa).getByLabelText('Covering amount ($)'), '1');
        expect(nextButton()).toBeEnabled();
        expect(screen.getByText(/\$20\.00 computed − \$16\.00 covered by earlier credits = \$4\.00 to record/)).toBeInTheDocument();
        expect(screen.getByText(/Ada Okafor \$1\.00 · Erik Lindqvist \$1\.00 · Kenji Nakamura \$1\.00 · Dede Osei \$1\.00 · Rosa Delgado \$0\.00 → \$4\.00 across 4 members/)).toBeInTheDocument();
        expect(within(screen.getByTestId('calc-' + BILL.pv)).getByText('Service credit · $4.00')).toBeInTheDocument();
        expect(mocks.state.owedAdjustments).toEqual(before);
        // Answers are stored by the record's own id with seen + coverage.
        const answer = stored().bills[BILL.pv].existingCredits.oadj_sc_rosa_oct;
        expect(answer).toMatchObject({ choice: 'partial', appliedCents: 100 });
        expect(answer.seen).toMatchObject({ memberId: MEMBER.rosa, amountCents: 600 });
        expect(answer.coverage).toMatchObject({ basis: 'ended', lastMonth: '2026-08', shareCents: 400 });
    });

    it('an unrelated answer on every record leaves the full credit', async () => {
        const user = userEvent.setup();
        seedDraft({ bills: { [BILL.pv]: PINECONE } });
        renderPage();
        for (const record of pineconeCredits()) {
            const label = `${mocks.state.familyMembers.find(member => member.id === record.memberId).name}’s $${record.amount.toFixed(2)} credit from ${record.incurredDate === '2026-09-02' ? 'Sep 2' : record.incurredDate === '2026-03-14' ? 'Mar 14' : 'Oct 20'}, 2026`;
            await user.click(within(recordGroup(label)).getByRole('button', { name: 'Unrelated' }));
        }
        expect(within(screen.getByTestId('calc-' + BILL.pv)).getByText('Service credit · $20.00')).toBeInTheDocument();
        expect(nextButton()).toBeEnabled();
    });

    it('a record smaller than the share can still be answered Covers in part and nets only that amount (fixture 8i)', async () => {
        const user = userEvent.setup();
        mocks.state.owedAdjustments = [
            ...mocks.state.owedAdjustments.filter(record => record.kind !== 'service_credit'),
            { id: 'oadj_sc_mixed', memberId: MEMBER.ada, billId: BILL.pv, kind: 'service_credit', amount: 10, reason: 'cancellation and outage', incurredDate: '2026-09-02', createdAt: '2026-09-02T12:00:00.000Z', status: 'active' }
        ];
        seedDraft({ bills: { [BILL.pv]: PINECONE } });
        renderPage();
        const group = recordGroup('Ada Okafor’s $10.00 credit from Sep 2, 2026');
        expect(within(group).getByRole('button', { name: 'Covers this change' })).toBeDisabled();
        await user.click(within(group).getByRole('button', { name: 'Covers in part…' }));
        await user.type(within(group).getByLabelText('Covering amount ($)'), '3');
        expect(screen.getByText(/Ada Okafor \$1\.00 · Erik Lindqvist \$4\.00/)).toBeInTheDocument();
        expect(within(screen.getByTestId('calc-' + BILL.pv)).getByText('Service credit · $17.00')).toBeInTheDocument();
    });

    it('a fully covered ended bill records nothing and says it is still left out of 2027', async () => {
        const user = userEvent.setup();
        mocks.state.owedAdjustments = mocks.state.owedAdjustments.filter(record => record.kind !== 'service_credit').concat(
            [MEMBER.ada, MEMBER.erik, MEMBER.kenji, MEMBER.dede, MEMBER.rosa].map(memberId => ({
                id: 'oadj_full_' + memberId, memberId, billId: BILL.pv, kind: 'service_credit', amount: 4, reason: 'Cancelled', incurredDate: '2026-09-02', createdAt: '2026-09-02T12:00:00.000Z', status: 'active'
            })));
        seedDraft({ bills: { [BILL.pv]: PINECONE } });
        renderPage();
        for (const button of credits().getAllByRole('button', { name: 'Covers this change' })) await user.click(button);
        expect(screen.getByText('Nothing more to record; the bill is left out of 2027.')).toBeInTheDocument();
        expect(screen.getByText('Nothing to record')).toBeInTheDocument();
        expect(nextButton()).toBeEnabled();
    });

    it('a fully covered price reduction keeps the bill at its new price', async () => {
        const user = userEvent.setup();
        mocks.state.owedAdjustments = [
            { id: 'oadj_cut', memberId: MEMBER.sam, billId: BILL.mm, kind: 'service_credit', amount: 18, reason: 'Outage', incurredDate: '2026-09-01', createdAt: '2026-09-01T12:00:00.000Z', status: 'active' },
            ...mocks.state.owedAdjustments.filter(record => record.kind !== 'service_credit')
        ];
        mocks.state.bills = [{ id: BILL.mm, name: 'Meridian Music', amount: 30, billingFrequency: 'monthly', members: [MEMBER.sam] }];
        seedDraft({ bills: { [BILL.mm]: { change: 'price_change', newAmount: 24, firstMonth: '2026-10' } } });
        renderPage();
        const group = within(screen.getByTestId('credits-' + BILL.mm)).getByRole('group', { name: /Sam Whitfield’s \$18\.00 credit/ });
        await user.click(within(group).getByRole('button', { name: 'Unrelated' }));
        expect(within(screen.getByTestId('calc-' + BILL.mm)).getByText('Service credit · $18.00')).toBeInTheDocument();
        await user.click(within(group).getByRole('button', { name: 'Covers this change' }));
        expect(screen.getByText('Nothing more to record; 2027 uses $24.00.')).toBeInTheDocument();
        expect(screen.getByText('Nothing to record')).toBeInTheDocument();
        expect(nextButton()).toBeEnabled();
    });

    it('editing the months clears the bill’s answers and flags them', async () => {
        const user = userEvent.setup();
        seedDraft({ bills: { [BILL.pv]: PINECONE } });
        renderPage();
        await answerAll(user, ALL);
        const rosa = recordGroup('Rosa Delgado’s $6.00 credit from Oct 20, 2026');
        await user.click(within(rosa).getByRole('button', { name: 'Unrelated' }));
        expect(nextButton()).toBeEnabled();
        await user.selectOptions(billRow(BILL.pv).getByLabelText('Last month of service'), '2026-09');
        expect(nextButton()).toBeDisabled();
        expect(screen.getAllByText('Answer again: the months this change covers changed').length).toBeGreaterThan(0);
        expect(Object.keys(stored().bills[BILL.pv].existingCredits || {})).toHaveLength(0);
    });

    it('a restored draft with a changed record clears that answer and disables Next; answering again re-enables it', async () => {
        const user = userEvent.setup();
        // Draft saved while Dede's September record was $3.00; it has since been re-recorded as $2.00.
        const live = mocks.state.owedAdjustments.filter(record => record.kind === 'service_credit');
        const ended = computeEnded(mocks.state.bills.find(bill => bill.id === BILL.pv), PINECONE, { sourceYear: '2026', skipExistingCredits: true });
        const answers = {};
        for (const record of live) {
            const covers = record.reason === 'Cancelled Pinecone Vault';
            const unrelatedOrPartial = record.id === 'oadj_sc_rosa_oct' ? { choice: 'partial', appliedCents: 100 } : { choice: 'unrelated' };
            answers[record.id] = {
                ...(covers ? { choice: 'covers' } : unrelatedOrPartial),
                seen: snapshotExistingCredit(record),
                coverage: { basis: 'ended', frequency: 'annual', fromAmount: 60, toAmount: null, firstMonth: null, lastMonth: '2026-08', override: ended.enteredOverride, shareCents: 400 }
            };
        }
        seedDraft({ bills: { [BILL.pv]: { ...PINECONE, existingCredits: answers } } });
        mocks.state.owedAdjustments = mocks.state.owedAdjustments.map(record => (record.id === 'oadj_sc_dede' ? { ...record, amount: 2 } : record));
        renderPage();
        expect(screen.getByText(/1 earlier-credit answer was cleared/)).toBeInTheDocument();
        const dede = recordGroup('Dede Osei’s $2.00 credit from Sep 2, 2026');
        expect(within(dede).getByText('Answer again: Dede Osei’s $2.00 credit changed')).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
        // The other answers survive.
        expect(within(recordGroup('Ada Okafor’s $3.00 credit from Sep 2, 2026')).getByRole('button', { name: 'Covers this change' })).toHaveAttribute('aria-pressed', 'true');
        await user.click(within(dede).getByRole('button', { name: 'Covers this change' }));
        expect(nextButton()).toBeEnabled();
        expect(within(dede).queryByText(/Answer again/)).toBeNull();
    });
});

describe('override after full credit coverage', () => {
    it('stays editable when existing credits cover the whole override, and can be cleared', async () => {
        const user = userEvent.setup();
        mocks.state.bills = [{ id: 301, name: 'Solo Plan', amount: 12, billingFrequency: 'monthly', members: [MEMBER.sam] }];
        mocks.state.owedAdjustments = [{ id: 'oadj_solo', memberId: MEMBER.sam, billId: 301, kind: 'service_credit', amount: 30, reason: 'Cancelled', incurredDate: '2026-09-02', createdAt: '2026-09-02T12:00:00.000Z', status: 'active' }];
        seedDraft({ bills: { 301: { change: 'ended', lastMonth: '2026-08', override: 30 } } });
        renderPage();
        await user.click(within(screen.getByTestId('credits-301')).getByRole('button', { name: 'Covers this change' }));
        expect(screen.getByText('Nothing more to record; the bill is left out of 2027.')).toBeInTheDocument();
        const field = within(screen.getByTestId('bill-301')).getByLabelText('Service credit ($)');
        expect(field).toBeEnabled();
        await user.clear(field);
        expect(screen.getByText(/Service credit · \$48\.00|\$48\.00 computed/)).toBeInTheDocument();
    });
});

describe('Step 2 — new subscriptions', () => {
    it('allocates a billId once, validates, and computes the late-start True-up', async () => {
        const user = userEvent.setup();
        renderPage();
        await user.click(nextButton());
        await user.click(screen.getByRole('button', { name: 'Add subscription' }));
        const row = within(document.querySelector('[data-testid^="new-"]'));
        const draftRow = stored().newBills[0];
        expect(draftRow.billId).toBeTypeOf('number');
        expect(mocks.state.bills.map(bill => bill.id)).not.toContain(draftRow.billId);
        // A late-start row with no members is an error that disables Next.
        expect(row.getByText('Choose at least one member for a new subscription.')).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
        await user.type(row.getByLabelText('Name'), 'Lumen Fiber Backup');
        await user.type(row.getByLabelText('Price / month'), '9.99');
        await user.selectOptions(row.getByLabelText('First month of service'), '2026-09');
        for (const name of ['Kenji Nakamura', 'Dede Osei', 'Sam Whitfield']) await user.click(row.getByLabelText(name));
        expect(row.getByText('True-up · $39.96')).toBeInTheDocument();
        expect(row.getByText('$9.99 × 4 months = $39.96 ÷ 3 members = $13.32 each')).toBeInTheDocument();
        expect(nextButton()).toBeEnabled();
        expect(stored().newBills[0].billId).toBe(draftRow.billId);
        expect(stored().newBills[0].rowId).toBe(draftRow.rowId);
    });
});

describe('review findings', () => {
    it('a restored new subscription whose member was removed is an error that disables Next', async () => {
        seedDraft({ newBills: [{ rowId: 11, billId: 12, name: 'Lumen', amount: 9.99, frequency: 'monthly', website: '', members: [999], firstMonth: '2026-09' }] });
        renderPage();
        await userEvent.setup().click(nextButton());
        expect(screen.getByText('A selected member no longer exists. Choose the members again.')).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
    });

    it('a charge amount that rounds to zero cents is refused', async () => {
        const user = userEvent.setup();
        renderPage();
        await user.click(nextButton());
        await user.click(nextButton());
        const okafor = within(screen.getByTestId('household-' + MEMBER.ada));
        await user.click(okafor.getByRole('button', { name: 'Add charge for Okafor household' }));
        await user.type(okafor.getByLabelText('Amount ($)'), '0.001');
        await user.type(okafor.getByLabelText('Description'), 'Tiny');
        await user.click(okafor.getByRole('button', { name: 'Add to review' }));
        expect(okafor.getByText('Enter an amount greater than zero.')).toBeInTheDocument();
        expect(stored().charges).toEqual([]);
    });
});

describe('review polish', () => {
    it('exposes input errors through aria-describedby and pluralizes one month', async () => {
        const user = userEvent.setup();
        seedDraft({ newBills: [{ rowId: 21, billId: 22, name: '', amount: 5, frequency: 'monthly', website: '', members: [MEMBER.sam], firstMonth: '2026-12' }] });
        renderPage();
        await user.click(nextButton());
        const name = screen.getByLabelText('Name');
        expect(name).toHaveAttribute('aria-describedby', 'new-name-21-error');
        expect(document.getElementById('new-name-21-error')).toHaveTextContent('Enter a name for the subscription.');
        await user.type(name, 'Solo');
        expect(screen.getByText('1 month of service in 2026 never billed')).toBeInTheDocument();
        await user.click(nextButton());
        const okafor = within(screen.getByTestId('household-' + MEMBER.ada));
        await user.click(okafor.getByRole('button', { name: 'Add charge for Okafor household' }));
        await user.click(okafor.getByRole('button', { name: 'Add to review' }));
        expect(okafor.getByLabelText('Description')).toHaveAttribute('aria-describedby', `charge-desc-${MEMBER.ada}-error`);
    });

    it('does not write the counts sidecar under a fingerprint that is not the current one', () => {
        const old = fingerprintOf(sourceOf(mocks.state));
        seedDraft({}, { fingerprint: old });
        mocks.state.payments = [{ id: 'p9', memberId: MEMBER.erik, amount: 5, type: 'payment', reversed: false, receivedAt: '2026-12-01' }];
        renderPage();
        expect(window.localStorage.getItem(snapshotStorageKey('owner-uid', '2026'))).toBeNull();
    });
});

describe('Step 3 — member charges', () => {
    async function openCharges(user) {
        await user.click(nextButton());
        await user.click(nextButton());
    }

    it('lists Maja’s $30.00 activation fee under the Lindqvist household once, as already recorded, and never duplicates it', async () => {
        const user = userEvent.setup();
        renderPage();
        await openCharges(user);
        const lindqvist = within(screen.getByTestId('household-' + MEMBER.erik));
        expect(lindqvist.getByText('Lindqvist household')).toBeInTheDocument();
        expect(lindqvist.getByText(/Maja Lindqvist/)).toBeInTheDocument();
        expect(lindqvist.getByText('$30.00')).toBeInTheDocument();
        expect(lindqvist.getAllByText(/already recorded, carried once/)).toHaveLength(1);
        expect(screen.getAllByText('Activation fee', { exact: false })).toHaveLength(1);
        expect(stored().charges).toEqual([]);
    });

    it('the Add charge composer validates, adds a draft row with a stable rowId, and removes it', async () => {
        const user = userEvent.setup();
        renderPage();
        await openCharges(user);
        const okafor = within(screen.getByTestId('household-' + MEMBER.ada));
        await user.click(okafor.getByRole('button', { name: 'Add charge for Okafor household' }));
        await user.click(okafor.getByRole('button', { name: 'Add to review' }));
        expect(okafor.getByText('Enter an amount greater than zero.')).toBeInTheDocument();
        expect(okafor.getByText('Enter a description.')).toBeInTheDocument();
        await user.selectOptions(okafor.getByLabelText('Member'), String(MEMBER.zara));
        await user.type(okafor.getByLabelText('Amount ($)'), '6');
        await user.type(okafor.getByLabelText('Description'), 'Paper statement fee');
        await user.click(okafor.getByRole('button', { name: 'Add to review' }));
        expect(okafor.getByText(/Paper statement fee/)).toBeInTheDocument();
        expect(okafor.getByText(/recorded when you start 2027/)).toBeInTheDocument();
        expect(stored().charges).toHaveLength(1);
        expect(stored().charges[0]).toMatchObject({ memberId: MEMBER.zara, amount: 6, description: 'Paper statement fee' });
        const rowId = stored().charges[0].rowId;
        await user.click(okafor.getByRole('button', { name: 'Remove Paper statement fee' }));
        expect(stored().charges).toEqual([]);
        expect(rowId).toBeDefined();
    });

    // #609 withdraws the placeholder: the Step 3 footer now reaches Step 4.
    it('ends with a Review & start footer that opens Step 4', async () => {
        const user = userEvent.setup();
        renderPage();
        await openCharges(user);
        await user.click(screen.getByRole('button', { name: /Review & start 2027/ }));
        expect(screen.getByTestId('year-end-review-step-4')).toBeInTheDocument();
    });
});

describe('the local draft', () => {
    it('restores on reload with every rowId, billId and the reconciliationId intact', () => {
        const draft = seedDraft({
            bills: { [BILL.nl]: NORTHLINE },
            newBills: [{ rowId: 1730000000001, billId: 1730000000002, name: 'Lumen Fiber Backup', amount: 9.99, frequency: 'monthly', website: '', members: [MEMBER.kenji, MEMBER.dede, MEMBER.sam], firstMonth: '2026-09' }],
            charges: [{ rowId: 1730000000003, memberId: MEMBER.zara, amount: 6, description: 'Paper statement fee', incurredDate: '2026-11-28' }]
        });
        const first = renderPage();
        expect(screen.getByText(/Draft from .* restored\./)).toBeInTheDocument();
        first.unmount();
        renderPage();
        const saved = stored();
        expect(saved.reconciliationId).toBe(draft.reconciliationId);
        expect(saved.newBills[0]).toMatchObject({ rowId: 1730000000001, billId: 1730000000002 });
        expect(saved.charges[0].rowId).toBe(1730000000003);
        expect(screen.getByTestId('calc-' + BILL.nl)).toBeInTheDocument();
    });

    it('refuses a draft saved for another user or year and starts a new one with a message', () => {
        seedDraft({ userId: 'someone-else', reconciliationId: 'rec_other' });
        renderPage();
        expect(screen.getByText(/This draft belongs to another user, year, or draft version\. A new draft was started\./)).toBeInTheDocument();
        expect(stored().userId).toBe('owner-uid');
        expect(stored().reconciliationId).not.toBe('rec_other');
    });

    it('discards a draft with a malformed row instead of crashing', () => {
        seedDraft({ newBills: [null] });
        renderPage();
        expect(screen.getByText(/malformed and was discarded/)).toBeInTheDocument();
        expect(stored().newBills).toEqual([]);
    });

    it('discards a restored row whose text fields are not strings instead of crashing a later step (#609 review)', async () => {
        const user = userEvent.setup();
        seedDraft({
            newBills: [{ rowId: 'r1', billId: 900, name: null, amount: 9.99, frequency: 'monthly', website: '', members: [MEMBER.sam], firstMonth: '2026-09' }],
            charges: [{ rowId: 'c1', memberId: MEMBER.zara, amount: 6, description: 42, incurredDate: '2026-11-28' }]
        });
        renderPage();
        expect(screen.getByText(/malformed and was discarded/)).toBeInTheDocument();
        await user.click(nextButton());
        expect(screen.getByRole('heading', { name: 'New subscriptions' })).toBeInTheDocument();
        expect(stored().newBills).toEqual([]);
    });

    it('discards an unreadable draft with a message', () => {
        window.localStorage.setItem(KEY, '{not json');
        renderPage();
        expect(screen.getByText(/could not be read and was discarded/)).toBeInTheDocument();
    });

    it('a stale draft shows the banner with counts, keeps inputs and recomputes amounts', () => {
        const before = fingerprintOf(sourceOf(mocks.state));
        const counts = sourceCounts(mocks.state);
        seedDraft({ bills: { [BILL.nl]: NORTHLINE } }, { fingerprint: before });
        window.localStorage.setItem(snapshotStorageKey('owner-uid', '2026'), JSON.stringify({ fingerprint: before, counts }));
        // A payment is recorded after the draft was saved.
        mocks.state.payments = [{ id: 'p1', memberId: MEMBER.erik, amount: 50, type: 'payment', reversed: false, receivedAt: '2026-12-01' }];
        renderPage();
        const banner = screen.getByText(/Draft from .* restored\./).closest('.yer-restored');
        expect(banner).toHaveTextContent('2026 changed since you saved it: 1 payment recorded');
        expect(banner).toHaveTextContent('Every amount was recomputed');
        expect(screen.getByTestId('calc-' + BILL.nl)).toHaveTextContent('True-up · $108.00');
        // The reviewed fingerprint is retained, never silently replaced.
        expect(stored().sourceFingerprint).toBe(before);
    });

    it('degrades to an in-memory draft with a notice when storage throws', async () => {
        const user = userEvent.setup();
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        renderPage();
        expect(screen.getByText(/This draft is not saved on this device/)).toBeInTheDocument();
        // The page works unchanged.
        await user.click(within(screen.getByTestId('bill-' + BILL.nl)).getByRole('button', { name: 'Price changed' }));
        expect(within(screen.getByTestId('bill-' + BILL.nl)).getByLabelText('New price / month')).toBeInTheDocument();
    });

    it('Discard draft confirms, clears the stored draft and starts a fresh one; cancelling keeps it', async () => {
        const user = userEvent.setup();
        seedDraft({ bills: { [BILL.nl]: NORTHLINE } });
        renderPage();
        const id = stored().reconciliationId;
        await user.click(screen.getByRole('button', { name: 'Discard draft' }));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByTestId('calc-' + BILL.nl)).toBeInTheDocument();
        expect(stored().reconciliationId).toBe(id);
        await user.click(screen.getByRole('button', { name: 'Discard draft' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard draft' }));
        expect(screen.queryByTestId('calc-' + BILL.nl)).toBeNull();
        await waitFor(() => expect(stored().reconciliationId).not.toBe(id));
        expect(stored().bills).toEqual({});
    });

    it('never writes anything but the local draft (the draft is kept on every edit)', async () => {
        const user = userEvent.setup();
        renderPage();
        await user.click(screen.getByRole('button', { name: 'No price changes this year' }));
        expect(Object.keys(window.localStorage).filter(key => key.startsWith('ffb.yearEndReview.v1.owner-uid.2026'))).toHaveLength(2);
        expect(stored().draftVersion).toBe(1);
        fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    });
});

describe('guards', () => {
    it('says so when the next year already exists and does not render the steps', () => {
        mocks.state.billingYears = [{ id: '2026', label: '2026', status: 'settling' }, { id: '2027', label: '2027', status: 'open' }];
        renderPage();
        expect(screen.getByText('2027 already exists')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Bills' })).toBeNull();
    });

    it('blocks the review for a year label without a four-digit year', () => {
        mocks.state.activeYear = { id: '2026-27', label: '2026-27', status: 'closed' };
        mocks.state.billingYears = [mocks.state.activeYear];
        renderPage();
        expect(screen.getByText('The review needs a four-digit year label')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Bills' })).toBeNull();
    });

    it('refuses an archived year', () => {
        mocks.state.activeYear = { id: '2026', label: '2026', status: 'archived' };
        renderPage();
        expect(screen.getByText('2026 is archived')).toBeInTheDocument();
    });
});

// ── Step 4, Start, the commit outcomes and the guard (#609) ────────────────────
// The commit outcomes of #607 (NEXT_YEAR_EXISTS with its three-way read, STALE_SOURCE,
// COMMIT_FAILED, COMMIT_UNCERTAIN) are mocked at the service boundary here: today's
// createYear (pre-#607) cannot produce them.

function routedPage() {
    return render(
        <MemoryRouter initialEntries={['/year-end-review']}>
            <ToastProvider>
                <Routes>
                    <Route path="/year-end-review" element={<YearEndReviewView />} />
                    <Route path="/dashboard" element={<p>Dashboard page</p>} />
                </Routes>
            </ToastProvider>
        </MemoryRouter>
    );
}

function fakeService(overrides = {}) {
    const service = {
        // What #607's commit guard declares (commitOutcome.js hasCommitGuard).
        reviewedCommitGuard: true,
        getState: () => mocks.state,
        _loadYearsList: vi.fn(async () => {}),
        switchYear: vi.fn(async yearId => {
            if (yearId !== mocks.state.activeYear.id) mocks.state = { ...mocks.state, activeYear: { id: yearId, label: yearId, status: 'open' } };
        }),
        createYear: vi.fn(async () => {}),
        ...overrides
    };
    mocks.service = service;
    return service;
}

function deferred() {
    let resolve; let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const codeError = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
const startButton = () => within(screen.getByTestId('start-card')).queryByRole('button', { name: /^Start 2027$|^Starting 2027/ });
const household = id => within(screen.getByTestId('review-household-' + id));

async function openStep4(user) {
    await user.click(screen.getByRole('button', { name: /^Next: new subscriptions/ }));
    await user.click(screen.getByRole('button', { name: /^Next: member charges/ }));
    await user.click(screen.getByRole('button', { name: /Review & start 2027/ }));
}

function seedWireframe() {
    mocks.state = wireframeReviewState();
    return seedDraft(wireframeEntries());
}

describe('Step 4 — the wireframe preview', () => {
    it('shows the four figures, the baseline sentence and every household’s 2026 / 2027 / carried / first-invoice figures', async () => {
        const user = userEvent.setup();
        fakeService();
        seedWireframe();
        renderPage();
        await openStep4(user);
        const figures = within(screen.getByTestId('review-figures'));
        expect(figures.getByText('$2,844.00')).toBeInTheDocument();
        expect(figures.getByText('$3,167.88')).toBeInTheDocument();
        expect(figures.getByText('+$323.88 subscriptions vs 2026')).toBeInTheDocument();
        expect(figures.getByText('+$170.46')).toBeInTheDocument();
        expect(figures.getByText('$3,338.34')).toBeInTheDocument();
        expect(screen.getByText(/never folded into them/)).toBeInTheDocument();
        const expected = [
            [MEMBER.ada, '$978.00', '$1,056.00', 'Carried +$15.00', '$1,071.00'],
            [MEMBER.erik, '$618.00', '$668.00', 'Carried +$55.00', '$723.00'],
            [MEMBER.kenji, '$606.00', '$715.92', 'Carried +$98.14', '$814.06'],
            [MEMBER.rosa, '$372.00', '$388.00', 'Carried −$28.00', '$360.00'],
            [MEMBER.sam, '$270.00', '$339.96', 'Carried +$30.32', '$370.28']
        ];
        for (const [id, source, next, carried, first] of expected) {
            const card = household(id);
            expect(card.getByText(source)).toBeInTheDocument();
            expect(card.getByText(next)).toBeInTheDocument();
            expect(card.getByText(carried)).toBeInTheDocument();
            expect(card.getByText(first)).toBeInTheDocument();
        }
        // Nothing is pending once every step validates and the preview is current.
        expect(screen.queryByText('pending')).toBeNull();
        expect(startButton()).toBeEnabled();
    });

    it('expands a household: the credit and its detail at the household level, member blocks, the four-line total, Edit links', async () => {
        const user = userEvent.setup();
        fakeService();
        seedWireframe();
        renderPage();
        await openStep4(user);
        await user.click(household(MEMBER.erik).getByRole('button', { name: /Show details for Lindqvist household/ }));
        const card = household(MEMBER.erik);
        const credit = within(card.getByTestId('household-credit'));
        // The library's member-facing description (src/lib carry items), shown as written.
        expect(credit.getByText(/^Your household.s 2026 credit$/)).toBeInTheDocument();
        expect(credit.getByText(/household, not one member/)).toBeInTheDocument();
        expect(credit.getByText('2026 credit carried into 2027')).toBeInTheDocument();
        expect(credit.getByText(/Pinecone Vault ended in August.*\(Erik\)/)).toBeInTheDocument();
        expect(credit.getByText('Detail explains the credit; it is not added again.')).toBeInTheDocument();
        const maja = within(card.getByTestId('review-member-' + MEMBER.maja));
        expect(maja.getByText(/2027 bills \$316\.00 · carried \+\$42\.00/)).toBeInTheDocument();
        expect(maja.getByText('Activation fee (Nov 3)')).toBeInTheDocument();
        expect(maja.getByText('+$30.00')).toBeInTheDocument();
        expect(card.getByText('2027 bills at their new prices')).toBeInTheDocument();
        // The heading figure and the four-line total both name the first invoice.
        expect(card.getAllByText('First 2027 invoice')).toHaveLength(2);
        expect(card.getAllByText('$723.00')).toHaveLength(2);
        await user.click(card.getByRole('button', { name: 'Edit charges' }));
        expect(screen.getByRole('heading', { name: 'Member charges' })).toBeInTheDocument();
    });

    it('a household whose carry nets to a credit (Rosa): −$40.00 credit with its detail, +$12.00 Northline, first invoice $360.00', async () => {
        const user = userEvent.setup();
        fakeService();
        seedWireframe();
        renderPage();
        await openStep4(user);
        await user.click(household(MEMBER.rosa).getByRole('button', { name: /Show details for Rosa Delgado/ }));
        const card = household(MEMBER.rosa);
        const credit = within(card.getByTestId('household-credit'));
        expect(credit.getByText('−$40.00')).toBeInTheDocument();
        expect(credit.getByText(/Pinecone Vault ended in August.*\(Rosa\)/)).toBeInTheDocument();
        expect(credit.getByText('↳ Other 2026 overpayment')).toBeInTheDocument();
        expect(credit.getByText('−$36.00')).toBeInTheDocument();
        expect(within(card.getByTestId('review-member-' + MEMBER.rosa)).getByText('+$12.00')).toBeInTheDocument();
        expect(card.getAllByText('−$28.00').length).toBeGreaterThan(0);
        expect(card.getAllByText('$360.00').length).toBeGreaterThan(0);
    });

    it('states in plain counts exactly what Start writes', async () => {
        const user = userEvent.setup();
        fakeService();
        seedWireframe();
        renderPage();
        await openStep4(user);
        const statement = within(screen.getByTestId('start-statement'));
        // 9 Northline + 4 Harbor Cloud + 3 Lumen = 16 per-member records ($108.00 + $20.00 + $39.96).
        // The wireframe's "13 True-up shares" miscounts them; its $167.96 total agrees.
        expect(statement.getByText('Record 16 True-up shares ($167.96) and 5 service-credit shares ($20.00) in 2026 and carry them into 2027.')).toBeInTheDocument();
        expect(statement.getByText('Carry 3 member charges already recorded, once.')).toBeInTheDocument();
        expect(statement.getByText('Create Lumen Fiber Backup in 2027.')).toBeInTheDocument();
        expect(statement.getByText('Set Northline Mobile, Cloudstream Family and Harbor Cloud Storage at their new prices.')).toBeInTheDocument();
        expect(statement.getByText('Keep 1 bill at its 2026 price.')).toBeInTheDocument();
        expect(statement.getByText('Leave Pinecone Vault out of 2027.')).toBeInTheDocument();
        expect(statement.getByText('Carry a balance for 5 households.')).toBeInTheDocument();
        expect(statement.getByText(/It writes two documents together/)).toBeInTheDocument();
    });

    it('validates the year label (suggested, editable, duplicate-checked) and blocks Start on it without marking figures pending', async () => {
        const user = userEvent.setup();
        fakeService();
        seedWireframe();
        mocks.state.billingYears = [{ id: '2026', label: '2026', status: 'settling' }, { id: '2025', label: '2025', status: 'archived' }];
        renderPage();
        await openStep4(user);
        const label = screen.getByLabelText('New billing year label');
        expect(label).toHaveValue('2027');
        await user.clear(label);
        await user.type(label, '2025');
        expect(label).toHaveAccessibleDescription('Billing year "2025" already exists.');
        expect(within(screen.getByTestId('start-blockers')).getByText('Billing year "2025" already exists.')).toBeInTheDocument();
        expect(within(screen.getByTestId('start-card')).getByRole('button', { name: 'Start 2025' })).toBeDisabled();
        expect(screen.queryByText('pending')).toBeNull();
        // A year the review could never review later (#608 refuses non-calendar labels) is not created.
        await user.clear(label);
        await user.type(label, '2027-28');
        expect(label).toHaveAccessibleDescription('Use a four-digit year, such as 2027. Years with other labels cannot be reviewed later.');
        await user.clear(label);
        await user.type(label, '2027');
        expect(startButton()).toBeEnabled();
    });
});

describe('Step 4 — Start and the commit outcomes', () => {
    it('Start runs the guard, then createYear with the draft’s payload; success clears the draft, switches and leaves', async () => {
        const user = userEvent.setup();
        const order = [];
        const service = fakeService({
            _loadYearsList: vi.fn(async () => { order.push('guard'); }),
            createYear: vi.fn(async () => { order.push('commit'); })
        });
        mocks.notices = { refundNotices: [{ kind: 'refund_notice', creditAdjustmentId: 'cadj_x', status: 'not_received', resolution: null }], loading: false, error: null };
        const draft = seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        await screen.findByText('Dashboard page');
        expect(order).toEqual(['guard', 'commit']);
        const [yearId, options] = service.createYear.mock.calls[0];
        expect(yearId).toBe('2027');
        expect(options.reopenedAdjustmentIds).toBeInstanceOf(Set);
        expect(options.reconciliation).toEqual(buildReconciliationPayload(stored() || draft, sourceOf(mocks.state)));
        expect(options.reconciliation).toMatchObject({
            reconciliationId: 'rec_fixed', sourceYearId: '2026', sourceFingerprint: draft.sourceFingerprint,
            trueUps: [{ billId: BILL.nl, newAmount: 198, firstMonth: '2026-07' }, { billId: BILL.hc, newAmount: 144, firstMonth: '2026-03' }],
            serviceCredits: [{ billId: BILL.pv, basis: 'ended', lastMonth: '2026-08' }],
            endedBillIds: [BILL.pv], billOverrides: { [BILL.cs]: 26 },
            usageCharges: [{ existingAdjustmentId: 'oadj_maja_fee' }, { existingAdjustmentId: 'oadj_dede_roam' }, { existingAdjustmentId: 'oadj_kenji_calls' }],
            newBills: [expect.objectContaining({ rowId: 'row_lumen', billId: NEW_BILL, name: 'Lumen Fiber Backup' })]
        });
        expect(window.localStorage.getItem(KEY)).toBeNull();
        expect(service.switchYear).toHaveBeenCalledWith('2027');
    });

    it('starting: locks the page, says not to close the tab, and offers no Back, Discard or Edit', async () => {
        const user = userEvent.setup();
        const pending = deferred();
        fakeService({ createYear: vi.fn(() => pending.promise) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        expect(await screen.findByText(/Writing 2026 and 2027 together\. Don’t close this tab\./)).toBeInTheDocument();
        expect(screen.getByText('Locked while 2027 starts')).toBeInTheDocument();
        expect(within(screen.getByTestId('start-card')).getByRole('button', { name: 'Starting 2027…' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Back to member charges/ })).toBeNull();
        expect(screen.getByLabelText('New billing year label')).toBeDisabled();
        // The draft is still on this device while the commit is in flight.
        expect(stored().reconciliationId).toBe('rec_fixed');
        await act(async () => { pending.resolve(); });
        await screen.findByText('Dashboard page');
    });

    it('Retry applies the current Start gate: an edit Start would reject turns Retry off and sends nothing (#609 review)', async () => {
        const user = userEvent.setup();
        const service = fakeService({ createYear: vi.fn().mockRejectedValue(codeError(COMMIT_CODES.COMMIT_FAILED)) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        const alert = (await screen.findByText('2027 was not created.')).closest('[role="alert"]');
        const label = screen.getByLabelText('New billing year label');
        await user.clear(label);
        await user.type(label, '2027-28');
        expect(within(alert).getByRole('button', { name: 'Retry' })).toBeDisabled();
        expect(within(screen.getByTestId('start-blockers')).getByText(/Use a four-digit year/)).toBeInTheDocument();
        // Even a click that reaches the handler (e.g. a stale render) sends nothing.
        fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
        expect(service.createYear).toHaveBeenCalledTimes(1);
        await user.clear(label);
        await user.type(label, '2027');
        expect(within(alert).getByRole('button', { name: 'Retry' })).toBeEnabled();
    });

    it('COMMIT_FAILED: nothing saved, the draft kept, Retry sends the same payload', async () => {
        const user = userEvent.setup();
        const service = fakeService({ createYear: vi.fn().mockRejectedValueOnce(codeError(COMMIT_CODES.COMMIT_FAILED)).mockResolvedValueOnce(undefined) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        const alert = await screen.findByText('2027 was not created.');
        expect(alert.closest('[role="alert"]')).toHaveTextContent('Nothing was saved and your draft is kept.');
        expect(stored().reconciliationId).toBe('rec_fixed');
        expect(within(alert.closest('[role="alert"]')).getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Dashboard page');
        expect(service.createYear).toHaveBeenCalledTimes(2);
        expect(service.createYear.mock.calls[1][1].reconciliation).toEqual(service.createYear.mock.calls[0][1].reconciliation);
    });

    it('COMMIT_FAILED offline says so', async () => {
        const user = userEvent.setup();
        fakeService({ createYear: vi.fn().mockRejectedValue(codeError(COMMIT_CODES.COMMIT_FAILED, { offline: true })) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        expect(await screen.findByText(/You’re offline\. Nothing was saved; your draft is kept\./)).toBeInTheDocument();
    });

    it('NEXT_YEAR_EXISTS from another reconciliation: created elsewhere, draft kept, Open 2027 or Discard draft', async () => {
        const user = userEvent.setup();
        const service = fakeService({ createYear: vi.fn().mockRejectedValue(codeError(COMMIT_CODES.NEXT_YEAR_EXISTS, { resolution: 'elsewhere',
            existing: { reconciliationId: 'rec_other', payloadFingerprint: 'yrp1_other', createdAt: '2026-12-08T15:12:00' } })) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        const alert = (await screen.findByText('2027 already exists.')).closest('[role="alert"]');
        expect(alert).toHaveTextContent('started elsewhere at 3:12 PM, so nothing was changed here and your draft is kept');
        expect(stored().reconciliationId).toBe('rec_fixed');
        expect(startButton()).toBeNull();
        await user.click(within(alert).getByRole('button', { name: 'Open 2027' }));
        await screen.findByText('Dashboard page');
        expect(service.switchYear).toHaveBeenCalledWith('2027');
        // Opening the other year never clears this draft.
        expect(stored().reconciliationId).toBe('rec_fixed');
    });

    it('created elsewhere, then Discard draft clears the draft and leaves without committing', async () => {
        const user = userEvent.setup();
        const service = fakeService({ createYear: vi.fn().mockRejectedValue(codeError(COMMIT_CODES.NEXT_YEAR_EXISTS, { resolution: 'elsewhere', existing: null })) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        const alert = (await screen.findByText('2027 already exists.')).closest('[role="alert"]');
        await user.click(within(alert).getByRole('button', { name: 'Discard draft' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard draft' }));
        await screen.findByText('Dashboard page');
        expect(window.localStorage.getItem(KEY)).toBeNull();
        expect(service.createYear).toHaveBeenCalledTimes(1);
    });

    it('NEXT_YEAR_EXISTS with this draft’s id and a different payload: started on another tab with different entries; draft kept', async () => {
        const user = userEvent.setup();
        fakeService({ createYear: vi.fn().mockRejectedValue(codeError(COMMIT_CODES.NEXT_YEAR_EXISTS, { resolution: 'diverged',
            existing: { reconciliationId: 'rec_fixed', payloadFingerprint: 'yrp1_different', createdAt: '2026-12-08T15:12:00.000Z',
                summary: { trueUpCount: 2, serviceCreditCount: 1, coveredCount: 0, usageChargeCount: 0, priceChangeCount: 2, endedCount: 1, newBillCount: 0 } } })) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        const alert = (await screen.findByText(/started from this draft on another tab with different entries/)).closest('[role="alert"]');
        expect(alert).toHaveTextContent('True-ups: 2 there, 3 in this draft');
        expect(alert).toHaveTextContent('new subscriptions: 0 there, 1 in this draft');
        expect(within(alert).getByRole('button', { name: 'Open 2027' })).toBeInTheDocument();
        expect(stored().reconciliationId).toBe('rec_fixed');
    });

    it('the destination is this draft’s own rollover (resolves already_completed): clear the draft and leave, no second commit', async () => {
        const user = userEvent.setup();
        // #607's service has already switched years when it resolves a completed outcome.
        const service = fakeService({ createYear: vi.fn(async () => {
            mocks.state = { ...mocks.state, activeYear: { id: '2027', label: '2027', status: 'open' } };
            return { outcome: 'already_completed', yearId: '2027' };
        }) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        await screen.findByText('Dashboard page');
        expect(window.localStorage.getItem(KEY)).toBeNull();
        expect(service.switchYear).not.toHaveBeenCalled();
        expect(service.createYear).toHaveBeenCalledTimes(1);
    });

    it('NEXT_YEAR_EXISTS whose destination could not be read back is checked again, never called created elsewhere', async () => {
        const user = userEvent.setup();
        fakeService({ createYear: vi.fn().mockRejectedValue(codeError(COMMIT_CODES.NEXT_YEAR_EXISTS, { existing: null })) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        expect(await screen.findByText('We can’t tell yet whether 2027 was created.')).toBeInTheDocument();
        expect(screen.queryByText('2027 already exists.')).toBeNull();
        expect(stored().reconciliationId).toBe('rec_fixed');
    });

    it('STALE_SOURCE: nothing saved, nothing reloaded in place; Reload is offered, and after it Step 4 is checked again before Start', async () => {
        const user = userEvent.setup();
        const onReload = vi.fn();
        const service = fakeService({ createYear: vi.fn().mockRejectedValueOnce(codeError(COMMIT_CODES.STALE_SOURCE)).mockResolvedValueOnce(undefined) });
        seedWireframe();
        const page = (reload = onReload) => render(
            <MemoryRouter initialEntries={['/year-end-review']}>
                <ToastProvider>
                    <Routes>
                        <Route path="/year-end-review" element={<YearEndReviewView onReload={reload} />} />
                        <Route path="/dashboard" element={<p>Dashboard page</p>} />
                    </Routes>
                </ToastProvider>
            </MemoryRouter>
        );
        const first = page();
        await openStep4(user);
        await user.click(startButton());
        const alert = (await screen.findByText('2026 changed after this preview, so nothing was saved.')).closest('[role="alert"]');
        // The service does not reload the tab (unsaved edits elsewhere); neither does the page.
        expect(service.switchYear).not.toHaveBeenCalled();
        expect(startButton()).toBeDisabled();
        expect(screen.getAllByText('pending').length).toBeGreaterThan(0);
        expect(stored().reconciliationId).toBe('rec_fixed');
        await user.click(within(alert).getByRole('button', { name: 'Reload' }));
        expect(onReload).toHaveBeenCalledTimes(1);
        // The reload: today's source has a payment recorded on another device after the preview.
        first.unmount();
        mocks.state = { ...mocks.state, payments: [...mocks.state.payments, { id: 'pay_late', memberId: MEMBER.erik, amount: 25, type: 'payment', reversed: false, receivedAt: '2026-12-08' }] };
        page();
        expect(screen.getByText(/Draft from .* restored\./)).toBeInTheDocument();
        await openStep4(user);
        // Lindqvist's extra $25.00 now lowers what it carries; the figures are pending until checked.
        expect(household(MEMBER.erik).getByText('Carried +$30.00')).toBeInTheDocument();
        expect(startButton()).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'I’ve checked the updated figures' }));
        expect(screen.queryByText('pending')).toBeNull();
        await user.click(startButton());
        await screen.findByText('Dashboard page');
        // The second attempt carries the newly reviewed fingerprint, never a silently accepted one.
        expect(service.createYear.mock.calls[1][1].reconciliation.sourceFingerprint).not.toBe(service.createYear.mock.calls[0][1].reconciliation.sourceFingerprint);
    });

    it('COMMIT_UNCERTAIN, read back as not committed: Retry allowed; the draft kept', async () => {
        const user = userEvent.setup();
        fakeService({ createYear: vi.fn().mockRejectedValue(codeError(COMMIT_CODES.COMMIT_UNCERTAIN, { resolution: 'not_committed' })) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        const alert = (await screen.findByText(/a check found nothing was saved/)).closest('[role="alert"]');
        expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(stored().reconciliationId).toBe('rec_fixed');
    });

    it('a lost response read back as committed resolves completed: success', async () => {
        const user = userEvent.setup();
        fakeService({ createYear: vi.fn().mockResolvedValue({ outcome: 'completed', yearId: '2027' }) });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        await screen.findByText('Dashboard page');
        expect(window.localStorage.getItem(KEY)).toBeNull();
    });

    it('COMMIT_UNCERTAIN unresolved: no Retry, only Check again, which reads back through the service before anything else', async () => {
        const user = userEvent.setup();
        const service = fakeService({
            createYear: vi.fn()
                .mockRejectedValueOnce(codeError(COMMIT_CODES.COMMIT_UNCERTAIN))
                .mockResolvedValueOnce({ outcome: 'already_completed', yearId: '2027' }),
            _loadYearsList: vi.fn(async () => {})
        });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        const banner = (await screen.findByText('We can’t tell yet whether 2027 was created.')).closest('[role="alert"]');
        expect(within(banner).queryByRole('button', { name: 'Retry' })).toBeNull();
        expect(stored().reconciliationId).toBe('rec_fixed');
        // The years list now shows 2027, which may be this draft's own: the page does not call it
        // "created elsewhere" from the list; the service reads the destination and classifies it.
        service._loadYearsList.mockImplementation(async () => {
            mocks.state = { ...mocks.state, billingYears: [...mocks.state.billingYears, { id: '2027', label: '2027', status: 'open' }] };
        });
        await user.click(within(banner).getByRole('button', { name: 'Check again' }));
        await screen.findByText('Dashboard page');
        expect(service.createYear).toHaveBeenCalledTimes(2);
        expect(window.localStorage.getItem(KEY)).toBeNull();
    });
});

describe('Step 4 — the guard and Start’s gate', () => {
    it('a later year created during the flow is detected at Start, before any commit', async () => {
        const user = userEvent.setup();
        const service = fakeService({
            _loadYearsList: vi.fn(async () => {
                mocks.state = { ...mocks.state, billingYears: [...mocks.state.billingYears, { id: '2028', label: '2028', status: 'open' }] };
            })
        });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        expect(await screen.findByText('2028 already exists.')).toBeInTheDocument();
        expect(service._loadYearsList).toHaveBeenCalledTimes(1);
        expect(service.createYear).not.toHaveBeenCalled();
        expect(stored().reconciliationId).toBe('rec_fixed');
    });

    it('the destination created during the flow is classified by the service (never short-circuited from the years list)', async () => {
        const user = userEvent.setup();
        const service = fakeService({
            _loadYearsList: vi.fn(async () => {
                mocks.state = { ...mocks.state, billingYears: [...mocks.state.billingYears, { id: '2027', label: '2027', status: 'open' }] };
            }),
            createYear: vi.fn().mockRejectedValue(codeError(COMMIT_CODES.NEXT_YEAR_EXISTS, { resolution: 'elsewhere',
                existing: { reconciliationId: 'rec_other', payloadFingerprint: 'yrp1_other', createdAt: '2026-12-08T15:12:00' } }))
        });
        seedWireframe();
        routedPage();
        await openStep4(user);
        await user.click(startButton());
        expect(await screen.findByText('2027 already exists.')).toBeInTheDocument();
        expect(service._loadYearsList).toHaveBeenCalledTimes(1);
        expect(service.createYear).toHaveBeenCalledTimes(1);
        expect(stored().reconciliationId).toBe('rec_fixed');
    });

    it('at entry, a successor with a draft on this device: says so, keeps the draft, offers Open and Discard', async () => {
        const user = userEvent.setup();
        const service = fakeService();
        seedWireframe();
        mocks.state.billingYears = [{ id: '2026', label: '2026', status: 'settling' }, { id: '2027', label: '2027', status: 'open' }];
        routedPage();
        const alert = screen.getByText('2027 already exists.').closest('[role="alert"]');
        expect(alert).toHaveTextContent('your draft is kept');
        expect(screen.queryByRole('heading', { name: 'Bills' })).toBeNull();
        await user.click(within(alert).getByRole('button', { name: 'Discard draft' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard draft' }));
        expect(window.localStorage.getItem(KEY)).toBeNull();
        expect(screen.getByText(/Record new charges, credits and refunds in the open 2027 year/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Open 2027' }));
        await screen.findByText('Dashboard page');
        expect(service.switchYear).toHaveBeenCalledWith('2027');
        expect(service.createYear).not.toHaveBeenCalled();
    });

    it('a restored stale draft: the cleared answer stops Next, answered it reaches Step 4 with figures pending and Start off until confirmed', async () => {
        const user = userEvent.setup();
        mocks.state = yearEndState({ credits: true });
        const records = pineconeCredits();
        const base = computeEnded(mocks.state.bills.find(bill => bill.id === BILL.pv), PINECONE, { sourceYear: '2026', skipExistingCredits: true });
        const answer = (record, choice, extra = {}) => ({ choice, ...extra, seen: snapshotExistingCredit(record),
            coverage: { basis: 'ended', frequency: 'annual', fromAmount: 60, toAmount: null, firstMonth: null, lastMonth: '2026-08', override: null,
                shareCents: base.shares.find(share => share.memberId === record.memberId).shareCents } });
        const existingCredits = Object.fromEntries(records.map(record => [record.id, answer(record, 'unrelated')]));
        // Rosa's October record was changed after the draft was saved: its answer no longer matches.
        existingCredits.oadj_sc_rosa_oct.seen = { ...existingCredits.oadj_sc_rosa_oct.seen, amountCents: 500 };
        fakeService();
        seedDraft({ bills: { [BILL.pv]: { ...PINECONE, existingCredits } } }, { fingerprint: 'yer1_saved_before' });
        renderPage();
        expect(nextButton()).toBeDisabled();
        const row = billRow(BILL.pv);
        const groups = row.getAllByRole('group').filter(group => /Rosa/.test(group.getAttribute('aria-label') || '') && /Oct/.test(group.getAttribute('aria-label') || ''));
        await user.click(within(groups[0]).getByRole('button', { name: 'Unrelated' }));
        expect(nextButton()).toBeEnabled();
        await openStep4(user);
        expect(screen.getAllByText('pending').length).toBeGreaterThan(0);
        const blockers = within(screen.getByTestId('start-blockers'));
        expect(blockers.getByText(/The figures above were recomputed from today’s data/)).toBeInTheDocument();
        expect(startButton()).toBeDisabled();
        await user.click(blockers.getByRole('button', { name: 'I’ve checked the updated figures' }));
        expect(screen.queryByText('pending')).toBeNull();
        expect(startButton()).toBeEnabled();
    });

    it('an existing-credit answer cleared while on Step 4: Start off with the record listed and a link to Step 1; answered again, Start on', async () => {
        const user = userEvent.setup();
        mocks.state = yearEndState({ credits: true });
        fakeService();
        const records = pineconeCredits();
        const base = computeEnded(mocks.state.bills.find(bill => bill.id === BILL.pv), PINECONE, { sourceYear: '2026', skipExistingCredits: true });
        const coverage = record => ({ basis: 'ended', frequency: 'annual', fromAmount: 60, toAmount: null, firstMonth: null, lastMonth: '2026-08', override: null,
            shareCents: base.shares.find(share => share.memberId === record.memberId).shareCents });
        const existingCredits = Object.fromEntries(records.map(record => [record.id, { choice: 'unrelated', seen: snapshotExistingCredit(record), coverage: coverage(record) }]));
        seedDraft({ bills: { [BILL.pv]: { ...PINECONE, existingCredits } } });
        const view = renderPage();
        await openStep4(user);
        expect(startButton()).toBeEnabled();
        // Dede's March record is voided and re-recorded at a new amount by another surface.
        mocks.state = { ...mocks.state, owedAdjustments: mocks.state.owedAdjustments.map(record => (record.id === 'oadj_sc_dede_mar' ? { ...record, amount: 8 } : record)) };
        view.rerender(<MemoryRouter><ToastProvider><YearEndReviewView /></ToastProvider></MemoryRouter>);
        expect(startButton()).toBeDisabled();
        const blockers = within(screen.getByTestId('start-blockers'));
        expect(blockers.getByText(/Say whether Dede Osei’s \$8\.00 credit from Mar 14, 2026 covers this change\./)).toBeInTheDocument();
        await user.click(blockers.getAllByRole('button', { name: 'Go to Step 1: Bills' })[0]);
        const groups = billRow(BILL.pv).getAllByRole('group').filter(group => /Dede/.test(group.getAttribute('aria-label') || '') && /Mar/.test(group.getAttribute('aria-label') || ''));
        await user.click(within(groups[0]).getByRole('button', { name: 'Unrelated' }));
        await openStep4(user);
        await user.click(screen.getByRole('button', { name: 'I’ve checked the updated figures' }));
        expect(startButton()).toBeEnabled();
    });

    it('Start stays off, and nothing is sent, until the service has the commit guard (#607)', async () => {
        const user = userEvent.setup();
        const service = fakeService({ reviewedCommitGuard: undefined });
        seedWireframe();
        renderPage();
        await openStep4(user);
        expect(within(screen.getByTestId('start-blockers')).getByText(/cannot yet check, in the same step as the write/)).toBeInTheDocument();
        expect(startButton()).toBeDisabled();
        // A release precondition, not a figure problem: the figures are final.
        expect(screen.queryByText('pending')).toBeNull();
        expect(service._loadYearsList).not.toHaveBeenCalled();
        expect(service.createYear).not.toHaveBeenCalled();
    });

    it('under StrictMode a failed Start still unlocks the page and reports the outcome', async () => {
        const user = userEvent.setup();
        fakeService({ createYear: vi.fn().mockRejectedValue(codeError(COMMIT_CODES.COMMIT_FAILED, { offline: true })) });
        seedWireframe();
        render(<StrictMode><MemoryRouter><ToastProvider><YearEndReviewView /></ToastProvider></MemoryRouter></StrictMode>);
        await openStep4(user);
        await user.click(startButton());
        expect(await screen.findByText(/You’re offline\. Nothing was saved; your draft is kept\./)).toBeInTheDocument();
        expect(screen.queryByText('Locked while 2027 starts')).toBeNull();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    });

    it('an amount outside the exact cent range is a field error, not a crash', async () => {
        seedDraft({ bills: { [BILL.nl]: { ...NORTHLINE, override: 100000000000000 } } });
        renderPage();
        expect(billRow(BILL.nl).getByText('Enter a smaller amount.')).toBeInTheDocument();
        expect(nextButton()).toBeDisabled();
    });

    it('Start waits for the refund notices so a re-opened refund never carries', async () => {
        const user = userEvent.setup();
        fakeService();
        mocks.notices = { refundNotices: [], loading: true, error: null };
        seedWireframe();
        renderPage();
        await openStep4(user);
        expect(within(screen.getByTestId('start-blockers')).getByText('Loading refund notices…')).toBeInTheDocument();
        expect(startButton()).toBeDisabled();
    });
});

describe('Step 4 — Nothing changed', () => {
    it('requires all three confirmations, still lists what carries, and Start writes no new charges or credits', async () => {
        const user = userEvent.setup();
        mocks.state = wireframeReviewState();
        const service = fakeService();
        routedPage();
        await user.click(screen.getByRole('button', { name: 'Nothing changed…' }));
        const dialog = within(screen.getByRole('dialog'));
        const go = dialog.getByRole('button', { name: 'Review & start 2027' });
        expect(go).toBeDisabled();
        await user.click(dialog.getByLabelText('No 2026 bill changed price or ended'));
        await user.click(dialog.getByLabelText('No new subscriptions started in 2026'));
        expect(go).toBeDisabled();
        await user.click(dialog.getByLabelText('No additional member charges'));
        await user.click(go);
        expect(stored().confirmations).toEqual({ noBillChanges: true, noNewSubscriptions: true, noExtraCharges: true });
        expect(screen.getByText('Nothing changed in 2026.')).toBeInTheDocument();
        const figures = within(screen.getByTestId('review-figures'));
        expect(figures.getAllByText('$2,844.00')).toHaveLength(2);
        expect(figures.getByText('+$22.50')).toBeInTheDocument();
        expect(household(MEMBER.ada).getByText('Carried −$22.00')).toBeInTheDocument();
        expect(household(MEMBER.erik).getByText('Carried +$30.00')).toBeInTheDocument();
        expect(household(MEMBER.kenji).getByText('Carried +$50.50')).toBeInTheDocument();
        expect(household(MEMBER.rosa).getByText('Carried −$36.00')).toBeInTheDocument();
        expect(household(MEMBER.sam).getByText('Carried none')).toBeInTheDocument();
        await user.click(household(MEMBER.kenji).getByRole('button', { name: /Show details/ }));
        expect(household(MEMBER.kenji).getByText('International calls (Aug 2)')).toBeInTheDocument();
        expect(household(MEMBER.kenji).getByText('Roaming overage—Lisbon trip (Jul 14)')).toBeInTheDocument();
        const statement = within(screen.getByTestId('start-statement'));
        expect(statement.getByText('No new charges or credits are written to 2026.')).toBeInTheDocument();
        expect(statement.getByText('Carry 3 member charges already recorded, once.')).toBeInTheDocument();
        expect(statement.getByText('Keep 5 bills at their 2026 prices.')).toBeInTheDocument();
        expect(statement.getByText('Carry a balance for 4 households.')).toBeInTheDocument();
        await user.click(startButton());
        await screen.findByText('Dashboard page');
        const { reconciliation } = service.createYear.mock.calls[0][1];
        expect(reconciliation).toMatchObject({ trueUps: [], serviceCredits: [], newBills: [], endedBillIds: [], billOverrides: {},
            confirmations: { noBillChanges: true, noNewSubscriptions: true, noExtraCharges: true } });
        // Prefilled deferred charges are reused once by id, never re-recorded.
        expect(reconciliation.usageCharges).toEqual([{ existingAdjustmentId: 'oadj_maja_fee' }, { existingAdjustmentId: 'oadj_dede_roam' }, { existingAdjustmentId: 'oadj_kenji_calls' }]);
    });

    it('Next on Steps 1–3 is not gated on the confirmations; the fast path is offered only while nothing is entered', async () => {
        const user = userEvent.setup();
        fakeService();
        mocks.state = wireframeReviewState();
        const first = renderPage();
        expect(screen.getByRole('button', { name: 'Nothing changed…' })).toBeInTheDocument();
        // None of the three confirmations is given, and Next still steps through.
        await user.click(nextButton());
        expect(screen.getByRole('heading', { name: 'New subscriptions' })).toBeInTheDocument();
        expect(nextButton()).toBeEnabled();
        first.unmount();
        window.localStorage.clear();
        seedDraft({ bills: { [BILL.nl]: NORTHLINE } });
        renderPage();
        expect(screen.queryByRole('button', { name: 'Nothing changed…' })).toBeNull();
    });
});
