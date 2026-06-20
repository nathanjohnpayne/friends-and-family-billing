import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/firebase.js', () => ({ db: {} }));

const mockAddDoc = vi.fn(async () => ({ id: 'notice-1' }));
const mockCollection = vi.fn((_db, ...segments) => ({ path: segments.join('/') }));
const mockServerTimestamp = vi.fn(() => 'SERVER_TS');

vi.mock('firebase/firestore', () => ({
    collection: (...args) => mockCollection(...args),
    addDoc: (...args) => mockAddDoc(...args),
    serverTimestamp: () => mockServerTimestamp(),
}));

const mockCreateLink = vi.fn(async () => ({
    url: 'https://example.com/share?token=raw',
    tokenHash: 'hash-abc',
    rawToken: 'raw',
}));
vi.mock('@/lib/ShareLinkService.js', () => ({
    createAndPruneShareLink: (...args) => mockCreateLink(...args),
}));

const mockQueueEmail = vi.fn(async () => ({ id: 'mail-1' }));
vi.mock('@/lib/mail.js', () => ({
    queueEmail: (...args) => mockQueueEmail(...args),
}));

import { issueRefundNotice } from '@/lib/RefundNoticeService.js';

const baseArgs = {
    userId: 'user-1',
    memberId: 1,
    memberName: 'Alice',
    memberEmail: 'alice@example.com',
    billingYearId: '2026',
    yearLabel: '2026',
    amount: 100,
    method: 'venmo',
    reason: 'Overpaid for 2026',
    creditAdjustmentId: 'cadj_99',
    familyMembers: [{ id: 1, name: 'Alice', linkedMembers: [] }],
    bills: [],
    payments: [],
    activeYear: { id: '2026', label: '2026' },
    settings: {},
};

describe('issueRefundNotice', () => {
    beforeEach(() => {
        mockAddDoc.mockClear();
        mockCollection.mockClear();
        mockCreateLink.mockClear();
        mockQueueEmail.mockClear();
    });

    it('writes a refund_notice doc to the disputes subcollection with a server timestamp', async () => {
        await issueRefundNotice(baseArgs);
        expect(mockAddDoc).toHaveBeenCalledTimes(1);
        const [collRef, doc] = mockAddDoc.mock.calls[0];
        expect(collRef.path).toBe('users/user-1/billingYears/2026/disputes');
        expect(doc.kind).toBe('refund_notice');
        expect(doc.memberId).toBe(1);
        expect(doc.amount).toBe(100);
        expect(doc.reason).toBe('Overpaid for 2026');
        expect(doc.creditAdjustmentId).toBe('cadj_99');
        expect(doc.confirmation).toBeNull();
        expect(doc.createdAt).toBe('SERVER_TS');
    });

    it('mints a refunds:read share link for the confirm CTA', async () => {
        await issueRefundNotice(baseArgs);
        expect(mockCreateLink).toHaveBeenCalledTimes(1);
        const opts = mockCreateLink.mock.calls[0][0];
        expect(opts.memberId).toBe(1);
        expect(opts.billingYearId).toBe('2026');
        expect(opts.scopes).toContain('refunds:read');
        // The refund recipient should still be able to read their summary on that link.
        expect(opts.scopes).toContain('summary:read');
    });

    it('records the tokenHash on the notice so the share link is traceable', async () => {
        await issueRefundNotice(baseArgs);
        const doc = mockAddDoc.mock.calls[0][1];
        expect(doc.tokenHash).toBe('hash-abc');
    });

    it('emails the member the reason, amount, and confirm link', async () => {
        await issueRefundNotice(baseArgs);
        expect(mockQueueEmail).toHaveBeenCalledTimes(1);
        const mail = mockQueueEmail.mock.calls[0][0];
        expect(mail.to).toBe('alice@example.com');
        expect(mail.subject).toMatch(/refund/i);
        expect(mail.body).toContain('$100.00');
        expect(mail.body).toContain('Overpaid for 2026');
        expect(mail.body).toContain('https://example.com/share?token=raw');
        expect(mail.uid).toBe('user-1');
    });

    it('still writes the notice when the member has no email (no confirm email sent)', async () => {
        await issueRefundNotice({ ...baseArgs, memberEmail: '' });
        expect(mockAddDoc).toHaveBeenCalledTimes(1);
        expect(mockQueueEmail).not.toHaveBeenCalled();
    });

    it('does not throw if the email send fails (notice persistence is primary)', async () => {
        mockQueueEmail.mockRejectedValueOnce(new Error('resend down'));
        await expect(issueRefundNotice(baseArgs)).resolves.toBeTruthy();
        expect(mockAddDoc).toHaveBeenCalledTimes(1);
    });

    it('persists the notice even if minting the share link fails (email falls back)', async () => {
        mockCreateLink.mockRejectedValueOnce(new Error('batch failed'));
        await issueRefundNotice(baseArgs);
        // Notice must still be written (without a tokenHash).
        expect(mockAddDoc).toHaveBeenCalledTimes(1);
        const doc = mockAddDoc.mock.calls[0][1];
        expect(doc.tokenHash).toBeUndefined();
        // Email still goes out, just without the share URL.
        expect(mockQueueEmail).toHaveBeenCalledTimes(1);
        const mail = mockQueueEmail.mock.calls[0][0];
        expect(mail.body).not.toContain('share?token=');
    });

    it('returns the new notice id and share url', async () => {
        const out = await issueRefundNotice(baseArgs);
        expect(out.noticeId).toBe('notice-1');
        expect(out.shareUrl).toBe('https://example.com/share?token=raw');
    });
});
