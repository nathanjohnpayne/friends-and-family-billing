/**
 * Invoice helpers — extracted from legacy main.js for React consumption.
 * Pure functions, no DOM or global state dependencies.
 */
import { calculateAnnualSummary, getPaymentTotalForMember } from './calculations.js';

/**
 * Build the full invoice context for a member (mirrors main.js:4310).
 * @param {Array} familyMembers
 * @param {Array} bills
 * @param {Array} payments
 * @param {number} memberId
 * @param {{ label?: string, id?: string }} activeYear
 * @param {{ emailMessage?: string, paymentMethods?: Array }} settings
 * @returns {Object|null}
 */
export function getInvoiceSummaryContext(familyMembers, bills, payments, memberId, activeYear, settings) {
    const member = familyMembers.find(m => m.id === memberId);
    if (!member) return null;

    const summary = calculateAnnualSummary(familyMembers, bills);
    const memberData = summary[memberId];
    const linkedMembersData = (member.linkedMembers || []).map(id => summary[id]).filter(Boolean);

    let combinedTotal = memberData ? memberData.total : 0;
    linkedMembersData.forEach(d => { combinedTotal += d.total; });

    let payment = getPaymentTotalForMember(payments, memberId);
    (member.linkedMembers || []).forEach(id => { payment += getPaymentTotalForMember(payments, id); });
    const balance = combinedTotal - payment;

    const currentYear = activeYear ? (activeYear.label || activeYear.id) : String(new Date().getFullYear());
    const firstName = member.name.split(' ')[0];
    const amountStr = balance > 0 ? '$' + balance.toFixed(2) : '$' + combinedTotal.toFixed(2);
    const amountLabel = balance > 0 && payment > 0 ? 'remaining balance' : 'total';
    const numMembers = 1 + (member.linkedMembers || []).length;

    return { member, firstName, combinedTotal, payment, balance, amountStr, amountLabel, currentYear, linkedMembersData, memberData, numMembers, settings: settings || {} };
}

/**
 * Build invoice email subject line.
 * Supports an optional template with tokens: %billing_year%, %member_name%, %annual_total%.
 * Falls back to a default subject when no template is provided.
 */
export function buildInvoiceSubject(year, member, template, ctx) {
    if (!template) return 'Annual Billing Summary ' + year + '\u2014' + member.name;
    let result = template
        .replace(/%billing_year%/g, year)
        .replace(/%member_name%/g, member.name);
    if (ctx) {
        const total = ctx.combinedTotal != null ? '$' + ctx.combinedTotal.toFixed(2) : '';
        result = result.replace(/%annual_total%/g, total);
    }
    return result;
}

/**
 * Simple template variable replacement for invoice messages.
 */
function buildInvoiceTemplatePreviewText(template, ctx) {
    let result = String(template || '')
        .replace(/%member_first%/g, ctx.memberFirst || '')
        .replace(/%member_last%/g, ctx.memberLast || '')
        .replace(/%member_name%/g, ctx.memberName || '')
        .replace(/%billing_year%/g, ctx.billingYear)
        .replace(/%annual_total%/g, ctx.annualTotal)
        .replace(/%total%/g, ctx.annualTotal)
        .replace(/%total\b/g, ctx.annualTotal)
        .replace(/%share_link%/g, ctx.shareLink || '');

    // Clean up markdown links with empty URLs: [text]() → remove entire construct
    // Also clean bare []() and lines that became empty after removal
    result = result.replace(/\[([^\]]*)\]\(\s*\)/g, '');

    return result;
}

/**
 * Format enabled payment methods as text block.
 */
function formatPaymentOptionsText(settings) {
    const methods = ((settings && settings.paymentMethods) || []).filter(m => m.enabled);
    if (methods.length === 0) return '';

    let text = '\nPayment methods:\n';
    methods.forEach(method => {
        text += '\n' + method.label + '\n';
        if (method.type === 'zelle') {
            const contacts = [method.email, method.phone].filter(Boolean);
            if (contacts.length > 0) text += 'Send via Zelle to: ' + contacts.join(' or ') + '\n';
        } else if (method.type === 'apple_cash') {
            const contacts = [method.phone, method.email].filter(Boolean);
            if (contacts.length > 0) text += 'Send via Messages or Wallet to: ' + contacts.join(' or ') + '\n';
        } else {
            if (method.handle) text += method.handle + '\n';
            if (method.url) text += method.url + '\n';
        }
        if (method.instructions) text += 'Note: ' + method.instructions + '\n';
    });
    return text.trimEnd();
}

/**
 * Format enabled payment methods as a markdown list.
 */
