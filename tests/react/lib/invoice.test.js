import { describe, it, expect } from 'vitest';
import { getInvoiceSummaryContext, buildInvoiceSubject, buildInvoiceBody, renderPreviewHTML, docToPlainTextWithTokens, plainTextToDoc } from '@/lib/invoice.js';

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

describe('new token name aliases', () => {
    it('buildInvoiceSubject resolves %first_name% and %last_name%', () => {
        const subject = buildInvoiceSubject('2026', { name: 'Alice Smith' }, 'Invoice for %first_name% %last_name%', null);
        expect(subject).toBe('Invoice for Alice Smith');
    });

    it('buildInvoiceSubject resolves %full_name%', () => {
        const subject = buildInvoiceSubject('2026', { name: 'Alice Smith' }, '%full_name% Bill', null);
        expect(subject).toBe('Alice Smith Bill');
    });

    it('buildInvoiceSubject resolves %household_total%', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {});
        const subject = buildInvoiceSubject('2026', ctx.member, 'Total: %household_total%', ctx);
        expect(subject).toMatch(/\$[\d,.]+/);
    });

    it('buildInvoiceBody resolves %first_name% in template text', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {
            emailMessage: 'Hello %first_name%, your total is %household_total%.'
        });
        const body = buildInvoiceBody(ctx, 'text-only', '', 'email');
        expect(body).toContain('Hello Alice');
        expect(body).toMatch(/\$[\d,.]+/);
    });
});

describe('docToPlainTextWithTokens', () => {
    it('converts a simple paragraph', () => {
        const doc = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }]
        };
        expect(docToPlainTextWithTokens(doc)).toBe('Hello world');
    });

    it('converts inline token nodes to %token% strings', () => {
        const doc = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Hello ' },
                    { type: 'templateToken', attrs: { id: 'first_name', label: 'First Name' } },
                    { type: 'text', text: ', your total is ' },
                    { type: 'templateToken', attrs: { id: 'household_total', label: 'Household Total' } },
                    { type: 'text', text: '.' },
                ]
            }]
        };
        expect(docToPlainTextWithTokens(doc)).toBe('Hello %first_name%, your total is %household_total%.');
    });

    it('converts block tokens on their own line', () => {
        const doc = {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Payment info:' }] },
                { type: 'blockToken', attrs: { id: 'payment_methods', label: 'Payment Methods' } },
            ]
        };
        expect(docToPlainTextWithTokens(doc)).toBe('Payment info:\n%payment_methods%');
    });

    it('converts bullet lists', () => {
        const doc = {
            type: 'doc',
            content: [{
                type: 'bulletList',
                content: [
                    { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item A' }] }] },
                    { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item B' }] }] },
                ]
            }]
        };
        expect(docToPlainTextWithTokens(doc)).toBe('- Item A\n- Item B');
    });

    it('converts horizontal rules', () => {
        const doc = {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Above' }] },
                { type: 'horizontalRule' },
                { type: 'paragraph', content: [{ type: 'text', text: 'Below' }] },
            ]
        };
        expect(docToPlainTextWithTokens(doc)).toBe('Above\n---\nBelow');
    });

    it('returns empty string for null/undefined', () => {
        expect(docToPlainTextWithTokens(null)).toBe('');
        expect(docToPlainTextWithTokens(undefined)).toBe('');
    });

    it('preserves bold marks on tokens as **%token%**', () => {
        const doc = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Total: ' },
                    { type: 'templateToken', attrs: { id: 'household_total' }, marks: [{ type: 'bold' }] },
                ]
            }]
        };
        expect(docToPlainTextWithTokens(doc)).toBe('Total: **%household_total%**');
    });

    it('does not add ** for non-bold tokens', () => {
        const doc = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'templateToken', attrs: { id: 'first_name' } },
                ]
            }]
        };
        expect(docToPlainTextWithTokens(doc)).toBe('%first_name%');
    });
});

