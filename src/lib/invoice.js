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
