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
 * Supports an optional template with tokens: %billing_year%, %member_name%,
 * %member_first%, %member_last%, %annual_total%.
 * Falls back to a default subject when no template is provided.
 */
export function buildInvoiceSubject(year, member, template, ctx) {
    if (!template) return 'Annual Billing Summary ' + year + '\u2014' + member.name;
    const nameParts = (member.name || '').split(' ');
    let result = template
        .replace(/%member_first%/g, nameParts[0] || '')
        .replace(/%first_name%/g, nameParts[0] || '')
        .replace(/%member_last%/g, nameParts.slice(1).join(' ') || '')
        .replace(/%last_name%/g, nameParts.slice(1).join(' ') || '')
        .replace(/%member_name%/g, member.name)
        .replace(/%full_name%/g, member.name)
        .replace(/%billing_year%/g, year);
    if (ctx) {
        const total = ctx.combinedTotal != null ? '$' + ctx.combinedTotal.toFixed(2) : '';
        result = result.replace(/%annual_total%/g, total);
        result = result.replace(/%household_total%/g, total);
    }
    return result;
}

/**
 * Simple template variable replacement for invoice messages.
 */
function buildInvoiceTemplatePreviewText(template, ctx) {
    let result = String(template || '')
        .replace(/%member_first%/g, ctx.memberFirst || '')
        .replace(/%first_name%/g, ctx.memberFirst || '')
        .replace(/%member_last%/g, ctx.memberLast || '')
        .replace(/%last_name%/g, ctx.memberLast || '')
        .replace(/%member_name%/g, ctx.memberName || '')
        .replace(/%full_name%/g, ctx.memberName || '')
        .replace(/%billing_year%/g, ctx.billingYear)
        .replace(/%annual_total%/g, ctx.annualTotal)
        .replace(/%household_total%/g, ctx.annualTotal)
        .replace(/%total%/g, ctx.annualTotal)
        .replace(/%share_link%/g, ctx.shareLink || '');

    // Clean up markdown links with empty URLs: [text]() → remove entire construct
    // Also clean bare []() and lines that became empty after removal
    result = result.replace(/\[([^\]]*)\]\(\s*\)/g, '');

    return result;
}

/**
 * Sort payment methods: preferred first, then alphabetical by label.
 */
function sortPaymentMethods(methods) {
    return methods.slice().sort((a, b) => {
        if (a.preferred && !b.preferred) return -1;
        if (!a.preferred && b.preferred) return 1;
        return a.label.localeCompare(b.label);
    });
}

/**
 * Format enabled payment methods as text block.
 */
