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

import { issueChargeNotice as issueChargeNoticeResult } from '@/lib/ChargeNoticeService.js';
import { BillingYearService } from '@/lib/BillingYearService.js';

// Ordinary orchestration fixtures supply an unchanged immutable source snapshot.
const issueChargeNotice = (opts, deps) => issueChargeNoticeResult({ ...opts, getState: opts.getState || (() => opts) }, deps);

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

    it('stops after awaited link generation if the household is now held', async () => {
        let available = true;
        createShareLink.mockImplementation(async () => { available = false; return { url: 'https://example.com', tokenHash: 'h' }; });
        const opts = { ...baseOpts(), getAvailability: () => ({ available }) };
        await expect(issueChargeNotice(opts, { createShareLink, queueEmailFn })).rejects.toThrow(/unavailable/);
        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(queueEmailFn).not.toHaveBeenCalled();
    });

    it('stops before email if the household becomes held while the Notice write is in flight', async () => {
        let available = true;
        mockSetDoc.mockImplementationOnce(async () => { available = false; });
        await expect(issueChargeNotice({ ...baseOpts(), getAvailability: () => ({ available }) }, { createShareLink, queueEmailFn }))
            .rejects.toThrow(/unavailable/);
        expect(mockSetDoc).toHaveBeenCalledOnce();
        expect(queueEmailFn).not.toHaveBeenCalled();
    });

    it('rejects a Boolean-only caller before any side effect', async () => {
        await expect(issueChargeNoticeResult({ ...baseOpts(), getAvailability: () => ({ available: true }) }, { createShareLink, queueEmailFn }))
            .rejects.toThrow(/getState reader/);
        expect(createShareLink).not.toHaveBeenCalled();
        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(queueEmailFn).not.toHaveBeenCalled();
    });

    it.each([undefined, null, () => null, () => ({ activeYear: { id: '2026' } })])('rejects a missing or unusable live source reader before effects', async getState => {
        await expect(issueChargeNoticeResult({ ...baseOpts(), getState }, { createShareLink, queueEmailFn })).rejects.toThrow();
        expect(createShareLink).not.toHaveBeenCalled();
        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(queueEmailFn).not.toHaveBeenCalled();
    });

    it.each(['hold', 'year'])('never revives a real immutable-service operation after a transient %s is restored', async transition => {
        const service = new BillingYearService();
        const opts = baseOpts();
        service._setState({ activeYear: opts.activeYear, familyMembers: opts.familyMembers, bills: opts.bills, payments: opts.payments,
            creditAdjustments: opts.creditAdjustments, owedAdjustments: opts.owedAdjustments });
        const initial = service.getState();
        let finish;
        createShareLink.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const pending = issueChargeNoticeResult({ ...opts, getState: () => service.getState(),
            getAvailability: () => ({ available: true }) }, { createShareLink, queueEmailFn });
        expect(createShareLink).toHaveBeenCalledOnce();
        if (transition === 'hold') {
            service._setState({ creditAdjustments: [{ id: 'bad', memberId: 1, type: 'refund', status: 'recorded', amount: NaN }] });
            service._setState({ creditAdjustments: initial.creditAdjustments });
        } else {
            service._setState({ activeYear: { ...opts.activeYear, id: '2027', label: '2027' } });
            service._setState({ activeYear: initial.activeYear });
        }
        expect(service.getState()).not.toBe(initial);
        finish({ url: 'https://example.com/share', tokenHash: 'h' });
        await expect(pending).rejects.toThrow(/unavailable/);
        expect(mockSetDoc).not.toHaveBeenCalled();
        expect(queueEmailFn).not.toHaveBeenCalled();
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
