import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Year-End Review page, Steps 1–3 (#608): rows, validation, the existing-credit
// answers, the local draft (save, restore, refuse, stale, unavailable) and the
// Step 3 composer. The math itself is tested in tests/react/lib/year-end-review.test.js.

const mocks = vi.hoisted(() => ({ state: null, user: { uid: 'owner-uid', email: 'owner@example.com' } }));

vi.mock('@/app/hooks/useBillingData.js', () => ({ useBillingData: () => ({ ...mocks.state, service: {} }) }));
vi.mock('@/app/contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: mocks.user, loading: false }) }));

import YearEndReviewView from '@/app/views/YearEndReview/YearEndReviewView.jsx';
import { createDraft, draftStorageKey, fingerprintOf, snapshotExistingCredit, snapshotStorageKey, sourceCounts } from '@/app/views/YearEndReview/yearEndReviewModel.js';
import { computeEnded } from '@/lib/year-end-review.js';
import { BILL, MEMBER, pineconeCredits, yearEndState } from '../helpers/yearEndReviewFixture.js';

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
const renderPage = () => render(<MemoryRouter><YearEndReviewView /></MemoryRouter>);
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

    it('ends with a disabled Review & start footer until Step 4 lands', async () => {
        const user = userEvent.setup();
        renderPage();
        await openCharges(user);
        expect(screen.getByRole('button', { name: /Review & start 2027/ })).toBeDisabled();
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

    it('refuses an archived year', () => {
        mocks.state.activeYear = { id: '2026', label: '2026', status: 'archived' };
        renderPage();
        expect(screen.getByText('2026 is archived')).toBeInTheDocument();
    });
});
