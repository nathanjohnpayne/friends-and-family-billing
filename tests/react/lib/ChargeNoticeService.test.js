import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firestore is only touched through the injected collaborators in these tests; we
// still mock the module so importing the service (which imports firebase) is safe.
vi.mock('@/lib/firebase.js', () => ({ db: {} }));

// Idempotent persistence (PR #328 r3447513514): the notice is written with a
// deterministic id keyed to chargeNoticeId via setDoc(doc(col, id)), so a retry
// overwrites the same doc instead of appending a duplicate. The mock records the
// doc ref id and the written payload.
const mockSetDoc = vi.fn(async () => undefined);
const mockDoc = vi.fn((colRef, id) => ({ parent: colRef, id }));
const mockCollection = vi.fn((_db, ...segs) => ({ path: segs.join('/') }));
vi.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    doc: (...args) => mockDoc(...args),
    setDoc: (...args) => mockSetDoc(...args),
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    getDocs: vi.fn(), getDoc: vi.fn(), writeBatch: vi.fn(), runTransaction: vi.fn()
}));

import { issueChargeNotice } from '@/lib/ChargeNoticeService.js';
import { BillingYearService } from '@/lib/BillingYearService.js';

import { summarizeChargePreview, buildChargeNoticeDoc } from '@/lib/chargeNotice.js';
import { getHouseholdFinancials } from '@/lib/calculations.js';

const baseOpts = () => ({
    userId: 'user-1',
    billingYearId: '2026',
    yearLabel: '2026',
    memberId: 1,
    memberName: 'Alice',
    memberEmail: 'alice@example.com',
    chargeNoticeId: 'cn_1',
    charges: [
        { id: 'o1', description: 'Roaming', amount: 10, incurredDate: '2026-06-03' },
        { id: 'o2', description: 'Overage', amount: 5, incurredDate: '2026-06-20' }
    ],
    familyMembers: [{ id: 1, name: 'Alice', linkedMembers: [] }],
    bills: [],
    payments: [],
    creditAdjustments: [],
    owedAdjustments: [],
    activeYear: { id: '2026', label: '2026' },
    settings: {}
});

