// Cloud Functions unit coverage — pure helpers from functions/billing.js and the
// functions/index.js `_testHelpers` export. Imports the modules directly (no VM
// bundle, no script.js): the share-summary/charge/credit math behind resolveShareToken
// and the submitDispute / submitRefundConfirmation validators.
//
// Migrated from the former tests/billing.test.js when the legacy /site/ app was
// retired (#326). The legacy script.js VM tests were dropped with the app; the
// equivalent client behavior is covered under tests/react/.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    computeMemberSummary,
    buildPendingChargesForShare,
    projectMemberDisputes,
    getServiceCreditTotalForMember,
    getHouseholdOpeningBalance,
} = require(path.join(__dirname, '..', 'functions', 'billing'));

const { _testHelpers } = require(path.join(__dirname, '..', 'functions', 'index'));
const {
    validateToken,
    validateDisputeInput,
    validateRefundConfirmationInput,
    filterMemberRefundNotices,
    REFUND_NOTICE_KIND,
    DISPUTE_RATE_LIMIT,
    EVIDENCE_URL_EXPIRY_MS,
    LINK_REQUEST_RATE_WINDOW_MS,
} = _testHelpers;

// ──────────────── computeMemberSummary ───────────────────────

describe('computeMemberSummary', () => {
    const members = [
        { id: 1, name: 'Alice', email: '', linkedMembers: [] },
        { id: 2, name: 'Bob', email: '', linkedMembers: [] },
    ];

    it('computes correct summary for a member in a shared bill', () => {
        const bills = [
            { id: 42, name: 'Internet', amount: 120, members: [1, 2] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.name, 'Alice');
        assert.equal(result.annualTotal, 720);
        assert.equal(result.monthlyTotal, 60);
        assert.equal(result.bills.length, 1);
        assert.equal(result.bills[0].splitCount, 2);
        assert.equal(result.bills[0].monthlyShare, 60);
        assert.equal(result.bills[0].annualShare, 720);
    });

    it('includes billId in the summary output', () => {
        const bills = [
            { id: 99, name: 'Netflix', amount: 20, members: [1] },
            { id: 100, name: 'Hulu', amount: 15, members: [1, 2] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.bills[0].billId, 99);
        assert.equal(result.bills[1].billId, 100);
    });

    it('returns null for a non-existent member', () => {
        const bills = [];
        const result = computeMemberSummary(members, bills, 999);
        assert.equal(result, null);
    });

    it('returns zero totals when member has no bills', () => {
        const bills = [
            { name: 'Netflix', amount: 20, members: [2] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 0);
        assert.equal(result.monthlyTotal, 0);
        assert.equal(result.bills.length, 0);
    });

    it('accumulates across multiple bills', () => {
        const bills = [
            { name: 'A', amount: 10, members: [1] },
            { name: 'B', amount: 30, members: [1, 2] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 10 * 12 + 15 * 12);
        assert.equal(result.bills.length, 2);
    });

    it('ignores bills with empty members array', () => {
        const bills = [
            { name: 'Orphan', amount: 100, members: [] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 0);
    });
});

describe('computeMemberSummary with billing frequency', () => {
    it('treats annual bills correctly (amount IS the annual total)', () => {
        const members = [{ id: 1, name: 'Alice', email: '', linkedMembers: [] }];
        const bills = [{ id: 1, name: 'Insurance', amount: 1200, billingFrequency: 'annual', members: [1] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 1200);
        assert.equal(result.monthlyTotal, 100);
        assert.equal(result.bills[0].annualShare, 1200);
        assert.equal(result.bills[0].monthlyShare, 100);
        assert.equal(result.bills[0].monthlyAmount, 100);
    });

    it('treats monthly bills correctly (amount * 12 = annual)', () => {
        const members = [{ id: 1, name: 'Alice', email: '', linkedMembers: [] }];
        const bills = [{ id: 1, name: 'Netflix', amount: 20, billingFrequency: 'monthly', members: [1] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 240);
        assert.equal(result.monthlyTotal, 20);
        assert.equal(result.bills[0].annualShare, 240);
        assert.equal(result.bills[0].monthlyShare, 20);
    });

    it('defaults to monthly when billingFrequency is missing', () => {
        const members = [{ id: 1, name: 'Alice', email: '', linkedMembers: [] }];
        const bills = [{ id: 1, name: 'Utility', amount: 50, members: [1] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 600);
        assert.equal(result.monthlyTotal, 50);
    });

    it('splits annual bills correctly among multiple members', () => {
        const members = [
            { id: 1, name: 'Alice', email: '', linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', linkedMembers: [] },
        ];
        const bills = [{ id: 1, name: 'Insurance', amount: 2400, billingFrequency: 'annual', members: [1, 2] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 1200);
        assert.equal(result.monthlyTotal, 100);
    });

    it('includes billingFrequency and canonicalAmount in bill output', () => {
        const members = [{ id: 1, name: 'Alice', email: '', linkedMembers: [] }];
        const bills = [{ id: 1, name: 'Annual Sub', amount: 120, billingFrequency: 'annual', members: [1] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.bills[0].billingFrequency, 'annual');
        assert.equal(result.bills[0].canonicalAmount, 120);
    });
});

// ──────────────── buildPendingChargesForShare (#317) ─────────

describe('buildPendingChargesForShare', () => {
    const familyMembers = [
        { id: 1, name: 'Alice', linkedMembers: [3] },
        { id: 2, name: 'Bob', linkedMembers: [] },
        { id: 3, name: 'Carol', linkedMembers: [] },
    ];
    const owedAdjustments = [
        { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred', description: 'Roaming', incurredDate: '2025-02-01' },
        { id: 'o2', memberId: 3, kind: 'usage_charge', amount: 5, status: 'deferred', description: 'Add-on', incurredDate: '2025-01-10' },
        { id: 'o3', memberId: 2, kind: 'usage_charge', amount: 99, status: 'deferred', description: 'Other', incurredDate: '2025-01-01' },
        { id: 'o4', memberId: 1, kind: 'usage_charge', amount: 77, status: 'voided', description: 'Voided', incurredDate: '2025-01-05' },
        { id: 'o5', memberId: 1, kind: 'usage_charge', amount: 50, status: 'billed', description: 'Billed', incurredDate: '2025-01-06' },
    ];

    it('returns the member own deferred charges only, sorted with running totals', () => {
        const result = buildPendingChargesForShare(familyMembers, owedAdjustments, 1);
        // Per-member (ADR 0005): Alice's own deferred only; Carol's o2 is on Carol's share.
        assert.deepEqual(result.charges.map((c) => c.id), ['o1']);
        assert.equal(result.count, 1);
        assert.ok(Math.abs(result.total - 10) < 1e-9);
        assert.ok(Math.abs(result.charges[0].runningTotal - 10) < 1e-9);
    });

    it('a linked member sees only their own deferred charges (ADR 0005)', () => {
        const result = buildPendingChargesForShare(familyMembers, owedAdjustments, 3);
        assert.deepEqual(result.charges.map((c) => c.id), ['o2']);
        assert.equal(result.count, 1);
    });

    it('excludes voided and billed charges', () => {
        const result = buildPendingChargesForShare(familyMembers, owedAdjustments, 1);
        const ids = result.charges.map((c) => c.id);
        assert.ok(!ids.includes('o4'));
        assert.ok(!ids.includes('o5'));
    });

    it('returns empty for an unknown member', () => {
        const result = buildPendingChargesForShare(familyMembers, owedAdjustments, 999);
        assert.deepEqual(result.charges, []);
        assert.equal(result.count, 0);
        assert.equal(result.total, 0);
    });

    it('tolerates a missing owedAdjustments array', () => {
        const result = buildPendingChargesForShare(familyMembers, undefined, 1);
        assert.deepEqual(result.charges, []);
        assert.equal(result.count, 0);
    });
});

// ──────── projectMemberDisputes (#320) ────────
//
// resolveShareToken projects the member's disputes for the share view. Charge
// Notices (#320) ride the same `disputes` subcollection but are outbound Requests,
// so they must be excluded from the disputes:read projection the same way useDisputes
// excludes them client-side (ADR 0002, ADR 0005). The member contests a charge via a
// Review Request, not by seeing the Charge Notice as one.

describe('projectMemberDisputes (#320)', () => {
    function tsDoc(obj) {
        // Emulate a Firestore doc snapshot with createdAt as a Timestamp-like value.
        return obj;
    }

    it('excludes charge_notice docs from the disputes projection', () => {
        const docs = [
            tsDoc({ id: 'd1', billId: 5, billName: 'Internet', message: 'Wrong', status: 'open' }),
            tsDoc({ id: 'cn1', kind: 'charge_notice', amount: 25, status: 'open' }),
            tsDoc({ id: 'd2', billId: 6, billName: 'Phone', message: 'Also wrong', status: 'in_review' })
        ];
        const out = projectMemberDisputes(docs);
        const ids = out.map((d) => d.id);
        assert.ok(ids.includes('d1'));
        assert.ok(ids.includes('d2'));
        assert.ok(!ids.includes('cn1'));
    });

    it('normalizes legacy statuses and exposes member-safe review fields', () => {
        const docs = [
            { id: 'd1', billId: 5, billName: 'Internet', message: 'Hi', proposedCorrection: 'Fix', status: 'pending', userReview: { state: 'requested' } }
        ];
        const out = projectMemberDisputes(docs);
        assert.equal(out[0].status, 'open'); // pending → open
        assert.equal(out[0].billName, 'Internet');
        assert.equal(out[0].proposedCorrection, 'Fix');
        assert.deepEqual(out[0].userReview, { state: 'requested' });
    });

    it('tolerates an empty or missing input', () => {
        assert.deepEqual(projectMemberDisputes([]), []);
        assert.deepEqual(projectMemberDisputes(undefined), []);
    });
});

// ──────── getServiceCreditTotalForMember (#321) ────────
//
// resolveShareToken reduces the member-facing combinedAnnual by the household's
// active Service Credits, so the Cloud Function fallback (cache-miss / stale-refresh,
// self-healed back into publicShares) agrees with the React buildPublicShareData writer.
// This is the shared helper behind that.

describe('getServiceCreditTotalForMember (#321)', () => {
    it('sums active service_credit records for the member only', () => {
        const adj = [
            { id: 's1', memberId: 1, kind: 'service_credit', status: 'active', amount: 50 },
            { id: 's2', memberId: 1, kind: 'service_credit', status: 'active', amount: 20 },
            { id: 's3', memberId: 2, kind: 'service_credit', status: 'active', amount: 999 } // other member
        ];
        assert.equal(getServiceCreditTotalForMember(adj, 1), 70);
    });

    it('excludes voided credits and other owedAdjustment kinds', () => {
        const adj = [
            { id: 's1', memberId: 1, kind: 'service_credit', status: 'voided', amount: 999 },
            { id: 'u1', memberId: 1, kind: 'usage_charge', status: 'billed', amount: 999 },
            { id: 's2', memberId: 1, kind: 'service_credit', status: 'active', amount: 30 }
        ];
        assert.equal(getServiceCreditTotalForMember(adj, 1), 30);
    });

    it('drops non-finite, negative, and missing amounts (no coercion)', () => {
        const adj = [
            { id: 's1', memberId: 1, kind: 'service_credit', status: 'active', amount: NaN },
            { id: 's2', memberId: 1, kind: 'service_credit', status: 'active', amount: -5 },
            { id: 's3', memberId: 1, kind: 'service_credit', status: 'active' }, // missing
            { id: 's4', memberId: 1, kind: 'service_credit', status: 'active', amount: 12.5 }
        ];
        assert.equal(getServiceCreditTotalForMember(adj, 1), 12.5);
    });

    it('tolerates empty or missing input', () => {
        assert.equal(getServiceCreditTotalForMember([], 1), 0);
        assert.equal(getServiceCreditTotalForMember(undefined, 1), 0);
    });
});

// ──────── getHouseholdOpeningBalance (#322) ────────
//
// resolveShareToken folds the household's netted carried opening balance into the
// member-facing combinedAnnual (a carried credit lowers owed, a carried charge raises
// it), so the Cloud Function fallback agrees with the React buildPublicShareData writer
// and never self-heals an uncarried total. CommonJS mirror of the client
// getHouseholdOpeningBalance — SIGNED sum of carry_opening seeds across the household.

describe('getHouseholdOpeningBalance (#322)', () => {
    it('sums signed carry_opening seeds across the primary and linked members', () => {
        const member = { id: 1, linkedMembers: [2] };
        const adj = [
            { id: 'c1', memberId: 1, kind: 'carry_opening', amount: -80, status: 'carried_in' }, // carried credit
            { id: 'c2', memberId: 2, kind: 'carry_opening', amount: 30, status: 'carried_in' },  // carried charge
            { id: 'c3', memberId: 9, kind: 'carry_opening', amount: 500, status: 'carried_in' }  // other household
        ];
        assert.equal(getHouseholdOpeningBalance(member, adj), -50); // −80 + 30
    });

    it('excludes voided seeds and other owedAdjustment kinds', () => {
        const member = { id: 1, linkedMembers: [] };
        const adj = [
            { id: 'c1', memberId: 1, kind: 'carry_opening', amount: -80, status: 'voided' },        // voided
            { id: 'u1', memberId: 1, kind: 'usage_charge', amount: 999, status: 'deferred' },        // not a seed
            { id: 's1', memberId: 1, kind: 'service_credit', amount: 999, status: 'active' },        // not a seed
            { id: 'c2', memberId: 1, kind: 'carry_opening', amount: 25, status: 'carried_in' }
        ];
        assert.equal(getHouseholdOpeningBalance(member, adj), 25);
    });

    it('keeps the sign (carried credit negative, carried charge positive)', () => {
        const credit = { id: 1, linkedMembers: [] };
        assert.equal(getHouseholdOpeningBalance(credit, [{ id: 'c', memberId: 1, kind: 'carry_opening', amount: -120, status: 'carried_in' }]), -120);
        assert.equal(getHouseholdOpeningBalance(credit, [{ id: 'c', memberId: 1, kind: 'carry_opening', amount: 40, status: 'carried_in' }]), 40);
    });

    it('drops non-finite amounts and tolerates empty / missing input', () => {
        const member = { id: 1, linkedMembers: [] };
        assert.equal(getHouseholdOpeningBalance(member, [{ id: 'c', memberId: 1, kind: 'carry_opening', amount: NaN, status: 'carried_in' }]), 0);
        assert.equal(getHouseholdOpeningBalance(member, []), 0);
        assert.equal(getHouseholdOpeningBalance(member, undefined), 0);
        assert.equal(getHouseholdOpeningBalance(undefined, []), 0);
    });
});

// ──────────────── submitDispute validation helpers ─────────────

describe('validateToken', () => {
    it('rejects null/undefined token', () => {
        assert.equal(validateToken(null).valid, false);
        assert.equal(validateToken(undefined).valid, false);
    });

    it('rejects non-string token', () => {
        assert.equal(validateToken(12345).valid, false);
        assert.equal(validateToken({}).valid, false);
    });

    it('rejects short tokens', () => {
        assert.equal(validateToken('abc').valid, false);
        assert.equal(validateToken('a'.repeat(31)).valid, false);
    });

    it('accepts valid 64-char hex token', () => {
        const token = 'a'.repeat(64);
        assert.equal(validateToken(token).valid, true);
    });

    it('accepts token of exactly 32 characters', () => {
        assert.equal(validateToken('x'.repeat(32)).valid, true);
    });
});

describe('validateDisputeInput', () => {
    const validInput = {
        billId: 1,
        billName: 'Internet',
        message: 'This amount seems wrong.',
        proposedCorrection: null,
    };

    it('accepts valid dispute input', () => {
        assert.equal(validateDisputeInput(validInput).valid, true);
    });

    it('rejects missing billId', () => {
        const result = validateDisputeInput({ ...validInput, billId: undefined });
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('bill'));
    });

    it('rejects non-numeric billId', () => {
        const result = validateDisputeInput({ ...validInput, billId: 'abc' });
        assert.equal(result.valid, false);
    });

    it('rejects missing billName', () => {
        const result = validateDisputeInput({ ...validInput, billName: '' });
        assert.equal(result.valid, false);
    });

    it('rejects missing message', () => {
        const result = validateDisputeInput({ ...validInput, message: '' });
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('message'));
    });

    it('rejects whitespace-only message', () => {
        const result = validateDisputeInput({ ...validInput, message: '   ' });
        assert.equal(result.valid, false);
    });

    it('rejects message exceeding 2000 characters', () => {
        const result = validateDisputeInput({ ...validInput, message: 'x'.repeat(2001) });
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('2000'));
    });

    it('accepts message of exactly 2000 characters', () => {
        const result = validateDisputeInput({ ...validInput, message: 'x'.repeat(2000) });
        assert.equal(result.valid, true);
    });

    it('rejects proposedCorrection exceeding 500 characters', () => {
        const result = validateDisputeInput({ ...validInput, proposedCorrection: 'x'.repeat(501) });
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('500'));
    });

    it('accepts proposedCorrection of exactly 500 characters', () => {
        const result = validateDisputeInput({ ...validInput, proposedCorrection: 'x'.repeat(500) });
        assert.equal(result.valid, true);
    });

    it('accepts null proposedCorrection', () => {
        const result = validateDisputeInput({ ...validInput, proposedCorrection: null });
        assert.equal(result.valid, true);
    });
});

describe('DISPUTE_RATE_LIMIT', () => {
    it('is set to a reasonable value', () => {
        assert.equal(typeof DISPUTE_RATE_LIMIT, 'number');
        assert.ok(DISPUTE_RATE_LIMIT > 0 && DISPUTE_RATE_LIMIT <= 100);
    });
});

describe('EVIDENCE_URL_EXPIRY_MS', () => {
    it('is 1 hour in milliseconds', () => {
        assert.equal(EVIDENCE_URL_EXPIRY_MS, 60 * 60 * 1000);
    });
});

describe('LINK_REQUEST_RATE_WINDOW_MS', () => {
    it('is 24 hours in milliseconds', () => {
        assert.equal(LINK_REQUEST_RATE_WINDOW_MS, 24 * 60 * 60 * 1000);
    });
});

// ──────────────── submitRefundConfirmation (#319) ─────────────────────
//
// The Refund Notice confirm/not_received path. Members never write Firestore
// directly — the submitRefundConfirmation Cloud Function records the outcome on
// the member's OWN refund_notice Request (ADR 0002, ADR 0005 per-member scope).

describe('REFUND_NOTICE_KIND (functions)', () => {
    it('matches the client substrate discriminator', () => {
        assert.equal(REFUND_NOTICE_KIND, 'refund_notice');
    });
});

describe('validateRefundConfirmationInput', () => {
    it('accepts confirm with a valid notice id', () => {
        const r = validateRefundConfirmationInput({ noticeId: 'abc', outcome: 'confirm' });
        assert.equal(r.valid, true);
    });

    it('accepts not_received with a valid notice id', () => {
        const r = validateRefundConfirmationInput({ noticeId: 'abc', outcome: 'not_received' });
        assert.equal(r.valid, true);
    });

    it('rejects a missing notice id', () => {
        const r = validateRefundConfirmationInput({ noticeId: '', outcome: 'confirm' });
        assert.equal(r.valid, false);
        assert.equal(r.status, 400);
    });

    it('rejects a non-string notice id', () => {
        assert.equal(validateRefundConfirmationInput({ noticeId: 123, outcome: 'confirm' }).valid, false);
    });

    it('rejects an unknown outcome (no arbitrary field writes)', () => {
        const r = validateRefundConfirmationInput({ noticeId: 'abc', outcome: 'approved_by_user' });
        assert.equal(r.valid, false);
    });

    it('rejects a missing outcome', () => {
        assert.equal(validateRefundConfirmationInput({ noticeId: 'abc' }).valid, false);
    });
});

describe('filterMemberRefundNotices', () => {
    // ADR 0005 lesson: a member sees only THEIR OWN refund notices — never the
    // whole household. A refund is issued to the primary, so it appears on the
    // primary's share only.
    const docs = [
        { id: 'n1', kind: 'refund_notice', memberId: 1, amount: 100 },
        { id: 'n2', kind: 'refund_notice', memberId: 2, amount: 50 },
        { id: 'd1', memberId: 1, billId: 9, message: 'review request' }, // a Review Request (no kind)
        { id: 'n3', kind: 'refund_notice', memberId: 1, amount: 25 },
    ];

    it('returns only refund_notice docs for the token member', () => {
        const out = filterMemberRefundNotices(docs, 1);
        const ids = out.map(d => d.id).sort();
        assert.deepEqual(ids, ['n1', 'n3']);
    });

    it('excludes other members notices (no household expansion)', () => {
        const out = filterMemberRefundNotices(docs, 1);
        assert.ok(!out.some(d => d.memberId !== 1));
        assert.ok(!out.some(d => d.id === 'n2'));
    });

    it('excludes Review Requests (kind-less docs)', () => {
        const out = filterMemberRefundNotices(docs, 1);
        assert.ok(!out.some(d => d.id === 'd1'));
    });

    it('returns an empty array when the member has no notices', () => {
        assert.deepEqual(filterMemberRefundNotices(docs, 99), []);
    });

    it('projects only presentational fields (no tokenHash leak)', () => {
        const withToken = [{ id: 'n1', kind: 'refund_notice', memberId: 1, amount: 100, method: 'venmo', reason: 'Overpaid', confirmation: null, tokenHash: 'secret-hash' }];
        const out = filterMemberRefundNotices(withToken, 1);
        assert.equal(out.length, 1);
        assert.equal(out[0].tokenHash, undefined);
        assert.equal(out[0].amount, 100);
        assert.equal(out[0].reason, 'Overpaid');
        assert.equal(out[0].confirmation, null);
    });
});