function formatPaymentOptionsText(settings) {
    const methods = sortPaymentMethods(((settings && settings.paymentMethods) || []).filter(m => m.enabled));
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
    const methods = sortPaymentMethods(((settings && settings.paymentMethods) || []).filter(m => m.enabled));
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

// Re-export template document utilities from the lightweight module.
// Defined in template-doc.js to keep BillingYearService's import chain light.
export { docToPlainTextWithTokens, plainTextToDoc } from './template-doc.js';
import { docToPlainTextWithTokens, plainTextToDoc } from './template-doc.js';

const TEMPLATE_TOKEN_ALIASES = {
    member_first: 'first_name',
    member_last: 'last_name',
    member_name: 'full_name',
    annual_total: 'household_total',
};

const INVOICE_TEMPLATE_STYLES = {
    paragraph: 'margin:0 0 14px 0;color:#1F2430;font-size:15px;line-height:1.6;font-weight:400;',
    spacer: 'margin:0 0 14px 0;color:#1F2430;font-size:15px;line-height:1.6;font-weight:400;',
    strong: 'font-weight:600;',
    emphasis: 'font-style:italic;',
    link: 'color:#6E78D6;text-decoration:underline;',
    sectionLabel: 'margin:0 0 12px 0;color:#1F2430;font-size:15px;line-height:1.6;font-weight:600;',
    list: 'margin:0 0 16px 22px;padding:0;color:#1F2430;font-size:15px;line-height:1.6;',
    orderedList: 'margin:0 0 16px 22px;padding:0;color:#1F2430;font-size:15px;line-height:1.6;',
    listItem: 'margin:0 0 8px 0;',
    hr: 'border:none;border-top:1px solid rgba(31,36,48,0.45);margin:14px 0;',
    blockquote: 'margin:0 0 14px 0;padding:0 0 0 12px;border-left:3px solid rgba(110,120,214,0.4);color:#5B6475;',
};

function getInvoiceTemplateDocument(settings) {
    if (settings?.emailMessageDocument) return settings.emailMessageDocument;
    if (settings?.emailMessage) return plainTextToDoc(settings.emailMessage);
    return null;
}

function normalizeTemplateTokenId(id) {
    return TEMPLATE_TOKEN_ALIASES[id] || id;
}

function resolveTemplateTokenValue(id, ctx, shareUrl) {
    switch (normalizeTemplateTokenId(id)) {
        case 'first_name':
            return ctx.firstName || '';
        case 'last_name': {
            const parts = (ctx.member?.name || '').split(' ');
            return parts.slice(1).join(' ') || '';
        }
        case 'full_name':
            return ctx.member?.name || '';
        case 'billing_year':
            return ctx.currentYear || '';
        case 'household_total':
            return ctx.combinedTotal != null ? '$' + ctx.combinedTotal.toFixed(2) : '';
        case 'share_link':
            return shareUrl || '';
        default:
            return '';
    }
}

function sanitizeInvoiceHref(url) {
    const raw = String(url || '').trim();
    if (!/^https?:\/\//i.test(raw)) return '';
    return raw
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function wrapInlineHtml(html, marks) {
    if (!html) return '';
    const safeMarks = marks || [];
    let result = html;

    if (safeMarks.some(mark => mark.type === 'bold')) {
        result = '<strong style="' + INVOICE_TEMPLATE_STYLES.strong + '">' + result + '</strong>';
    }
    if (safeMarks.some(mark => mark.type === 'italic')) {
        result = '<em style="' + INVOICE_TEMPLATE_STYLES.emphasis + '">' + result + '</em>';
    }

    const linkMark = safeMarks.find(mark => mark.type === 'link' && mark.attrs?.href);
    if (linkMark) {
        const href = sanitizeInvoiceHref(linkMark.attrs.href);
        if (href) {
            result = '<a href="' + href + '" target="_blank" rel="noopener noreferrer" style="' + INVOICE_TEMPLATE_STYLES.link + '">' + result + '</a>';
        }
    }

    return result;
}

function renderTemplateInlineNodes(nodes, ctx, shareUrl) {
    if (!nodes || nodes.length === 0) return '';

    return nodes.map(node => {
        if (node.type === 'text') {
            return wrapInlineHtml(escapeHtml(node.text || ''), node.marks);
        }

        if (node.type === 'templateToken') {
            const id = normalizeTemplateTokenId(node.attrs?.id);
            if (id === 'share_link') {
                return renderShareLinkInlineHtml(ctx, shareUrl, node.marks);
            }
            const value = resolveTemplateTokenValue(node.attrs?.id, ctx, shareUrl);
            return wrapInlineHtml(escapeHtml(value), node.marks);
        }

        if (node.type === 'hardBreak') {
            return '<br>';
        }

        return '';
    }).join('');
}

function renderPaymentMethodDetailHtml(method) {
    if (method.type === 'zelle') {
        const contacts = [method.email, method.phone].filter(Boolean).map(escapeHtml);
        return contacts.length > 0 ? 'Send via Zelle to: ' + contacts.join(' or ') : '';
    }

    if (method.type === 'apple_cash') {
        const contacts = [method.phone, method.email].filter(Boolean).map(escapeHtml);
        return contacts.length > 0 ? 'Send via Messages or Wallet to: ' + contacts.join(' or ') : '';
    }

    const parts = [];
    if (method.handle) parts.push(escapeHtml(method.handle));
    if (method.url) {
        const href = sanitizeInvoiceHref(method.url);
        const label = escapeHtml(method.url);
        parts.push(href
            ? '<a href="' + href + '" target="_blank" rel="noopener noreferrer" style="' + INVOICE_TEMPLATE_STYLES.link + '">' + label + '</a>'
            : label);
    }

    return parts.join(' ');
}

function renderPaymentMethodsHtml(settings) {
    const methods = sortPaymentMethods(((settings && settings.paymentMethods) || []).filter(method => method.enabled));
    if (methods.length === 0) return '';

    const items = methods.map(method => {
        const detail = renderPaymentMethodDetailHtml(method);
        const instruction = method.instructions
            ? '<br><span>' + escapeHtml('Note: ' + method.instructions) + '</span>'
            : '';

        return '<li style="' + INVOICE_TEMPLATE_STYLES.listItem + '">'
            + '<strong style="' + INVOICE_TEMPLATE_STYLES.strong + '">' + escapeHtml(method.label) + ':</strong>'
            + (detail ? ' ' + detail : '')
            + instruction
            + '</li>';
    }).join('');

    return '<p style="' + INVOICE_TEMPLATE_STYLES.sectionLabel + '">Payment Options</p>'
        + '<ul style="' + INVOICE_TEMPLATE_STYLES.list + '">' + items + '</ul>';
}

/** Block-level share link rendering (backward compat for existing blockToken documents). */
function renderShareLinkHtml(ctx, shareUrl) {
    if (!shareUrl) return '';
    const href = sanitizeInvoiceHref(shareUrl);
    if (!href) return '';
    const linkText = escapeHtml(ctx.member.name + '\u2019s ' + ctx.currentYear + ' Annual Billing Summary');

    return '<p style="' + INVOICE_TEMPLATE_STYLES.paragraph + '">'
        + '<a href="' + href + '" target="_blank" rel="noopener noreferrer" style="' + INVOICE_TEMPLATE_STYLES.link + '">' + linkText + '</a>'
        + '</p>';
}

/** Inline share link rendering — produces a clickable <a> with marks (bold/italic). */
function renderShareLinkInlineHtml(ctx, shareUrl, marks) {
    if (!shareUrl) return '';
    const href = sanitizeInvoiceHref(shareUrl);
    if (!href) return '';
    const linkText = escapeHtml(ctx.member.name + '\u2019s ' + ctx.currentYear + ' Annual Billing Summary');
    const html = '<a href="' + href + '" target="_blank" rel="noopener noreferrer" style="' + INVOICE_TEMPLATE_STYLES.link + '">' + linkText + '</a>';
    return wrapInlineHtml(html, marks);
}

function renderTemplateListItems(items, ordered, ctx, shareUrl) {
    const tagName = ordered ? 'ol' : 'ul';
    const listStyle = ordered ? INVOICE_TEMPLATE_STYLES.orderedList : INVOICE_TEMPLATE_STYLES.list;
    const html = (items || []).map(item => {
        const parts = (item.content || []).map(child => {
            if (child.type === 'paragraph') return renderTemplateInlineNodes(child.content, ctx, shareUrl);
            if (child.type === 'bulletList') return renderTemplateListItems(child.content, false, ctx, shareUrl);
            if (child.type === 'orderedList') return renderTemplateListItems(child.content, true, ctx, shareUrl);
            return '';
        }).filter(Boolean);

        return '<li style="' + INVOICE_TEMPLATE_STYLES.listItem + '">' + parts.join('<br>') + '</li>';
    }).join('');

    return html ? '<' + tagName + ' style="' + listStyle + '">' + html + '</' + tagName + '>' : '';
}

function renderTemplateBlocks(nodes, ctx, shareUrl) {
    if (!nodes || nodes.length === 0) return '';

    return nodes.map(node => {
        switch (node.type) {
            case 'paragraph': {
                const contentHtml = renderTemplateInlineNodes(node.content, ctx, shareUrl);
                const body = contentHtml || '&nbsp;';
                return '<p style="' + (contentHtml ? INVOICE_TEMPLATE_STYLES.paragraph : INVOICE_TEMPLATE_STYLES.spacer) + '">' + body + '</p>';
            }
            case 'blockToken': {
                const id = normalizeTemplateTokenId(node.attrs?.id);
                if (id === 'share_link') return renderShareLinkHtml(ctx, shareUrl);
                if (id === 'payment_methods') return renderPaymentMethodsHtml(ctx.settings);
                return '';
            }
            case 'bulletList':
                return renderTemplateListItems(node.content, false, ctx, shareUrl);
            case 'orderedList':
                return renderTemplateListItems(node.content, true, ctx, shareUrl);
            case 'horizontalRule':
                return '<hr style="' + INVOICE_TEMPLATE_STYLES.hr + '">';
            case 'blockquote': {
                const contentHtml = renderTemplateBlocks(node.content, ctx, shareUrl);
                return contentHtml ? '<blockquote style="' + INVOICE_TEMPLATE_STYLES.blockquote + '">' + contentHtml + '</blockquote>' : '';
            }
            default:
                if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
                    console.warn('[invoice] Unknown template node type: ' + JSON.stringify(node.type));
                } else if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
                    console.warn('[invoice] Unknown template node type: ' + JSON.stringify(node.type));
                }
                return node.content ? renderTemplateBlocks(node.content, ctx, shareUrl) : '';
        }
    }).filter(Boolean).join('');
}

/**
 * Canonical HTML renderer for invoice templates.
 * This is the single source of truth for the Invoicing preview and template email HTML.
 * @param {Object} ctx
 * @param {string} shareUrl
 * @returns {string}
 */
export function renderInvoiceTemplate(ctx, shareUrl) {
    const doc = getInvoiceTemplateDocument(ctx?.settings);
    if (!doc) return '';
    return renderTemplateBlocks(doc.content, ctx, shareUrl || '').trim();
}

/**
 * Shared preview/email payload builder for template-authored invoice messages.
 * @param {Object} ctx
 * @param {string} shareUrl
 * @returns {{ html: string, text: string }}
 */
export function buildInvoiceTemplateEmailPayload(ctx, shareUrl) {
    return {
        html: renderInvoiceTemplate(ctx, shareUrl),
        text: buildInvoiceBody(ctx, 'text-only', shareUrl, 'email'),
    };
}

/**
 * Build the configured invoice message from template + context.
 * Supports both legacy plain-text templates and TipTap JSON documents.
 * @param {Object} ctx
 * @param {string} shareUrl
 * @param {{ markdown?: boolean }} options — when true, use markdown-formatted payment methods
 */
function buildConfiguredInvoiceMessage(ctx, shareUrl, options) {
    let template;
    if (ctx.settings && ctx.settings.emailMessageDocument) {
        template = docToPlainTextWithTokens(ctx.settings.emailMessageDocument);
    } else {
        template = (ctx.settings && ctx.settings.emailMessage) || '';
    }
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
    // Ensure legacy templates (without a greeting) still get one in the full invoice
    const greetedMessage = /^(hello|hi|hey|dear|greetings)\b/i.test((emailMessage || '').trim())
        ? emailMessage : 'Hello ' + firstName + ',\n\n' + emailMessage;
    let text = greetedMessage + '\n\n';
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

    // Prepend a greeting for email templates that don't already start with one.
    // This handles legacy saved templates that predate the %member_first% token.
    function ensureGreeting(text) {
        if (!isEmail || !text) return text;
        if (/^(hello|hi|hey|dear|greetings)\b/i.test(text.trim())) return text;
        return 'Hello ' + firstName + ',\n\n' + text;
    }

    if (variant === 'text-only') {
        if (isEmail && configuredMessage) {
            return ensureGreeting(configuredMessage);
        }
        const greeting = isEmail ? 'Hello' : 'Hey';
        return greeting + ' ' + firstName + '\u2014your annual shared bills for ' + currentYear + ' are ready. Your ' + amountLabel + ' is ' + amountStr + '. Thanks!';
    }

    if (variant === 'full') {
        return buildFullInvoiceText(ctx, shareUrl);
    }

    // Default: text-link
    if (isEmail && configuredMessage) {
        let msg = ensureGreeting(configuredMessage);
        if (shareUrl) msg += '\n\nView your billing summary:\n' + shareUrl;
        return msg;
    }

    const greeting = isEmail ? 'Hello' : 'Hey';
    let msg = greeting + ' ' + firstName + '\u2014your annual shared bills for ' + currentYear + ' are ready. Your ' + amountLabel + ' is ' + amountStr + '.\n\nThanks!';
    if (shareUrl) msg += '\n\n' + shareUrl;
    return msg;
}