function formatPaymentOptionsMarkdown(settings) {
    const methods = ((settings && settings.paymentMethods) || []).filter(m => m.enabled);
    if (methods.length === 0) return '';

    let text = '\n## Payment Options\n\n';
    methods.forEach(method => {
        let detail = '';
        if (method.type === 'zelle') {
            const contacts = [method.email, method.phone].filter(Boolean);
            if (contacts.length > 0) detail = 'Send via Zelle to: ' + contacts.join(' or ');
        } else if (method.type === 'apple_cash') {
            const contacts = [method.phone, method.email].filter(Boolean);
            if (contacts.length > 0) detail = 'Send via Messages or Wallet to: ' + contacts.join(' or ');
        } else {
            const parts = [];
            if (method.handle) parts.push(method.handle);
            if (method.url) parts.push('[' + method.url + '](' + method.url + ')');
            detail = parts.join(' ');
        }
        text += '- **' + method.label + ':** ' + detail + '\n';
        if (method.instructions) text += '  Note: ' + method.instructions + '\n';
    });
    return text.trimEnd();
}

/**
 * Build the configured invoice message from template + context.
 * @param {Object} ctx
 * @param {string} shareUrl
 * @param {{ markdown?: boolean }} options — when true, use markdown-formatted payment methods
 */
function buildConfiguredInvoiceMessage(ctx, shareUrl, options) {
    const template = (ctx.settings && ctx.settings.emailMessage) || '';
    const formatter = (options && options.markdown) ? formatPaymentOptionsMarkdown : formatPaymentOptionsText;
    const nameParts = (ctx.member.name || '').split(' ');
    let result = buildInvoiceTemplatePreviewText(template, {
        memberFirst: nameParts[0] || '',
        memberLast: nameParts.slice(1).join(' ') || '',
        memberName: ctx.member.name || '',
        billingYear: ctx.currentYear,
        annualTotal: '$' + ctx.combinedTotal.toFixed(2),
        shareLink: shareUrl || ''
    }).replace(/%payment_methods%/g, formatter(ctx.settings)).trim();

    // In markdown mode, convert bare share URLs (not already inside markdown links)
    // into named hyperlinks: "Name's Year Annual Billing Summary"
    // Skip URLs already inside [...] (link text) or (...) (link destination)
    if (options && options.markdown && shareUrl) {
        const linkText = ctx.member.name + '\u2019s ' + ctx.currentYear + ' Annual Billing Summary';
        const escaped = shareUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp('(?<![\\[\\(])' + escaped + '(?![\\]\\)])', 'g'),
            '[' + linkText + '](' + shareUrl + ')');
    }
    return result;
}

/**
 * Build full detailed invoice text with bill breakdowns (mirrors main.js:4372).
 */
function buildFullInvoiceText(ctx, shareUrl) {
    const { member, firstName, combinedTotal, payment, balance, currentYear, linkedMembersData, memberData, numMembers } = ctx;
    const paymentPerPerson = numMembers > 0 ? payment / numMembers : 0;

    const emailMessage = buildConfiguredInvoiceMessage(ctx, shareUrl);
    let text = emailMessage + '\n\n';
    if (shareUrl) {
        text += 'View your billing summary & pay online:\n' + shareUrl + '\n\n';
    }
    text += '======================================\n';
    text += 'ANNUAL BILLING SUMMARY - ' + currentYear + '\n';
    text += '======================================\n\n';
    text += 'Primary: ' + member.name + '\n';

    if (linkedMembersData.length > 0) {
        text += 'Linked Members: ' + linkedMembersData.map(d => d.member.name).join(', ') + '\n';
    }
    text += 'Invoice Date: ' + new Date().toLocaleDateString() + '\n\n';

    function renderBillTable(data, label) {
        let section = '';
        if (data && data.bills.length > 0) {
            section += label.toUpperCase() + "'S BILLS:\n";
            section += '='.repeat(80) + '\n';
            const shareLabel = label === member.name ? 'Your Share' : 'Their Share';
            section += 'Bill'.padEnd(25) + ' ' + 'Amount'.padEnd(14) + ' ' + 'Split'.padEnd(8) + ' ' + shareLabel.padEnd(14) + ' ' + 'Annual' + '\n';
            section += '-'.repeat(80) + '\n';
            let monthlyTotal = 0;
            data.bills.forEach(b => {
                const billName = b.bill.name.padEnd(25).substring(0, 25);
                const isAnnual = b.bill.billingFrequency === 'annual';
                const billAmount = isAnnual
                    ? ('$' + b.bill.amount.toFixed(2) + ' / year').padEnd(18)
                    : ('$' + b.bill.amount.toFixed(2) + ' / month').padEnd(18);
                const splitWith = (b.bill.members.length + ' ppl').padEnd(8);
                const share = ('$' + b.monthlyShare.toFixed(2) + ' / month').padEnd(18);
                const annual = '$' + b.annualShare.toFixed(2);
                section += billName + ' ' + billAmount + ' ' + splitWith + ' ' + share + ' ' + annual + '\n';
                monthlyTotal += b.monthlyShare;
            });
            section += '-'.repeat(80) + '\n';
            section += 'SUBTOTAL: $' + monthlyTotal.toFixed(2) + ' / month = $' + data.total.toFixed(2) + ' / year\n';
            section += '='.repeat(80) + '\n\n';
        }
        return section;
    }

    text += renderBillTable(memberData, member.name);
    linkedMembersData.forEach(ld => { text += renderBillTable(ld, ld.member.name); });

    text += 'ANNUAL PAYMENT SUMMARY:\n';
    text += '='.repeat(80) + '\n';
    text += '  Combined Annual Total:         $' + combinedTotal.toFixed(2) + '\n';
    if (payment > 0) {
        text += '  Payment Received:              $' + payment.toFixed(2) + '\n';
        text += '  Payment Per Person (' + numMembers + ' members):   $' + paymentPerPerson.toFixed(2) + '\n';
        text += '  Balance Remaining:             $' + balance.toFixed(2) + '\n';
    } else {
        text += '  Payment Received:              $0.00\n';
        text += '  Balance Remaining:             $' + balance.toFixed(2) + '\n';
    }
    text += '='.repeat(80) + '\n';

    const paymentOptionsText = formatPaymentOptionsText(ctx.settings);
    if (paymentOptionsText) text += paymentOptionsText;

    text += '\n\nThank you for your prompt payment!\n';
    return text;
}

