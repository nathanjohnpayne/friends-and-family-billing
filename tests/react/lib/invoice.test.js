import { describe, it, expect } from 'vitest';
import { getInvoiceSummaryContext, buildInvoiceSubject, buildInvoiceBody, renderPreviewHTML } from '@/lib/invoice.js';

const members = [
    { id: 1, name: 'Alice Smith', email: 'alice@test.com', phone: '+14155551212', avatar: '', linkedMembers: [2], paymentReceived: 0 },
    { id: 2, name: 'Bob Smith', email: '', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 }
];

const bills = [
    { id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1, 2] }
];

const year = { id: '2026', label: '2026' };

describe('invoice helpers', () => {
    it('getInvoiceSummaryContext returns member context', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {});
        expect(ctx).not.toBeNull();
        expect(ctx.firstName).toBe('Alice');
        expect(ctx.combinedTotal).toBeGreaterThan(0);
        expect(ctx.currentYear).toBe('2026');
        expect(ctx.numMembers).toBe(2); // Alice + Bob linked
    });

    it('getInvoiceSummaryContext returns null for unknown member', () => {
        expect(getInvoiceSummaryContext(members, bills, [], 999, year, {})).toBeNull();
    });

    it('buildInvoiceSubject formats correctly', () => {
        const subject = buildInvoiceSubject('2026', { name: 'Alice Smith' });
        expect(subject).toContain('2026');
        expect(subject).toContain('Alice Smith');
    });

    it('buildInvoiceBody text-only variant produces greeting', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {});
        const body = buildInvoiceBody(ctx, 'text-only', '', 'email');
        expect(body).toContain('Alice');
        expect(body).toContain('2026');
    });

    it('buildInvoiceBody text-link variant includes share URL', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {});
        const body = buildInvoiceBody(ctx, 'text-link', 'https://example.com/share', 'email');
        expect(body).toContain('https://example.com/share');
    });

    it('buildInvoiceBody sms variant uses Hey instead of Hello', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {});
        const body = buildInvoiceBody(ctx, 'text-only', '', 'sms');
        expect(body).toContain('Hey');
    });

    it('buildInvoiceBody full variant includes bill breakdown', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {});
        const body = buildInvoiceBody(ctx, 'full', '', 'email');
        expect(body).toContain('ANNUAL BILLING SUMMARY');
        expect(body).toContain('Internet');
    });

    it('context includes balance when partially paid', () => {
        const payments = [{ memberId: 1, amount: 300, method: 'cash' }];
        const ctx = getInvoiceSummaryContext(members, bills, payments, 1, year, {});
        expect(ctx.payment).toBe(300);
        expect(ctx.balance).toBe(ctx.combinedTotal - 300);
        expect(ctx.amountLabel).toBe('remaining balance');
    });

    it('buildInvoiceSubject uses template with tokens when provided', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {});
        const subject = buildInvoiceSubject('2026', { name: 'Alice Smith' }, '%billing_year% Invoice\u2014%member_name%', ctx);
        expect(subject).toBe('2026 Invoice\u2014Alice Smith');
    });

    it('buildInvoiceSubject resolves %annual_total% token', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {});
        const subject = buildInvoiceSubject('2026', ctx.member, 'Bill for %billing_year%: %annual_total% due', ctx);
        expect(subject).toContain('2026');
        expect(subject).toMatch(/\$[\d,.]+/);
    });

    it('buildInvoiceSubject falls back to default when template is empty', () => {
        const subject = buildInvoiceSubject('2026', { name: 'Alice Smith' }, '', null);
        expect(subject).toBe('Annual Billing Summary 2026\u2014Alice Smith');
    });

    it('buildInvoiceSubject resolves %member_first% and %member_last%', () => {
        const subject = buildInvoiceSubject('2026', { name: 'Alice Smith' }, 'Invoice for %member_first% %member_last%', null);
        expect(subject).toBe('Invoice for Alice Smith');
    });

    it('buildInvoiceSubject resolves %member_first% for single-name member', () => {
        const subject = buildInvoiceSubject('2026', { name: 'Alice' }, 'Hi %member_first% (%member_last%)', null);
        expect(subject).toBe('Hi Alice ()');
    });

    it('buildInvoiceBody prepends greeting for legacy template without one', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {
            emailMessage: 'Your annual billing summary for %billing_year% is ready.'
        });
        const body = buildInvoiceBody(ctx, 'text-only', '', 'email');
        expect(body).toMatch(/^Hello Alice,/);
        expect(body).toContain('Your annual billing summary for 2026 is ready.');
    });

    it('buildInvoiceBody does not double-greet when template starts with Hello', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {
            emailMessage: 'Hello %member_first%,\n\nYour summary is ready.'
        });
        const body = buildInvoiceBody(ctx, 'text-only', '', 'email');
        // Should start with exactly one "Hello", not "Hello Alice,\n\nHello Alice,"
        const helloCount = (body.match(/Hello/g) || []).length;
        expect(helloCount).toBe(1);
    });

    it('buildInvoiceBody does not prepend greeting for Hi/Hey/Dear variants', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {
            emailMessage: 'Hi %member_first%, your bill is ready.'
        });
        const body = buildInvoiceBody(ctx, 'text-only', '', 'email');
        expect(body).toMatch(/^Hi Alice/);
        expect(body).not.toMatch(/^Hello/);
    });

    it('buildInvoiceBody does not prepend greeting for SMS channel', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {
            emailMessage: 'Your summary for %billing_year% is ready.'
        });
        const body = buildInvoiceBody(ctx, 'text-only', '', 'sms');
        // SMS fallback uses its own format, not the template
        expect(body).toMatch(/^Hey/);
    });
});

describe('payment URL linkification (issue #116)', () => {
    const settingsWithPayment = {
        emailMessage: 'Your bill for %billing_year% is ready.\n\n%payment_methods%',
        paymentMethods: [
            { type: 'venmo', label: 'Venmo', enabled: true, handle: '@NathanPayne', url: 'https://venmo.com/u/NathanPayne' }
        ]
    };

    it('formatPaymentOptionsMarkdown wraps URLs as markdown links in body', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, settingsWithPayment);
        const body = buildInvoiceBody(ctx, 'text-only', '', 'email', { markdown: true });
        expect(body).toContain('[https://venmo.com/u/NathanPayne](https://venmo.com/u/NathanPayne)');
    });

    it('renderPreviewHTML converts payment markdown links to clickable <a> tags', () => {
        const markdown = '- **Venmo:** @NathanPayne [https://venmo.com/u/NathanPayne](https://venmo.com/u/NathanPayne)';
        const html = renderPreviewHTML(markdown);
        expect(html).toContain('href="https://venmo.com/u/NathanPayne"');
    });

    it('bare URLs in text-only body are present for Cloud Function auto-linking', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, settingsWithPayment);
        // Without markdown option, body uses plain text format with bare URLs
        const body = buildInvoiceBody(ctx, 'text-only', '', 'email');
        expect(body).toContain('https://venmo.com/u/NathanPayne');
    });
});
