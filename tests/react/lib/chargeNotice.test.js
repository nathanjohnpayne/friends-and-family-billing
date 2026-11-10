import { describe, it, expect } from 'vitest';
import {
    CHARGE_NOTICE_KIND,
    isChargeNotice,
    selectBillableCharges,
    monthRange,
    summarizeChargePreview,
    buildChargeNoticeDoc,
    buildChargeNoticeEmail
} from '@/lib/chargeNotice.js';

describe('CHARGE_NOTICE_KIND', () => {
    it('is the "charge_notice" discriminator (ADR 0002 distinct kind)', () => {
        expect(CHARGE_NOTICE_KIND).toBe('charge_notice');
    });
});

describe('isChargeNotice', () => {
    it('is true only when kind is charge_notice', () => {
        expect(isChargeNotice({ kind: 'charge_notice' })).toBe(true);
        expect(isChargeNotice({ kind: 'refund_notice' })).toBe(false);
        expect(isChargeNotice({ kind: undefined })).toBe(false);
        expect(isChargeNotice(null)).toBe(false);
    });
});

describe('selectBillableCharges', () => {
    const owedAdjustments = [
        { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred', incurredDate: '2026-06-03' },
        { id: 'o2', memberId: 1, kind: 'usage_charge', amount: 5, status: 'deferred', incurredDate: '2026-06-20' },
        { id: 'o3', memberId: 1, kind: 'usage_charge', amount: 7, status: 'deferred', incurredDate: '2026-05-15' },
        { id: 'o4', memberId: 1, kind: 'usage_charge', amount: 99, status: 'billed', incurredDate: '2026-06-10' },
        { id: 'o5', memberId: 1, kind: 'usage_charge', amount: 99, status: 'voided', incurredDate: '2026-06-10' },
        { id: 'o6', memberId: 2, kind: 'usage_charge', amount: 99, status: 'deferred', incurredDate: '2026-06-10' }
    ];

    it('defaults to ALL of the member own deferred usage charges (no range)', () => {
        const sel = selectBillableCharges(owedAdjustments, 1);
        expect(sel.map(c => c.id)).toEqual(['o3', 'o1', 'o2']); // sorted by incurred date ascending
    });

    it('excludes already-billed, voided, other-member, and credit-direction adjustments', () => {
        const sel = selectBillableCharges(owedAdjustments, 1);
        expect(sel.find(c => c.id === 'o4')).toBeUndefined(); // billed
        expect(sel.find(c => c.id === 'o5')).toBeUndefined(); // voided
        expect(sel.find(c => c.id === 'o6')).toBeUndefined(); // other member
    });

    it('filters to an inclusive incurred-date range when given (the "this month" preset)', () => {
        const sel = selectBillableCharges(owedAdjustments, 1, { from: '2026-06-01', to: '2026-06-30' });
        expect(sel.map(c => c.id)).toEqual(['o1', 'o2']); // o3 (May) excluded
    });

    it('returns an empty array for an unknown member or empty input', () => {
        expect(selectBillableCharges(owedAdjustments, 999)).toEqual([]);
        expect(selectBillableCharges([], 1)).toEqual([]);
        expect(selectBillableCharges(undefined, 1)).toEqual([]);
    });

    it('accepts an array of member ids for household-grain selection (ADR 0001)', () => {
        // Bill across a household: member 1 plus a linked member 2.
        const hh = [
            { id: 'o1', memberId: 1, kind: 'usage_charge', amount: 10, status: 'deferred', incurredDate: '2026-06-03' },
            { id: 'oL', memberId: 2, kind: 'usage_charge', amount: 4, status: 'deferred', incurredDate: '2026-06-04' }
        ];
        const sel = selectBillableCharges(hh, [1, 2]);
        expect(sel.map(c => c.id)).toEqual(['o1', 'oL']);
    });
});

describe('monthRange', () => {
    it('returns inclusive first/last day of the month for a given local date', () => {
        const r = monthRange(new Date(2026, 5, 20)); // June 2026 (month is 0-indexed)
        expect(r).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    });

    it('handles February (28 days) correctly', () => {
        const r = monthRange(new Date(2026, 1, 10)); // Feb 2026
        expect(r).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    });

    it('handles December (31 days, year boundary) correctly', () => {
        const r = monthRange(new Date(2026, 11, 25)); // Dec 2026
        expect(r).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    });
});

describe('summarizeChargePreview', () => {
    it.each([.005, .004])('projects each selected %s set as its own parent and leaves source unchanged', amount => {
        const charges = [{ id: 'a', amount, description: 'January', incurredDate: '2026-01-01' },
            { id: 'b', amount, description: 'February', incurredDate: '2026-02-01' }];
        for (const charge of charges) {
            const single = summarizeChargePreview([charge]);
            expect(single.total).toBe(amount === .005 ? .01 : 0);
            expect(single.issuable).toBe(amount === .005);
            if (!single.issuable) expect(() => buildChargeNoticeDoc({ charges: [charge] })).toThrow(/one cent/);
        }
        for (const selection of [charges, [...charges].reverse()]) {
            const projection = summarizeChargePreview(selection);
            expect(projection.total).toBe(.01);
            expect(projection.charges.map(row => [row.id, row.amount]).sort()).toEqual([['a', .01], ['b', 0]]);
            expect(projection.charges.at(-1).runningTotal).toBe(.01);
            const doc = buildChargeNoticeDoc({ charges: selection });
            expect(doc.amount).toBe(.01);
            expect(doc.charges.map(row => row.amount)).toEqual(projection.charges.map(row => row.amount));
        }
        expect(charges.map(row => row.amount)).toEqual([amount, amount]);
    });

    it.each([NaN, Infinity, '1', null, undefined, true])('withholds invalid selected money %s without rows/total', amount => {
        expect(summarizeChargePreview([{ id: 'a', amount }])).toEqual({ ok: false, kind: 'financial-unavailable', householdId: null });
        expect(() => buildChargeNoticeDoc({ charges: [{ id: 'a', amount }] })).toThrow(/unavailable/);
    });

    it('preserves signed finite selected arithmetic without adding a deferred-source sign policy', () => {
        const projection = summarizeChargePreview([{ id: 'a', amount: -.005 }, { id: 'b', amount: .02 }]);
        expect(projection).toMatchObject({ ok: true, cents: 2, total: .02, issuable: true });
        expect(projection.charges.map(row => row.amount)).toEqual([0, .02]);
        expect(summarizeChargePreview([{ id: 'a', amount: 0 }])).toMatchObject({ ok: true, issuable: false, total: 0 });
        expect(summarizeChargePreview([{ id: 'a', amount: -.01 }])).toMatchObject({ ok: true, issuable: false, total: -.01 });
    });

    it('holds duplicate canonical ids instead of inventing a row order', () => {
        expect(summarizeChargePreview([{ id: 1, amount: .005 }, { id: '1', amount: .005 }]).ok).toBe(false);
    });

    it('returns count, total, and per-charge running totals', () => {
        const charges = [
            { id: 'o1', description: 'A', amount: 10, incurredDate: '2026-06-03' },
            { id: 'o2', description: 'B', amount: 5.5, incurredDate: '2026-06-20' }
        ];
        const preview = summarizeChargePreview(charges);
        expect(preview.count).toBe(2);
        expect(preview.total).toBeCloseTo(15.5, 5);
        expect(preview.charges.map(c => c.runningTotal)).toEqual([10, 15.5]);
    });

    it('is empty for no charges', () => {
        expect(summarizeChargePreview([])).toEqual({ ok: true, issuable: false, cents: 0, charges: [], total: 0, count: 0 });
        expect(summarizeChargePreview(undefined)).toEqual({ ok: false, kind: 'financial-unavailable', householdId: null });
    });

    it('preview total equals the persisted doc amount for fractional-cent charges (PR #328 r3447513513)', () => {
        // Three fractional-cent amounts whose per-step rounding diverges from a
        // round-once-at-end total. The admin preview total must match the amount the
        // dispute doc persists, or the admin sees a figure the member is never billed.
        const charges = [
            { id: 'o1', description: 'A', amount: 0.334, incurredDate: '2026-06-01' },
            { id: 'o2', description: 'B', amount: 0.333, incurredDate: '2026-06-02' },
            { id: 'o3', description: 'C', amount: 0.333, incurredDate: '2026-06-03' }
        ];
        const preview = summarizeChargePreview(charges);
        const doc = buildChargeNoticeDoc({ memberId: 1, memberName: 'Alice', chargeNoticeId: 'cn_1', charges });
        expect(preview.charges.map(({ id, amount }) => ({ id, amount }))).toEqual(doc.charges.map(({ id, amount }) => ({ id, amount })));
        expect(preview.charges.map(c => c.amount)).toEqual([0.34, 0.33, 0.33]);
        expect(preview.charges.map(c => c.runningTotal)).toEqual([0.34, 0.67, 1]);
        expect(preview.total).toBe(doc.amount);
        expect(preview.total).toBe(1); // 0.334 + 0.333 + 0.333 = 1.00 rounded once
    });
});

describe('buildChargeNoticeDoc', () => {
    const charges = [
        { id: 'o1', description: 'Roaming', amount: 10, incurredDate: '2026-06-03' },
        { id: 'o2', description: 'Overage', amount: 5, incurredDate: '2026-06-20' }
    ];

    it('stamps the charge_notice kind, member, total, and line items', () => {
        const doc = buildChargeNoticeDoc({
            memberId: 1, memberName: 'Alice', chargeNoticeId: 'cn_1',
            charges, tokenHash: 'abc'
        });
        expect(doc.kind).toBe('charge_notice');
        expect(doc.memberId).toBe(1);
        expect(doc.memberName).toBe('Alice');
        expect(doc.chargeNoticeId).toBe('cn_1');
        expect(doc.amount).toBeCloseTo(15, 5);
        expect(doc.tokenHash).toBe('abc');
        // Line items capture each billed charge's id/description/amount for the member's record.
        expect(doc.charges.map(c => c.id)).toEqual(['o1', 'o2']);
        expect(doc.charges[0]).toMatchObject({ id: 'o1', description: 'Roaming', amount: 10 });
    });

    it('records the adjustment ids that were billed (audit linkage to owedAdjustments)', () => {
        const doc = buildChargeNoticeDoc({ memberId: 1, memberName: 'Alice', chargeNoticeId: 'cn_1', charges });
        expect(doc.chargeIds).toEqual(['o1', 'o2']);
    });

    it('throws when there are no charges to bill (a notice must invoice something)', () => {
        expect(() => buildChargeNoticeDoc({ memberId: 1, memberName: 'Alice', chargeNoticeId: 'cn_1', charges: [] }))
            .toThrow(/no charges|nothing to bill/i);
    });

    it('omits tokenHash when no share link was minted', () => {
        const doc = buildChargeNoticeDoc({ memberId: 1, memberName: 'Alice', chargeNoticeId: 'cn_1', charges });
        expect('tokenHash' in doc).toBe(false);
    });
});

describe('buildChargeNoticeEmail', () => {
    it('includes the total, a line-item summary, and the share link', () => {
        const { subject, body } = buildChargeNoticeEmail({
            memberName: 'Alice',
            amount: 15,
            charges: [
                { description: 'Roaming', amount: 10 },
                { description: 'Overage', amount: 5 }
            ],
            yearLabel: '2026',
            shareUrl: 'https://example.com/share?token=xyz'
        });
        expect(subject).toMatch(/15\.00/);
        expect(subject).toMatch(/2026/);
        expect(body).toMatch(/Alice/);
        expect(body).toMatch(/Roaming/);
        expect(body).toMatch(/Overage/);
        expect(body).toMatch(/\$15\.00/);
        expect(body).toContain('https://example.com/share?token=xyz');
    });

    it('falls back gracefully when no share url is available', () => {
        const { body } = buildChargeNoticeEmail({ memberName: 'Alice', amount: 15, charges: [], yearLabel: '2026' });
        expect(body).toMatch(/Alice/);
        expect(body).not.toContain('undefined');
    });
});
