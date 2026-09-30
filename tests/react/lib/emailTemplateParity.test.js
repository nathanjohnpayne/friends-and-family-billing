// @vitest-environment node
/**
 * Test-email parity: the "Send test email" action queues the template's
 * markdown serialization, and the processMailQueue Cloud Function renders it
 * to HTML with simpleMarkdownToHtml. That server rendering must carry the same
 * rich-text semantics as the client preview (renderInvoiceTemplate) for every
 * construct the template serializer emits: bold, italic, bold+italic, links,
 * bullet lists, ordered lists, blockquotes, horizontal rules, the share-link
 * token and the payment-methods block.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { getInvoiceSummaryContext, buildInvoiceTemplateEmailPayload } from '@/lib/invoice.js';

const require = createRequire(import.meta.url);
const { simpleMarkdownToHtml } = require('../../../functions/index.js')._testHelpers;

const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...content) => ({ type: 'paragraph', content });
const item = (...content) => ({ type: 'listItem', content: [para(...content)] });

const templateDoc = {
    type: 'doc',
    content: [
        para(text('Hi '), { type: 'templateToken', attrs: { id: 'first_name' } }, text(',')),
        para(
            text('This year is '), text('important', [{ type: 'bold' }]),
            text(' and '), text('gentle', [{ type: 'italic' }]),
            text(' and '), text('both', [{ type: 'bold' }, { type: 'italic' }]),
            text('. See '), text('our site', [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } }]), text('.'),
        ),
        { type: 'orderedList', content: [item(text('Review the total')), item(text('Pay by '), text('June', [{ type: 'italic' }]))] },
        { type: 'bulletList', content: [item(text('Internet')), item(text('Streaming'))] },
        { type: 'blockquote', content: [para(text('Thanks for being on the plan.')), para(text('Questions? Just reply.'))] },
        { type: 'horizontalRule' },
        para(text('Summary: '), { type: 'templateToken', attrs: { id: 'share_link' } }),
        { type: 'blockToken', attrs: { id: 'payment_methods' } },
        para(text('Total <due>: '), { type: 'templateToken', attrs: { id: 'household_total' } }),
        // Literal text that looks like markdown must stay literal (no em/list/quote/rule).
        para(text('Split 2*3*4 ways, see [note] and C:\\path')),
        para(text('- not a list')),
        para(text('> not a quote')),
        para(text('1. not an ordered item')),
        para(text('---')),
        para(text('# not a heading')),
    ],
};

const familyMembers = [{ id: 1, name: 'Alice Smith', email: 'alice@example.com', linkedMembers: [] }];
const bills = [{ id: 10, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1] }];
const settings = {
    emailMessageDocument: templateDoc,
    paymentMethods: [
        { id: 'pm1', type: 'venmo', label: 'Venmo', enabled: true, handle: '@alice-pay', url: 'https://venmo.com/u/alice-pay', instructions: 'Add a *memo* [ref]' },
        { id: 'pm2', type: 'zelle', label: 'Zelle', enabled: true, email: 'pay@example.com' },
    ],
};
const shareUrl = 'https://friends-and-family-billing.web.app/share?token=' + 'a'.repeat(64);

function semantics(html) {
    const d = new JSDOM('<body>' + html + '</body>').window.document;
    const norm = s => s.replace(/\s+/g, ' ').trim();
    const texts = sel => [...d.querySelectorAll(sel)].map(e => norm(e.textContent));
    return {
        strong: texts('strong'),
        em: texts('em'),
        ol: texts('ol > li'),
        ul: texts('ul > li'),
        blockquote: texts('blockquote p'),
        links: [...d.querySelectorAll('a')].map(a => [norm(a.textContent), a.getAttribute('href')]),
        hr: d.querySelectorAll('hr').length,
        scripts: d.querySelectorAll('script, due').length,
        fullText: norm(d.body.textContent),
    };
}

describe('test email server rendering matches the client preview', () => {
    const ctx = getInvoiceSummaryContext(familyMembers, bills, [], 1, { id: '2026', label: '2026' }, settings);
    const payload = buildInvoiceTemplateEmailPayload(ctx, shareUrl);
    const client = semantics(payload.html);
    const server = semantics(simpleMarkdownToHtml(payload.markdown));

    it('keeps bold and italic spans (including bold+italic)', () => {
        expect(server.em).toEqual(client.em);
        expect(server.strong).toEqual(client.strong);
        expect(server.em).toEqual(expect.arrayContaining(['gentle', 'both', 'June']));
    });

    it('keeps ordered and bullet list items (including the payment-methods list)', () => {
        expect(server.ol).toEqual(client.ol);
        expect(server.ol).toEqual(['Review the total', 'Pay by June']);
        expect(server.ul).toEqual(client.ul);
    });

    it('keeps blockquote paragraphs', () => {
        expect(server.blockquote).toEqual(client.blockquote);
        expect(server.blockquote).toEqual(['Thanks for being on the plan.', 'Questions? Just reply.']);
    });

    it('keeps links (named share link, marked link, payment URL) with the same hrefs', () => {
        expect(server.links).toEqual(client.links);
    });

    it('keeps horizontal rules and escapes template text', () => {
        expect(server.hr).toBe(client.hr);
        expect(server.hr).toBe(1);
        expect(server.scripts).toBe(0);
        expect(server.fullText).toContain('Total <due>: $1200.00');
        expect(client.fullText).toContain('Total <due>: $1200.00');
    });
});

describe('literal template text stays literal in the server rendering', () => {
    const ctx = getInvoiceSummaryContext(familyMembers, bills, [], 1, { id: '2026', label: '2026' }, settings);
    const payload = buildInvoiceTemplateEmailPayload(ctx, shareUrl);
    const serverHtml = simpleMarkdownToHtml(payload.markdown);
    const client = semantics(payload.html);
    const server = semantics(serverHtml);

    it('shows markdown-looking characters verbatim, matching the preview text', () => {
        for (const literal of [
            'Split 2*3*4 ways, see [note] and C:\\path',
            '- not a list',
            '> not a quote',
            '1. not an ordered item',
            '# not a heading',
            'Add a *memo* [ref]',
        ]) {
            expect(client.fullText).toContain(literal);
            expect(server.fullText).toContain(literal);
        }
        expect(serverHtml).toMatch(/(^|>|\n)---(<br>|\n|$)/);
    });

    it('adds no structure the preview does not have', () => {
        expect(server.em).toEqual(client.em);
        expect(server.ol).toEqual(client.ol);
        expect(server.ul).toEqual(client.ul);
        expect(server.blockquote).toEqual(client.blockquote);
        expect(server.hr).toBe(client.hr);
    });
});

describe('simpleMarkdownToHtml escaping', () => {
    it('escapes HTML inside italic, list, ordered-list and blockquote content', () => {
        const html = simpleMarkdownToHtml('*<img src=x onerror=1>*\n- <script>x</script>\n1. <b>y</b>\n> <iframe>');
        expect(html).not.toMatch(/<(img|script|b|iframe)[\s>]/i);
        expect(html).toContain('<em>&lt;img src=x onerror=1&gt;</em>');
        expect(html).toContain('<ol><li>&lt;b&gt;y&lt;/b&gt;</li></ol>');
        expect(html).toContain('<blockquote><p>&lt;iframe&gt;</p></blockquote>');
    });

    it('does not italicize spaced asterisks and drops unsafe link protocols', () => {
        expect(simpleMarkdownToHtml('2 * 3 * 4')).toBe('2 * 3 * 4');
        expect(simpleMarkdownToHtml('[x](javascript:alert(1))')).not.toContain('href');
    });
});
