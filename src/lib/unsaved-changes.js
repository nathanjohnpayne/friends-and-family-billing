// Unsaved changes of a tab that entered the read-only Reload required state
// (#614 / #669, spec § Versioned year-document writes, RD-34). Pure summary of
// the unsaved payload against the last successful save, plus the on-device
// record kept under `ffb.unsaved.v1.<uid>.<yearId>`. Every storage access is
// wrapped in try/catch. No Firestore.

import { BILLING_EVENT_LABELS } from './formatting.js';

export const UNSAVED_STORAGE_PREFIX = 'ffb.unsaved.v1.';

/** The on-device key for a year's unsaved changes. */
export function unsavedStorageKey(uid, yearId) {
    return UNSAVED_STORAGE_PREFIX + uid + '.' + yearId;
}

const EXTRA_EVENT_LABELS = {
    REFUND_ISSUED: 'Refund recorded',
    CHARGES_BILLED: 'Charges billed',
    YEAR_CARRIED_FORWARD: 'Carried to the next year'
};

const MEMBER_FIELD_LABELS = {
    name: 'name', email: 'email', phone: 'phone number', avatar: 'photo',
    linkedMembers: 'household', householdName: 'household name', paymentReceived: 'payment received'
};
const BILL_FIELD_LABELS = {
    name: 'name', amount: 'price', billingFrequency: 'frequency', members: 'members', website: 'website', logo: 'logo'
};
const LEDGER_LABELS = { payments: 'Payments', creditAdjustments: 'Refunds and credits', owedAdjustments: 'Charges and credits' };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byId = list => new Map((Array.isArray(list) ? list : []).filter(x => x && x.id !== undefined).map(x => [String(x.id), x]));

function changedFields(before, after, labels) {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const out = [];
    for (const key of keys) {
        if (!same((before || {})[key], (after || {})[key])) out.push(labels[key] || key);
    }
    return [...new Set(out)];
}

/** Every string or number id an event's payload mentions, for de-duplicating ledger rows. */
function mentionedIds(events) {
    const ids = new Set();
    const walk = value => {
        if (value == null) return;
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (typeof value === 'object') { Object.values(value).forEach(walk); return; }
        ids.add(String(value));
    };
    events.forEach(e => walk(e.payload));
    return ids;
}

/**
 * The unsaved changes of `unsaved` against the last successful save `baseline`
 * (both save payloads, JSON-safe): billing events appended since the baseline, plus
 * a structural diff for changes that emit no event — members added, edited or
 * removed, bills edited, ledger rows no event mentions, settings and status.
 *
 * @param {Object|null} baseline
 * @param {Object|null} unsaved
 * @returns {Array<{ kind: string, label: string, detail: string, amount: number|null, at: string|null }>}
 */
export function summarizeUnsavedChanges(baseline, unsaved) {
    const base = baseline || {};
    const next = unsaved || {};
    const changes = [];
    const members = new Map([...byId(base.familyMembers), ...byId(next.familyMembers)]);
    const bills = new Map([...byId(base.bills), ...byId(next.bills)]);
    const memberName = id => (id != null && members.get(String(id)) ? members.get(String(id)).name : '');
    const billName = id => (id != null && bills.get(String(id)) ? bills.get(String(id)).name : '');

    // 1. Billing events appended since the baseline.
    const baseEventIds = new Set((base.billingEvents || []).map(e => e && e.id));
    const newEvents = (next.billingEvents || []).filter(e => e && !baseEventIds.has(e.id));
    for (const event of newEvents) {
        const p = event.payload || {};
        const label = BILLING_EVENT_LABELS[event.eventType] || EXTRA_EVENT_LABELS[event.eventType] || String(event.eventType || 'Change');
        const detail = [
            p.memberName || memberName(p.memberId),
            p.billName || billName(p.billId),
            p.reason ? '“' + p.reason + '”' : '',
            p.description || '',
            event.eventType === 'YEAR_STATUS_CHANGED' && p.newStatus ? p.previousStatus + ' → ' + p.newStatus : '',
            p.contactName ? 'contact ' + p.contactName : ''
        ].filter(Boolean).join(' · ');
        changes.push({ kind: 'event', label, detail, amount: typeof p.amount === 'number' ? p.amount : null, at: event.timestamp || null });
    }
    const eventBillIds = new Set(newEvents.filter(e => /^BILL_|_BILL$/.test(e.eventType || '')).map(e => String((e.payload || {}).billId)));
    const mentioned = mentionedIds(newEvents);

    // 2. Members (no member event exists for add, edit or remove).
    const baseMembers = byId(base.familyMembers);
    const nextMembers = byId(next.familyMembers);
    for (const [id, member] of nextMembers) {
        const before = baseMembers.get(id);
        if (!before) changes.push({ kind: 'member', label: 'Member added', detail: member.name || '', amount: null, at: null });
        else if (!same(before, member)) {
            changes.push({ kind: 'member', label: 'Member edited', detail: [member.name, changedFields(before, member, MEMBER_FIELD_LABELS).join(', ')].filter(Boolean).join(' · '), amount: null, at: null });
        }
    }
    for (const [id, member] of baseMembers) {
        if (!nextMembers.has(id)) changes.push({ kind: 'member', label: 'Member removed', detail: member.name || '', amount: null, at: null });
    }

    // 3. Bills, unless a bill event already lists the change.
    const baseBills = byId(base.bills);
    const nextBills = byId(next.bills);
    for (const [id, bill] of nextBills) {
        if (eventBillIds.has(id)) continue;
        const before = baseBills.get(id);
        if (!before) changes.push({ kind: 'bill', label: 'Bill added', detail: bill.name || '', amount: null, at: null });
        else if (!same(before, bill)) {
            changes.push({ kind: 'bill', label: 'Bill edited', detail: [bill.name, changedFields(before, bill, BILL_FIELD_LABELS).join(', ')].filter(Boolean).join(' · '), amount: null, at: null });
        }
    }
    for (const [id, bill] of baseBills) {
        if (!nextBills.has(id) && !eventBillIds.has(id)) changes.push({ kind: 'bill', label: 'Bill removed', detail: bill.name || '', amount: null, at: null });
    }

    // 4. Ledger rows no unsaved event mentions.
    for (const field of Object.keys(LEDGER_LABELS)) {
        const before = byId(base[field]);
        const after = byId(next[field]);
        let added = 0;
        let changed = 0;
        let removed = 0;
        for (const [id, row] of after) {
            if (mentioned.has(id)) continue;
            if (!before.has(id)) added += 1;
            else if (!same(before.get(id), row)) changed += 1;
        }
        for (const id of before.keys()) if (!after.has(id) && !mentioned.has(id)) removed += 1;
        const parts = [added && added + ' added', changed && changed + ' changed', removed && removed + ' removed'].filter(Boolean);
        if (parts.length) changes.push({ kind: 'ledger', label: LEDGER_LABELS[field] + ' changed', detail: parts.join(', '), amount: null, at: null });
    }

    // 5. Settings and status.
    const settingLabels = new Set();
    for (const key of new Set([...Object.keys(base.settings || {}), ...Object.keys(next.settings || {})])) {
        if (same((base.settings || {})[key], (next.settings || {})[key])) continue;
        if (/email|template|subject|message/i.test(key)) settingLabels.add('Invoice template changed');
        else if (/payment(Methods|Links)/.test(key)) settingLabels.add('Payment methods changed');
        else settingLabels.add('Settings changed: ' + key);
    }
    settingLabels.forEach(label => changes.push({ kind: 'settings', label, detail: '', amount: null, at: null }));
    if (base.status && next.status && base.status !== next.status && !newEvents.some(e => e.eventType === 'YEAR_STATUS_CHANGED')) {
        changes.push({ kind: 'status', label: 'Status changed', detail: base.status + ' → ' + next.status, amount: null, at: null });
    }
    return changes;
}