describe('plainTextToDoc', () => {
    it('converts simple text to a paragraph', () => {
        const doc = plainTextToDoc('Hello world');
        expect(doc.type).toBe('doc');
        expect(doc.content[0].type).toBe('paragraph');
        expect(doc.content[0].content[0].text).toBe('Hello world');
    });

    it('converts %token% patterns to templateToken nodes', () => {
        const doc = plainTextToDoc('Hello %first_name%');
        const para = doc.content[0];
        expect(para.content[0].text).toBe('Hello ');
        expect(para.content[1].type).toBe('templateToken');
        expect(para.content[1].attrs.id).toBe('first_name');
        expect(para.content[1].attrs.label).toBe('First Name');
    });

    it('converts standalone block tokens to blockToken nodes', () => {
        const doc = plainTextToDoc('Info:\n%payment_methods%\nThanks');
        expect(doc.content[0].type).toBe('paragraph');
        expect(doc.content[1].type).toBe('blockToken');
        expect(doc.content[1].attrs.id).toBe('payment_methods');
        expect(doc.content[2].type).toBe('paragraph');
    });

    it('converts horizontal rules', () => {
        const doc = plainTextToDoc('Above\n---\nBelow');
        expect(doc.content[1].type).toBe('horizontalRule');
    });

    it('normalizes legacy token names', () => {
        const doc = plainTextToDoc('Hello %member_first%');
        const token = doc.content[0].content[1];
        expect(token.type).toBe('templateToken');
        expect(token.attrs.id).toBe('first_name');
    });

    it('returns empty doc for empty string', () => {
        const doc = plainTextToDoc('');
        expect(doc.content.length).toBe(1);
        expect(doc.content[0].type).toBe('paragraph');
    });

    it('converts **%token%** to bold-marked token node', () => {
        const doc = plainTextToDoc('Total: **%household_total%**');
        const para = doc.content[0];
        expect(para.content[0].text).toBe('Total: ');
        const token = para.content[1];
        expect(token.type).toBe('templateToken');
        expect(token.attrs.id).toBe('household_total');
        expect(token.marks).toEqual([{ type: 'bold' }]);
    });

    it('does not swallow one-sided ** around tokens', () => {
        const doc = plainTextToDoc('**Hello %first_name%**');
        const para = doc.content[0];
        // The ** before Hello is prose text, not consumed by the token
        expect(para.content[0].text).toBe('**Hello ');
        // The token is plain (no bold) because ** is only on the right side of it
        const token = para.content[1];
        expect(token.type).toBe('templateToken');
        expect(token.marks).toBeUndefined();
        // The trailing ** is left as literal text
        expect(para.content[2].text).toBe('**');
    });

    it('round-trips bold tokens through plainTextToDoc and docToPlainTextWithTokens', () => {
        const input = 'Your total is **%household_total%**.';
        const doc = plainTextToDoc(input);
        const output = docToPlainTextWithTokens(doc);
        expect(output).toBe(input);
    });

    it('round-trips plain tokens through plainTextToDoc and docToPlainTextWithTokens', () => {
        const input = 'Hello %first_name%, your bill is ready.';
        const doc = plainTextToDoc(input);
        const output = docToPlainTextWithTokens(doc);
        expect(output).toBe(input);
    });

    it('converts **bold text** to bold-marked text node', () => {
        const doc = plainTextToDoc('Hello **Nathan!**');
        const para = doc.content[0];
        expect(para.content[0].text).toBe('Hello ');
        expect(para.content[1].text).toBe('Nathan!');
        expect(para.content[1].marks).toEqual([{ type: 'bold' }]);
    });

    it('converts [text](url) to link-marked text node', () => {
        const doc = plainTextToDoc('[click here](https://example.com)');
        const para = doc.content[0];
        expect(para.content[0].text).toBe('click here');
        expect(para.content[0].marks[0].type).toBe('link');
        expect(para.content[0].marks[0].attrs.href).toBe('https://example.com');
    });

    it('handles URLs with balanced parentheses', () => {
        const doc = plainTextToDoc('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))');
        const para = doc.content[0];
        expect(para.content[0].text).toBe('wiki');
        expect(para.content[0].marks[0].attrs.href).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
    });

    it('converts ***bold+italic*** to text with both marks', () => {
        const doc = plainTextToDoc('This is ***important***.');
        const para = doc.content[0];
        // ***text*** → bold pass extracts *text* as bold content,
        // then italic pass extracts text from *text*
        const marked = para.content[1];
        expect(marked.text).toBe('important');
        const markTypes = marked.marks.map(m => m.type).sort();
        expect(markTypes).toEqual(['bold', 'italic']);
    });

    it('converts **[bold link](url)** to bold+link marked text', () => {
        const doc = plainTextToDoc('Visit **[our site](https://example.com)**');
        const para = doc.content[0];
        expect(para.content[0].text).toBe('Visit ');
        const linked = para.content[1];
        expect(linked.text).toBe('our site');
        const markTypes = linked.marks.map(m => m.type).sort();
        expect(markTypes).toEqual(['bold', 'link']);
        expect(linked.marks.find(m => m.type === 'link').attrs.href).toBe('https://example.com');
    });
});

describe('dual-format support', () => {
    it('buildInvoiceBody prefers emailMessageDocument when present', () => {
        const tiptapDoc = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Hello ' },
                    { type: 'templateToken', attrs: { id: 'first_name' } },
                    { type: 'text', text: ', your total is ' },
                    { type: 'templateToken', attrs: { id: 'household_total' } },
                    { type: 'text', text: '.' },
                ]
            }]
        };
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {
            emailMessage: 'Legacy text — should not appear',
            emailMessageDocument: tiptapDoc,
        });
        const body = buildInvoiceBody(ctx, 'text-only', '', 'email');
        expect(body).toContain('Hello Alice');
        expect(body).not.toContain('Legacy text');
    });

    it('buildInvoiceBody falls back to emailMessage when no document', () => {
        const ctx = getInvoiceSummaryContext(members, bills, [], 1, year, {
            emailMessage: 'Hello %first_name%, legacy path.'
        });
        const body = buildInvoiceBody(ctx, 'text-only', '', 'email');
        expect(body).toContain('Hello Alice, legacy path.');
    });
});