describe('issueChargeNotice', () => {
    let createShareLink, queueEmailFn;

    beforeEach(() => {
        vi.clearAllMocks();
        createShareLink = vi.fn(async () => ({ url: 'https://example.com/share?token=xyz', tokenHash: 'hash-xyz', rawToken: 'xyz' }));
        queueEmailFn = vi.fn(async () => ({ id: 'mail-1' }));
    });

    it.each([.004, NaN, Infinity, '1'])('rejects zero/invalid selected %s before link/prune/doc/email side effects', async amount => {
        const opts = { ...baseOpts(), charges: [{ id: 'a', amount }] };
        await expect(issueChargeNotice(opts, { createShareLink, queueEmailFn })).rejects.toThrow();
        expect(createShareLink).not.toHaveBeenCalled();
        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(queueEmailFn).not.toHaveBeenCalled();
    });

    it('rejects a different malformed admitted household record before minting a link', async () => {
        const opts = { ...baseOpts(), creditAdjustments: [{ id: 'r', memberId: 1, amount: '1', type: 'refund', status: 'recorded' }] };
        await expect(issueChargeNotice(opts, { createShareLink, queueEmailFn })).rejects.toThrow(/unavailable/);
        expect(createShareLink).not.toHaveBeenCalled();
        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(queueEmailFn).not.toHaveBeenCalled();
    });

    it('sends allocated new snapshot rows, preserving raw charges', async () => {
        const opts = { ...baseOpts(), charges: ['a', 'b'].map(id => ({ id, description: id, amount: .005 })) };
        await issueChargeNotice(opts, { createShareLink, queueEmailFn });
        const doc = mockSetDoc.mock.calls[0][1];
        expect(doc.amount).toBe(.01);
        expect(doc.charges.map(row => row.amount)).toEqual([.01, 0]);
        expect(queueEmailFn.mock.calls[0][0].body).toContain('b: $0.00');
        expect(opts.charges.map(row => row.amount)).toEqual([.005, .005]);
    });

    it.each(['familyMembers', 'bills', 'payments', 'creditAdjustments', 'owedAdjustments'])(
        'rejects incomplete raw %s before transport', async field => {
            const opts = baseOpts();
            delete opts[field];
            await expect(issueChargeNotice(opts, { createShareLink, queueEmailFn })).rejects.toThrow(/unavailable/);
            expect(createShareLink).not.toHaveBeenCalled();
            expect(mockSetDoc).not.toHaveBeenCalled();
            expect(queueEmailFn).not.toHaveBeenCalled();
        });

    it.each([1.005, .005, .004])('shares one %s fixture across preview, billed event, document and email', async amount => {
        const opts = baseOpts();
        const charges = (amount === 1.005 ? ['a'] : ['a', 'b']).map(id => ({ id, memberId: 1,
            kind: 'usage_charge', status: 'deferred', amount, description: id, incurredDate: '2026-01-01' }));
        const service = new BillingYearService();
        service._setState({ activeYear: opts.activeYear, familyMembers: opts.familyMembers, owedAdjustments: charges });
        const preview = summarizeChargePreview(charges);
        const result = service.billDeferredCharges({ memberId: 1, chargeIds: charges.map(row => row.id) });
        const snapshot = service.getState();
        await issueChargeNotice({ ...opts, ...snapshot, ...result }, { createShareLink, queueEmailFn });
        const document = mockSetDoc.mock.calls[0][1];
        const expected = amount === 1.005 ? 1.01 : .01;
        expect(preview.total).toBe(expected);
        expect(result.amount).toBe(expected);
        expect(snapshot.billingEvents.at(-1).payload.amount).toBe(expected);
        expect(document.amount).toBe(expected);
        expect(document.charges).toEqual(preview.charges.map(({ id, description, amount, incurredDate }) => ({ id, description, amount, incurredDate })));
        expect(buildChargeNoticeDoc({ ...opts, charges }).charges).toEqual(document.charges);
        expect(preview.charges.at(-1).runningTotal).toBe(expected);
        let running = 0;
        for (const row of preview.charges) {
            running += Math.round(row.amount * 100);
            expect(row.runningTotal).toBe(running / 100);
            expect(queueEmailFn.mock.calls[0][0].body).toContain(`${row.description}: $${row.amount.toFixed(2)}`);
        }
        expect(queueEmailFn.mock.calls[0][0].subject).toContain(expected.toFixed(2));
        expect(snapshot.owedAdjustments.map(row => row.amount)).toEqual(charges.map(row => row.amount));
        if (amount === 1.005) expect(getHouseholdFinancials(snapshot.familyMembers[0], snapshot).cents.B).toBe(101);
    });

    it('freezes financial and identity presentation before awaiting link transport', async () => {
        const opts = baseOpts();
        opts.yearLabel = '';
        opts.charges = [{ id: 'a', amount: 1.005, description: 'Original charge', incurredDate: '2026-01-01' }];
        opts.settings = { paymentMethods: [{ id: 'cash', label: 'Original method' }] };
        let finish;
        createShareLink.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const pending = issueChargeNotice(opts, { createShareLink, queueEmailFn });
        expect(createShareLink).toHaveBeenCalledOnce();
        opts.charges[0].amount = 99;
        opts.charges[0].description = 'Changed charge';
        opts.memberName = 'Changed name';
        opts.memberEmail = 'changed@example.com';
        opts.activeYear.label = 'Changed year';
        opts.familyMembers[0].name = 'Changed member';
        opts.settings.paymentMethods[0].label = 'Changed method';
        finish({ url: 'https://example.com/frozen', tokenHash: 'frozen-hash' });
        await pending;
        const document = mockSetDoc.mock.calls[0][1];
        const mail = queueEmailFn.mock.calls[0][0];
        expect(document).toMatchObject({ memberName: 'Alice', amount: 1.01,
            charges: [{ description: 'Original charge', amount: 1.01 }] });
        expect(mail.to).toBe('alice@example.com');
        expect(mail.body).toContain('Original charge: $1.01');
        expect(mail.subject).toContain('2026');
        expect(mail.body).toContain('https://example.com/frozen');
        expect(mail.body).not.toContain('Changed');
        const link = createShareLink.mock.calls[0][0];
        expect(link.familyMembers[0].name).toBe('Alice');
        expect(link.activeYear.label).toBe('2026');
        expect(link.settings.paymentMethods[0].label).toBe('Original method');
    });

    it('writes a charge_notice doc to the disputes subcollection with the billed total', async () => {
        await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const [docRef, doc] = mockSetDoc.mock.calls[0];
        expect(docRef.parent.path).toBe('users/user-1/billingYears/2026/disputes');
        expect(doc.kind).toBe('charge_notice');
        expect(doc.memberId).toBe(1);
        expect(doc.amount).toBeCloseTo(15, 5);
        expect(doc.chargeNoticeId).toBe('cn_1');
        expect(doc.createdAt).toBe('SERVER_TS');
    });

    it('keys the doc to the chargeNoticeId so a retry overwrites rather than duplicates (idempotent)', async () => {
        // Two issuances for the same chargeNoticeId must target the SAME doc id, so a
        // retried Charge Notice cannot create a duplicate dispute doc.
        await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });
        await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });

        expect(mockSetDoc).toHaveBeenCalledTimes(2);
        expect(mockSetDoc.mock.calls[0][0].id).toBe('cn_1');
        expect(mockSetDoc.mock.calls[1][0].id).toBe('cn_1');
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['empty string', ''],
        ['whitespace', '   '],
        ['the literal "undefined"', 'undefined']
    ])('rejects a %s chargeNoticeId instead of writing to a collapsed doc id (CodeRabbit #369)', async (_label, badId) => {
        // A blank/absent chargeNoticeId would stringify to a shared key like "undefined"
        // and silently overwrite an unrelated dispute doc. The guard must throw and write
        // nothing rather than corrupt the disputes subcollection.
        const opts = { ...baseOpts(), chargeNoticeId: badId };
        await expect(issueChargeNotice(opts, { createShareLink, queueEmailFn })).rejects.toThrow(/valid chargeNoticeId/);
        expect(mockSetDoc).not.toHaveBeenCalled();
        // The guard must fire BEFORE any side effect (#386): an invalid id must not mint
        // (and prune) the member's share links, nor queue an email, before it throws.
        expect(createShareLink).not.toHaveBeenCalled();
        expect(queueEmailFn).not.toHaveBeenCalled();
    });

    it('mints a share link with the usageCharges:read scope and stamps its tokenHash on the doc', async () => {
        await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });

        expect(createShareLink).toHaveBeenCalledTimes(1);
        const linkArgs = createShareLink.mock.calls[0][0];
        expect(linkArgs.scopes).toContain('usageCharges:read');
        expect(linkArgs.memberId).toBe(1);

        const doc = mockSetDoc.mock.calls[0][1];
        expect(doc.tokenHash).toBe('hash-xyz');
    });

    it('emails the member with the share link and the charge total', async () => {
        await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });

        expect(queueEmailFn).toHaveBeenCalledTimes(1);
        const mail = queueEmailFn.mock.calls[0][0];
        expect(mail.to).toBe('alice@example.com');
        expect(mail.uid).toBe('user-1');
        expect(mail.subject).toMatch(/15\.00/);
        expect(mail.body).toContain('https://example.com/share?token=xyz');
        expect(mail.body).toMatch(/Roaming/);
    });

    it('still records the notice when minting the share link fails (best-effort link)', async () => {
        createShareLink.mockRejectedValueOnce(new Error('link boom'));
        await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });

        // Notice doc is still written (without a tokenHash) and the email still goes out.
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const doc = mockSetDoc.mock.calls[0][1];
        expect('tokenHash' in doc).toBe(false);
        expect(queueEmailFn).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the member has no email (skips the email, still records)', async () => {
        const opts = { ...baseOpts(), memberEmail: '' };
        await issueChargeNotice(opts, { createShareLink, queueEmailFn });
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        expect(queueEmailFn).not.toHaveBeenCalled();
    });

    it('never throws when the email send fails, and reports the failure', async () => {
        queueEmailFn.mockRejectedValueOnce(new Error('mail boom'));
        const result = await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });
        expect(result.emailError).toBe('mail boom');
        expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });

    it('reports no email error when the email is sent', async () => {
        const result = await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });
        expect(result.emailError).toBeNull();
    });
});
