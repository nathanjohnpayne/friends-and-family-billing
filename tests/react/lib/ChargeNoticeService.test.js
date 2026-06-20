import { describe, it, expect, vi, beforeEach } from 'vitest';

// Firestore is only touched through the injected collaborators in these tests; we
// still mock the module so importing the service (which imports firebase) is safe.
vi.mock('@/lib/firebase.js', () => ({ db: {} }));

const mockAddDoc = vi.fn(async () => ({ id: 'cn-doc-1' }));
const mockCollection = vi.fn((_db, ...segs) => ({ path: segs.join('/') }));
vi.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    addDoc: (...args) => mockAddDoc(...args),
    serverTimestamp: vi.fn(() => 'SERVER_TS')
}));

import { issueChargeNotice } from '@/lib/ChargeNoticeService.js';

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

    it('writes a charge_notice doc to the disputes subcollection with the billed total', async () => {
        await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });

        expect(mockAddDoc).toHaveBeenCalledTimes(1);
        const [colRef, doc] = mockAddDoc.mock.calls[0];
        expect(colRef.path).toBe('users/user-1/billingYears/2026/disputes');
        expect(doc.kind).toBe('charge_notice');
        expect(doc.memberId).toBe(1);
        expect(doc.amount).toBeCloseTo(15, 5);
        expect(doc.chargeNoticeId).toBe('cn_1');
        expect(doc.createdAt).toBe('SERVER_TS');
    });

    it('mints a share link with the usageCharges:read scope and stamps its tokenHash on the doc', async () => {
        await issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn });

        expect(createShareLink).toHaveBeenCalledTimes(1);
        const linkArgs = createShareLink.mock.calls[0][0];
        expect(linkArgs.scopes).toContain('usageCharges:read');
        expect(linkArgs.memberId).toBe(1);

        const doc = mockAddDoc.mock.calls[0][1];
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
        expect(mockAddDoc).toHaveBeenCalledTimes(1);
        const doc = mockAddDoc.mock.calls[0][1];
        expect('tokenHash' in doc).toBe(false);
        expect(queueEmailFn).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the member has no email (skips the email, still records)', async () => {
        const opts = { ...baseOpts(), memberEmail: '' };
        await issueChargeNotice(opts, { createShareLink, queueEmailFn });
        expect(mockAddDoc).toHaveBeenCalledTimes(1);
        expect(queueEmailFn).not.toHaveBeenCalled();
    });

    it('never throws when the email send fails (fire-and-forget)', async () => {
        queueEmailFn.mockRejectedValueOnce(new Error('mail boom'));
        await expect(issueChargeNotice(baseOpts(), { createShareLink, queueEmailFn })).resolves.toBeTruthy();
        expect(mockAddDoc).toHaveBeenCalledTimes(1);
    });
});
