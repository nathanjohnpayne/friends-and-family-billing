import { describe, it, expect } from 'vitest';
import {
    REFUND_NOTICE_KIND,
    isRefundNotice,
    buildRefundNoticeDoc,
    buildRefundNoticeEmail,
    refundNoticeConfirmationLabel,
    isActiveNotReceived,
    normalizeRefundConfirmation,
    reopenedCreditAdjustmentIds,
} from '@/lib/refundNotice.js';
import { buildShareScopes } from '@/lib/share.js';

describe('refundNotice helpers', () => {
    describe('REFUND_NOTICE_KIND', () => {
        it('is the string the substrate keys on', () => {
            expect(REFUND_NOTICE_KIND).toBe('refund_notice');
        });
    });

    describe('isRefundNotice', () => {
        it('is true only when kind === refund_notice', () => {
            expect(isRefundNotice({ kind: 'refund_notice' })).toBe(true);
            expect(isRefundNotice({ kind: 'review_request' })).toBe(false);
            // Review Requests carry no kind field — they must read as NOT a refund notice.
            expect(isRefundNotice({})).toBe(false);
            expect(isRefundNotice(null)).toBe(false);
            expect(isRefundNotice(undefined)).toBe(false);
        });
    });

    describe('buildRefundNoticeDoc', () => {
        const base = {
            memberId: 1,
            memberName: 'Alice',
            amount: 100,
            method: 'venmo',
            reason: 'Overpaid for 2026',
            creditAdjustmentId: 'cadj_123',
        };

        it('stamps kind, a null confirmation, and the snapshot fields', () => {
            const doc = buildRefundNoticeDoc(base);
            expect(doc.kind).toBe('refund_notice');
            expect(doc.memberId).toBe(1);
            expect(doc.memberName).toBe('Alice');
            expect(doc.amount).toBe(100);
            expect(doc.method).toBe('venmo');
            expect(doc.reason).toBe('Overpaid for 2026');
            // The creditAdjustment stays authoritative; the notice only references it.
            expect(doc.creditAdjustmentId).toBe('cadj_123');
            // No confirmation yet — advisory round-trip not started.
            expect(doc.confirmation).toBeNull();
        });

        it('uses the outbound vocabulary, never the Review Request states', () => {
            const doc = buildRefundNoticeDoc(base);
            // Must NOT carry userReview / approved_by_user / rejected_by_user (ADR 0002).
            expect(doc.userReview).toBeUndefined();
            expect(JSON.stringify(doc)).not.toContain('approved_by_user');
            expect(JSON.stringify(doc)).not.toContain('rejected_by_user');
        });

        it('trims the reason and rounds the amount to cents', () => {
            const doc = buildRefundNoticeDoc({ ...base, reason: '  spaced  ', amount: 100.005 });
            expect(doc.reason).toBe('spaced');
            expect(doc.amount).toBe(100.01);
        });

        it('does not embed createdAt (caller stamps serverTimestamp)', () => {
            const doc = buildRefundNoticeDoc(base);
            expect(doc.createdAt).toBeUndefined();
        });

        it('throws when the creditAdjustmentId is missing (no orphan notice)', () => {
            expect(() => buildRefundNoticeDoc({ ...base, creditAdjustmentId: '' })).toThrow(/creditAdjustment/i);
        });
    });

    describe('buildShareScopes (refunds:read)', () => {
        it('adds refunds:read when the flag is set', () => {
            const scopes = buildShareScopes(false, false, true);
            expect(scopes).toContain('refunds:read');
            expect(scopes).toContain('summary:read');
        });

        it('omits refunds:read when the flag is false', () => {
            const scopes = buildShareScopes(false, false, false);
            expect(scopes).not.toContain('refunds:read');
        });

        it('is backwards-compatible with the 2-arg dispute call', () => {
            // usageCharges:read is always granted (#317), so the 2-arg call yields it too.
            const scopes = buildShareScopes(true, true);
            expect(scopes).toEqual(['summary:read', 'paymentMethods:read', 'usageCharges:read', 'disputes:create', 'disputes:read']);
        });
    });

    describe('buildRefundNoticeEmail', () => {
        const notice = { amount: 125.5, method: 'venmo', reason: 'Overpaid for 2026' };

        it('includes the reason, amount, method, and a confirm link', () => {
            const { subject, body } = buildRefundNoticeEmail(notice, 'Alice', '2026', 'https://x/share?token=abc');
            expect(subject).toMatch(/refund/i);
            expect(body).toContain('Alice');
            expect(body).toContain('$125.50');
            expect(body).toContain('Overpaid for 2026');
            expect(body.toLowerCase()).toContain('venmo');
            expect(body).toContain('https://x/share?token=abc');
        });

        it('still produces a body when no share link is available', () => {
            const { body } = buildRefundNoticeEmail(notice, 'Alice', '2026', null);
            expect(body).toContain('$125.50');
            // Falls back to contacting the account owner rather than a dead link.
            expect(body.toLowerCase()).toMatch(/account owner|share link/);
        });
    });

    describe('normalizeRefundConfirmation', () => {
        it('maps the two terminal states through and null/unknown to null', () => {
            expect(normalizeRefundConfirmation('confirmed_by_member')).toBe('confirmed_by_member');
            expect(normalizeRefundConfirmation('not_received')).toBe('not_received');
            expect(normalizeRefundConfirmation(null)).toBeNull();
            expect(normalizeRefundConfirmation('garbage')).toBeNull();
        });
    });

    describe('isActiveNotReceived', () => {
        it('is true only for an unresolved not_received', () => {
            expect(isActiveNotReceived({ kind: 'refund_notice', confirmation: 'not_received' })).toBe(true);
        });

        it('is false once the not_received is resolved', () => {
            expect(isActiveNotReceived({
                kind: 'refund_notice', confirmation: 'not_received', resolution: { type: 'dismissed', note: 'paid via Zelle' }
            })).toBe(false);
        });

        it('is false for confirmed or pending notices', () => {
            expect(isActiveNotReceived({ kind: 'refund_notice', confirmation: 'confirmed_by_member' })).toBe(false);
            expect(isActiveNotReceived({ kind: 'refund_notice', confirmation: null })).toBe(false);
        });

        it('is false for a non-refund-notice doc', () => {
            expect(isActiveNotReceived({ status: 'open' })).toBe(false);
        });
    });

    describe('reopenedCreditAdjustmentIds', () => {
        it('collects the creditAdjustmentId of every active not_received', () => {
            const ids = reopenedCreditAdjustmentIds([
                { kind: 'refund_notice', confirmation: 'not_received', creditAdjustmentId: 'cadj_1' },
                { kind: 'refund_notice', confirmation: 'not_received', creditAdjustmentId: 'cadj_2' },
            ]);
            expect(ids).toBeInstanceOf(Set);
            expect(ids.has('cadj_1')).toBe(true);
            expect(ids.has('cadj_2')).toBe(true);
            expect(ids.size).toBe(2);
        });

        it('excludes confirmed, pending, and resolved notices', () => {
            const ids = reopenedCreditAdjustmentIds([
                { kind: 'refund_notice', confirmation: 'confirmed_by_member', creditAdjustmentId: 'cadj_confirmed' },
                { kind: 'refund_notice', confirmation: null, creditAdjustmentId: 'cadj_pending' },
                { kind: 'refund_notice', confirmation: 'not_received', resolution: { type: 'resent' }, creditAdjustmentId: 'cadj_resolved' },
                { kind: 'refund_notice', confirmation: 'not_received', creditAdjustmentId: 'cadj_active' },
            ]);
            expect([...ids]).toEqual(['cadj_active']);
        });

        it('skips an active not_received that carries no creditAdjustmentId', () => {
            const ids = reopenedCreditAdjustmentIds([
                { kind: 'refund_notice', confirmation: 'not_received' },
            ]);
            expect(ids.size).toBe(0);
        });

        it('returns an empty set for an empty or missing list', () => {
            expect(reopenedCreditAdjustmentIds([]).size).toBe(0);
            expect(reopenedCreditAdjustmentIds(undefined).size).toBe(0);
        });
    });

    describe('refundNoticeConfirmationLabel', () => {
        it('labels each confirmation state', () => {
            expect(refundNoticeConfirmationLabel(null)).toMatch(/awaiting|sent/i);
            expect(refundNoticeConfirmationLabel('confirmed_by_member')).toMatch(/confirmed/i);
            expect(refundNoticeConfirmationLabel('not_received')).toMatch(/not received/i);
        });
    });
});