/**
 * Build invoice body text for a given variant and channel (mirrors main.js:4338).
 * @param {Object} ctx — from getInvoiceSummaryContext
 * @param {'text-only'|'text-link'|'full'} variant
 * @param {string} shareUrl
 * @param {'email'|'sms'} channel
 * @param {{ markdown?: boolean }} [options] — pass { markdown: true } for preview rendering
 * @returns {string}
 */
export function buildInvoiceBody(ctx, variant, shareUrl, channel, options) {
    const { firstName, amountStr, amountLabel, currentYear } = ctx;
    const isEmail = channel === 'email';
    const configuredMessage = buildConfiguredInvoiceMessage(ctx, shareUrl, options);

    if (variant === 'text-only') {
        if (isEmail && configuredMessage) {
            return configuredMessage;
        }
        const greeting = isEmail ? 'Hello' : 'Hey';
        return greeting + ' ' + firstName + '\u2014your annual shared bills for ' + currentYear + ' are ready. Your ' + amountLabel + ' is ' + amountStr + '. Thanks!';
    }

    if (variant === 'full') {
        return buildFullInvoiceText(ctx, shareUrl);
    }

    // Default: text-link
    if (isEmail && configuredMessage) {
        let msg = configuredMessage;
        if (shareUrl) msg += '\n\nView your billing summary:\n' + shareUrl;
        return msg;
    }

    const greeting = isEmail ? 'Hello' : 'Hey';
    let msg = greeting + ' ' + firstName + '\u2014your annual shared bills for ' + currentYear + ' are ready. Your ' + amountLabel + ' is ' + amountStr + '.\n\nThanks!';
    if (shareUrl) msg += '\n\n' + shareUrl;
    return msg;
}

// ── CommonMark renderer (spec: https://spec.commonmark.org/0.31.2/) ──
// Uses unified + remark-parse + remark-rehype + rehype-sanitize + rehype-stringify
// for spec-compliant parsing, with remark-breaks for email-style single-newline breaks.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

/** Sanitization schema: default HTML elements + target/rel on links */
const sanitizeSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        a: [...(defaultSchema.attributes?.a || []), 'target', 'rel']
    }
};

/** rehype plugin: add target="_blank" rel="noopener noreferrer" to all <a> tags */
function rehypeExternalLinks() {
    return (tree) => {
        function visit(node) {
            if (node.type === 'element' && node.tagName === 'a') {
                node.properties = node.properties || {};
                node.properties.target = '_blank';
                node.properties.rel = 'noopener noreferrer';
            }
            if (node.children) node.children.forEach(visit);
        }
        visit(tree);
    };
}

const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkBreaks)
    .use(remarkRehype)
    .use(rehypeExternalLinks)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);

/**
 * Render a plain text string as HTML using CommonMark (via unified/remark).
 * Supports: paragraphs, headings, emphasis, strong, code spans, links,
 * autolinks, lists, blockquotes, thematic breaks, line breaks.
 * Output is sanitized — safe for dangerouslySetInnerHTML.
 * @param {string} text — raw preview text (with tokens already substituted)
 * @returns {string} — sanitized HTML string
 */
export function renderPreviewHTML(text) {
    if (!text) return '';
    return String(markdownProcessor.processSync(text));
}
