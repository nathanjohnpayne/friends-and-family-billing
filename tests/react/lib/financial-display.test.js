import { describe, it, expect } from 'vitest';
import { projectHouseholdDisplay } from '@/lib/financial-display.js';
import { getInvoiceSummaryContext, buildInvoiceSubject, buildInvoiceBody, renderInvoiceTemplate, buildInvoiceTemplateEmailPayload } from '@/lib/invoice.js';

const members = [{ id: 1, name: 'A', linkedMembers: [] }, { id: 2, name: 'B', linkedMembers: [] }];
const source = () => ({ familyMembers: members, bills: [{ id: 'bill', name: 'Internet', amount: 1.15, billingFrequency: 'annual', members: [1, 2] }],
    payments: [], creditAdjustments: [], owedAdjustments: [] });
const invoice = data => getInvoiceSummaryContext(data.familyMembers, data.bills, data.payments, 1, { id: '2026' }, {}, data.owedAdjustments, data.creditAdjustments);

describe('authenticated scoped displays', () => {
    it('shows .58 Annual and .01 due with .57 paid without changing raw member lines', () => {
        const data = source();
        data.payments.push({ id: 'p', memberId: 1, amount: .57 });
        expect(projectHouseholdDisplay(data, members[0])).toMatchObject({ annual: .58, P: .57, balance: .01 });
        const ctx = invoice(data);
        expect(ctx).toMatchObject({ ok: true, combinedTotal: .58, payment: .57, balance: .01 });
        expect(ctx.memberData.total).toBe(.575);
    });

    it.each([[.01, .59], [-.01, .57]])('composes a signed %s opening after projected G', (amount, expected) => {
        const data = source();
        data.owedAdjustments.push({ id: 'seed', memberId: 1, kind: 'carry_opening', status: 'carried_in', amount });
        expect(invoice(data).combinedTotal).toBe(expected);
    });

    it.each([[20, 0], [30, 10], [0, -20]])('uses N after R=%s while preserving gross Paid and negative output', (R, balance) => {
        const data = source();
        data.bills[0] = { ...data.bills[0], amount: 100, members: [1] };
        data.payments.push({ id: 'p', memberId: 1, amount: 120 });
        if (R) data.creditAdjustments.push({ id: 'r', memberId: 1, type: 'refund', status: 'recorded', amount: R });
        const ctx = invoice(data);
        expect(ctx).toMatchObject({ ok: true, payment: 120, refunded: R, balance });
        const subject = buildInvoiceSubject('2026', ctx.member, 'Annual %household_total%', ctx);
        expect(subject).toEqual({ ok: true, value: 'Annual $100.00' });
        const payload = buildInvoiceTemplateEmailPayload(ctx, '');
        expect(payload.ok).toBe(true);
        const outputStrings = [renderInvoiceTemplate(ctx, '').value, payload.html, payload.text, payload.markdown,
            ...['text-only', 'text-link'].flatMap(variant => ['email', 'sms'].map(channel => buildInvoiceBody(ctx, variant, '', channel).value))];
        for (const output of outputStrings) {
            if (R) {
                expect(output.match(/Refunded:/g)).toHaveLength(1);
                expect(output).toContain('$' + R.toFixed(2));
            } else expect(output).not.toContain('Refunded');
        }
        const full = buildInvoiceBody(ctx, 'full', '', 'email');
        expect(full.ok).toBe(true);
        if (R) expect(full.value).toContain('Refunded:                      $' + R.toFixed(2));
        else expect(full.value).not.toContain('Refunded');
    });

    it('excludes B and nets the exact reversal once before subtracting R under null reopening', () => {
        const data = source();
        data.bills[0] = { ...data.bills[0], amount: 100, members: [1] };
        data.payments = [{ id: 'p1', memberId: 1, amount: 120 }, { id: 'p2', memberId: 1, amount: .005, reversed: true },
            { id: 'rev', memberId: 1, amount: -.005, type: 'reversal', reversesPaymentId: 'p2' }];
        data.creditAdjustments = [{ id: 'r', memberId: 1, type: 'refund', amount: 30, status: 'recorded' }];
        data.owedAdjustments = [{ id: 'b', memberId: 1, amount: 50, kind: 'usage_charge', status: 'billed' }];
        expect(invoice(data)).toMatchObject({ combinedTotal: 100, payment: 120, refunded: 30, balance: 10 });
        const display = projectHouseholdDisplay(data, members[0]);
        expect(display.balance).toBe(60);
        expect(display.rows.payments.filter(r => ['p2', 'rev'].includes(r.id)).map(r => r.cents)).toEqual([1, -1]);
    });

    it('shows one Refunded row even when a legacy disposition has no gross payments', () => {
        const data = source();
        data.creditAdjustments = [{ id: 'r', memberId: 1, type: 'refund', amount: .01, status: 'recorded' }];
        const output = buildInvoiceBody(invoice(data), 'full', '', 'email');
        expect(output.ok).toBe(true);
        expect(output.value.match(/Refunded:/g)).toHaveLength(1);
    });

    it('shows signed canonical P from an admitted legacy payment instead of fabricating zero', () => {
        const data = source();
        data.payments = [{ id: 'legacy-negative', memberId: 1, amount: -.01 }];
        const ctx = invoice(data);
        expect(ctx).toMatchObject({ ok: true, payment: -.01, balance: .59 });
        const output = buildInvoiceBody(ctx, 'full', '', 'email');
        expect(output.ok).toBe(true);
        expect(output.value).toContain('Payment Received:              $-0.01');
    });

    it('allocates tied Service Credit groups before rendering and never changes raw amounts', () => {
        const data = source();
        data.bills[0] = { ...data.bills[0], amount: 1, members: [1] };
        data.owedAdjustments = ['b', 'a'].map(id => ({ id, memberId: 1, kind: 'service_credit', status: 'active', amount: .005, billId: id, reason: id }));
        const display = projectHouseholdDisplay(data, members[0]);
        expect(display.S).toBe(.01);
        expect(display.rows.service.map(r => [r.sourceIds[0], r.cents]).sort()).toEqual([['a', 1], ['b', 0]]);
        expect(data.owedAdjustments.map(r => r.amount)).toEqual([.005, .005]);
    });
});

