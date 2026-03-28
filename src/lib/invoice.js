/**
 * Invoice helpers — extracted from legacy main.js for React consumption.
 * Pure functions, no DOM or global state dependencies.
 */
import { calculateAnnualSummary, getPaymentTotalForMember } from './calculations.js';
import { escapeHtml } from './formatting.js';

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
 */
export function buildInvoiceSubject(year, member) {
    return 'Annual Billing Summary ' + year + '\u2014' + member.name;
}

/**
 * Simple template variable replacement for invoice messages.
 */
function buildInvoiceTemplatePreviewText(template, ctx) {
    return String(template || '')
        .replace(/%billing_year%/g, ctx.billingYear)
        .replace(/%annual_total%/g, ctx.annualTotal)
        .replace(/%total%/g, ctx.annualTotal)
        .replace(/%total\b/g, ctx.annualTotal);
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
 * Build the configured invoice message from template + context.
 */
function buildConfiguredInvoiceMessage(ctx) {
    const template = (ctx.settings && ctx.settings.emailMessage) || '';
    return buildInvoiceTemplatePreviewText(template, {
        billingYear: ctx.currentYear,
        annualTotal: '$' + ctx.combinedTotal.toFixed(2)
    }).replace(/%payment_methods%/g, formatPaymentOptionsText(ctx.settings)).trim();
}

/**
 * Build full detailed invoice text with bill breakdowns (mirrors main.js:4372).
 */
function buildFullInvoiceText(ctx, shareUrl) {
    const { member, firstName, combinedTotal, payment, balance, currentYear, linkedMembersData, memberData, numMembers } = ctx;
    const paymentPerPerson = numMembers > 0 ? payment / numMembers : 0;

    const emailMessage = buildConfiguredInvoiceMessage(ctx);
    let text = 'Hello ' + firstName + ',\n\n' + emailMessage + '\n\n';
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
 * @returns {string}
 */
export function buildInvoiceBody(ctx, variant, shareUrl, channel) {
    const { firstName, amountStr, amountLabel, currentYear } = ctx;
    const isEmail = channel === 'email';
    const configuredMessage = buildConfiguredInvoiceMessage(ctx);

    if (variant === 'text-only') {
        if (isEmail && configuredMessage) {
            return 'Hello ' + firstName + ',\n\n' + configuredMessage;
        }
        const greeting = isEmail ? 'Hello' : 'Hey';
        return greeting + ' ' + firstName + '\u2014your annual shared bills for ' + currentYear + ' are ready. Your ' + amountLabel + ' is ' + amountStr + '. Thanks!';
    }

    if (variant === 'full') {
        return buildFullInvoiceText(ctx, shareUrl);
    }

    // Default: text-link
    if (isEmail && configuredMessage) {
        let msg = 'Hello ' + firstName + ',\n\n' + configuredMessage;
        if (shareUrl) msg += '\n\nView your billing summary:\n' + shareUrl;
        return msg;
    }

    const greeting = isEmail ? 'Hello' : 'Hey';
    let msg = greeting + ' ' + firstName + '\u2014your annual shared bills for ' + currentYear + ' are ready. Your ' + amountLabel + ' is ' + amountStr + '.\n\nThanks!';
    if (shareUrl) msg += '\n\n' + shareUrl;
    return msg;
}

// ── CommonMark subset renderer (spec: https://spec.commonmark.org/0.31.2/) ──

/**
 * Apply inline markdown formatting to an HTML-escaped line.
 * Processes: code spans, bold, italic, links, autolinks, backslash escapes.
 */
function renderInlineMarkdown(escaped) {
    // Code spans: `code` (process first — contents are literal, no nesting)
    let text = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold: **text** or __text__
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_ (run after bold to avoid conflicts)
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');

    // Inline links: [text](url) — only http(s) URLs for security
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Autolinks: <https://...> or <http://...>
    text = text.replace(/&lt;(https?:\/\/[^&]+)&gt;/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // Backslash escapes for markdown punctuation (per CommonMark spec)
    text = text.replace(/\\([\\`*_\[\]()#+\-.!{|}~])/g, '$1');

    return text;
}

/**
 * Render a plain text string as HTML using a CommonMark subset.
 * Supports: paragraphs, headings (h1-h3), blockquotes, thematic breaks,
 * unordered/ordered lists, bold, italic, code spans, links, autolinks.
 * @param {string} text — raw preview text (with tokens already substituted)
 * @returns {string} — safe HTML string
 */
export function renderPreviewHTML(text) {
    if (!text) return '';

    const lines = text.split('\n');
    const html = [];
    let i = 0;

    function collectParagraph() {
        const pLines = [];
        while (i < lines.length && lines[i].trim() !== '') {
            const line = lines[i].trim();
            // Stop if this line starts a different block type
            if (/^#{1,3}\s/.test(line) || /^[-*_]{3,}\s*$/.test(line) ||
                /^>\s/.test(line) || /^[-*+]\s/.test(line) || /^\d+[.)]\s/.test(line)) {
                break;
            }
            pLines.push(renderInlineMarkdown(escapeHtml(line)));
            i++;
        }
        return pLines;
    }

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Blank line — skip
        if (trimmed === '') { i++; continue; }

        // ATX headings: # through ###
        const headingMatch = trimmed.match(/^(#{1,3})\s+(.+?)(?:\s+#+\s*)?$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const content = renderInlineMarkdown(escapeHtml(headingMatch[2]));
            html.push('<h' + level + '>' + content + '</h' + level + '>');
            i++;
            continue;
        }

        // Thematic breaks: --- or *** or ___
        if (/^[-*_]{3,}\s*$/.test(trimmed)) {
            html.push('<hr>');
            i++;
            continue;
        }

        // Blockquote: > text
        if (/^>\s?/.test(trimmed)) {
            const quoteLines = [];
            while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
                quoteLines.push(escapeHtml(lines[i].trim().replace(/^>\s?/, '')));
                i++;
            }
            html.push('<blockquote><p>' + quoteLines.map(renderInlineMarkdown).join('<br>') + '</p></blockquote>');
            continue;
        }

        // Unordered list: - item, * item, + item
        if (/^[-*+]\s/.test(trimmed)) {
            html.push('<ul>');
            while (i < lines.length && /^[-*+]\s/.test(lines[i].trim())) {
                const itemText = lines[i].trim().replace(/^[-*+]\s+/, '');
                html.push('<li>' + renderInlineMarkdown(escapeHtml(itemText)) + '</li>');
                i++;
            }
            html.push('</ul>');
            continue;
        }

        // Ordered list: 1. item or 1) item
        if (/^\d+[.)]\s/.test(trimmed)) {
            html.push('<ol>');
            while (i < lines.length && /^\d+[.)]\s/.test(lines[i].trim())) {
                const itemText = lines[i].trim().replace(/^\d+[.)]\s+/, '');
                html.push('<li>' + renderInlineMarkdown(escapeHtml(itemText)) + '</li>');
                i++;
            }
            html.push('</ol>');
            continue;
        }

        // Default: paragraph — collect consecutive non-blank, non-block lines
        const pLines = collectParagraph();
        if (pLines.length > 0) {
            html.push('<p>' + pLines.join('<br>') + '</p>');
        }
    }

    return html.join('\n');
}