/** The plain-text summary Copy details exports (followed by the payload JSON). */
export function formatUnsavedDetails(record) {
    const lines = [
        'Unsaved changes — billing year ' + (record.yearLabel || record.yearId),
        'Not saved since ' + (record.baselineAt || 'this tab loaded') + (record.baselineKind === 'loaded' ? ' (when this tab loaded)' : ' (last successful save)'),
        'Detected ' + record.detectedAt + (record.reason === 'permission-denied' ? ' — the save was refused' : ' — changed in another tab or device'),
        ''
    ];
    if (!record.changes || record.changes.length === 0) lines.push('No unsaved changes were found.');
    for (const c of record.changes || []) {
        lines.push('- ' + c.label + (c.detail ? ': ' + c.detail : '') + (typeof c.amount === 'number' ? ' (' + c.amount.toFixed(2) + ')' : '') + (c.at ? ' [' + c.at + ']' : ''));
    }
    lines.push('', 'Unsaved data (JSON):', JSON.stringify(record.payload == null ? null : record.payload, null, 2));
    return lines.join('\n');
}

/**
 * Keep the record on this device. Returns { kept: true } or { kept: false, error }
 * (storage blocked, quota exceeded, private mode).
 */
export function persistUnsavedRecord(record, storage = defaultStorage()) {
    try {
        if (!storage) throw new Error('Storage is unavailable on this device.');
        storage.setItem(unsavedStorageKey(record.uid, record.yearId), JSON.stringify(record));
        return { kept: true };
    } catch (err) {
        return { kept: false, error: err && err.name === 'QuotaExceededError' ? 'This device is out of storage space.' : (err && err.message) || 'Storage is unavailable.' };
    }
}

/** Every unsaved record kept on this device for this user, newest first. */
export function readUnsavedRecords(uid, storage = defaultStorage()) {
    const out = [];
    try {
        if (!storage || !uid) return out;
        const prefix = UNSAVED_STORAGE_PREFIX + uid + '.';
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key || !key.startsWith(prefix)) continue;
            try {
                const record = JSON.parse(storage.getItem(key));
                if (record && record.uid === uid && record.yearId != null && Array.isArray(record.changes)) out.push(record);
            } catch (_) { /* a corrupt entry is skipped */ }
        }
    } catch (_) { /* storage unavailable */ }
    return out.sort((a, b) => String(b.detectedAt).localeCompare(String(a.detectedAt)));
}

/** Remove a kept record (Dismiss). */
export function clearUnsavedRecord(uid, yearId, storage = defaultStorage()) {
    try { if (storage) storage.removeItem(unsavedStorageKey(uid, yearId)); } catch (_) { /* storage unavailable */ }
}

function defaultStorage() {
    try { return typeof window !== 'undefined' ? window.localStorage : null; } catch (_) { return null; }
}