describe('invoice unavailable result at every exported boundary', () => {
    const outputs = ctx => [buildInvoiceSubject('2026', ctx?.member, '', ctx), buildInvoiceBody(ctx, 'full', '', 'email'),
        buildInvoiceBody(ctx, 'text-only', '', 'sms'), renderInvoiceTemplate(ctx, ''), buildInvoiceTemplateEmailPayload(ctx, '')];

    it.each(['100', NaN, Infinity, null, undefined, true])('withholds every output for admitted malformed refunds: %s', amount => {
        const data = source();
        data.creditAdjustments = [{ id: 'r', memberId: 1, type: 'refund', status: 'recorded', amount }];
        const ctx = invoice(data);
        expect(ctx).toEqual({ ok: false, kind: 'financial-unavailable', householdId: 1 });
        for (const result of outputs(ctx)) expect(result).toEqual(ctx);
        expect(JSON.stringify(ctx)).not.toContain('recordId');
    });

    it('rejects incomplete Full summary structure consistently at every output boundary', () => {
        const data = source();
        data.payments = [{ id: 'p', memberId: 1, amount: .01 }];
        const valid = invoice(data);
        const invalidContexts = [
            { ...valid, numMembers: undefined }, { ...valid, numMembers: 0 }, { ...valid, numMembers: '1' },
            { ...valid, linkedMembersData: [null] }, { ...valid, memberData: undefined },
            { ...valid, memberData: { ...valid.memberData, bills: undefined } },
            { ...valid, memberData: { ...valid.memberData, total: NaN } },
            { ...valid, memberData: { ...valid.memberData, bills: [null] } },
            { ...valid, linkedMembersData: [{ ...valid.memberData, member: null }] },
            ...['monthlyShare', 'annualShare'].map(field => ({ ...valid, memberData: { ...valid.memberData,
                bills: [{ ...valid.memberData.bills[0], [field]: undefined }] } })),
            { ...valid, memberData: { ...valid.memberData, bills: [{ ...valid.memberData.bills[0],
                bill: { ...valid.memberData.bills[0].bill, members: null } }] } }
        ];
        for (const ctx of invalidContexts) for (const result of outputs(ctx)) {
            expect(result).toEqual({ ok: false, kind: 'financial-unavailable', householdId: 1 });
        }
    });

    it('rejects missing, malformed and internally inconsistent purported success contexts', () => {
        const valid = invoice(source());
        for (const ctx of [null, undefined, {}, { ...valid, combinedTotal: 0 }, { ...valid, combinedTotal: '0.58' }, { ...valid, payment: null }, { ...valid, cents: { ...valid.cents, N: 100 } }]) {
            for (const result of outputs(ctx)) expect(result.ok).toBe(false);
        }
        expect(getInvoiceSummaryContext(members, [], [], 1, { id: '2026' }, {})).toMatchObject({ ok: false });
    });
});
