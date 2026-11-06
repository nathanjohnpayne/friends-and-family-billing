/**
 * Households of peers (#528, ADR 0011).
 *
 * A household is still computed, not stored as its own entity: one member's record
 * carries `linkedMembers`, and the household is that member plus everyone listed.
 * That member is the **Household contact** — the UI name of the stored Primary
 * Member (CONTEXT.md). The contact is where the household's shared settings live
 * (the optional `householdName`) and who receives household-level actions such as a
 * Refund; it carries no other precedence. Every member keeps their own ledger rows
 * (payments, charges, credits) under their own id, and household figures always sum
 * across the whole member set, so changing the contact never moves money.
 *
 * Pure helpers only; the mutation is BillingYearService.saveHousehold().
 */

/** Longest household name accepted (characters, after trimming). */
export const HOUSEHOLD_NAME_MAX_LENGTH = 60;

/**
 * The id of the household contact for a member: the member themselves when they
 * are a contact or an individual, otherwise the member whose `linkedMembers`
 * lists them.
 * @param {Array} familyMembers
 * @param {*} memberId
 * @returns {*} contact id, or null when the member does not exist
 */
export function findHouseholdContactId(familyMembers, memberId) {
    const members = familyMembers || [];
    if (!members.some(m => m.id === memberId)) return null;
    const contact = members.find(m => (m.linkedMembers || []).includes(memberId));
    return contact ? contact.id : memberId;
}

/**
 * Every member id in a contact's household, contact first.
 * @param {{ id: *, linkedMembers?: Array }} contact
 * @returns {Array}
 */
export function getHouseholdMemberIds(contact) {
    if (!contact) return [];
    return [contact.id, ...(contact.linkedMembers || [])];
}

/** The last whitespace-separated word of a name ("Erik Lindqvist" → "Lindqvist"). */
function surnameOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : '';
}

/**
 * The default household name: the surname the members share, or — when they do not
 * share one — the contact's surname. Empty when no surname can be derived.
 * @param {Array<{ name: string }>} members  contact first
 * @returns {string}
 */
export function defaultHouseholdName(members) {
    const list = (members || []).filter(Boolean);
    if (list.length === 0) return '';
    // When the members share a surname the contact's surname is that shared one; when
    // they do not, the contact's surname is the fallback. Either way it is the first
    // member's (members are passed contact first).
    return surnameOf(list[0].name);
}

/**
 * The household name to show: the stored `householdName` on the contact, else the
 * default derived from the members' names.
 * @param {{ id: *, linkedMembers?: Array, householdName?: string }} contact
 * @param {Array} familyMembers
 * @returns {string}
 */
export function getHouseholdName(contact, familyMembers) {
    if (!contact) return '';
    const stored = normalizeHouseholdName(contact.householdName);
    if (stored) return stored;
    const members = getHouseholdMemberIds(contact)
        .map(id => (familyMembers || []).find(m => m.id === id))
        .filter(Boolean);
    return defaultHouseholdName(members);
}

/**
 * Trim and collapse whitespace in a household name. Returns '' for a blank or
 * non-string value.
 * @param {*} name
 * @returns {string}
 */
export function normalizeHouseholdName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().replace(/\s+/g, ' ');
}

/**
 * Plan a household edit without mutating anything: who ends up where, and which
 * contacts' share documents need rebuilding.
 *
 * Rules (ADR 0011):
 * - `contactId` must be in `memberIds`; it becomes the stored primary and every
 *   other id becomes its linked member.
 * - Every other member must be an individual or already belong to the household
 *   being edited — a member cannot be taken from another household.
 * - Members of the edited household left out of `memberIds` become individuals.
 * - `memberIds` of just the contact dissolves the household.
 * - The stored `householdName` lives on the contact's record: it moves to the new
 *   contact and is removed from any member who stops being the contact.
 *
 * @param {Array} familyMembers
 * @param {{ contactId: *, memberIds: Array, householdName?: string|null }} edit
 *   householdName: a string sets it ('' clears it); undefined keeps the household's
 *   current stored name.
 * @returns {{ familyMembers: Array, contactId: *, previousContactId: *, memberIds: Array,
 *   released: Array, householdName: string, affectedContactIds: Array }}
 */
export function planHouseholdEdit(familyMembers, edit) {
    const members = familyMembers || [];
    const byId = new Map(members.map(m => [m.id, m]));
    const contactId = edit.contactId;
    if (!byId.has(contactId)) throw new Error('Household contact not found.');

    const memberIds = [];
    for (const id of (edit.memberIds || [])) {
        if (!byId.has(id)) throw new Error('Household member not found.');
        if (!memberIds.includes(id)) memberIds.push(id);
    }
    if (!memberIds.includes(contactId)) {
        throw new Error('Choose a household contact from the household’s members.');
    }

    // The household being edited is the one the chosen contact is in now.
    const previousContactId = findHouseholdContactId(members, contactId);
    const previousContact = byId.get(previousContactId);
    const previousIds = getHouseholdMemberIds(previousContact);

    for (const id of memberIds) {
        if (previousIds.includes(id)) continue;
        const other = byId.get(id);
        const otherContactId = findHouseholdContactId(members, id);
        if (otherContactId !== id || (other.linkedMembers || []).length > 0) {
            const otherContact = byId.get(otherContactId);
            throw new Error(other.name + ' is already in ' + otherContact.name + '’s household.');
        }
    }

    const nameInput = edit.householdName === undefined
        ? normalizeHouseholdName(previousContact.householdName)
        : normalizeHouseholdName(edit.householdName);
    if (nameInput.length > HOUSEHOLD_NAME_MAX_LENGTH) {
        throw new Error('Household name must be ' + HOUSEHOLD_NAME_MAX_LENGTH + ' characters or fewer.');
    }

    const linked = memberIds.filter(id => id !== contactId);
    const touched = new Set([...previousIds, ...memberIds]);
    const released = previousIds.filter(id => !memberIds.includes(id));

    const updated = members.map(m => {
        if (!touched.has(m.id)) return m;
        const next = { ...m };
        if (m.id === contactId) {
            next.linkedMembers = linked;
            if (nameInput && linked.length > 0) next.householdName = nameInput;
            else delete next.householdName;
        } else {
            next.linkedMembers = [];
            delete next.householdName;
        }
        return next;
    });

    const affectedContactIds = previousContactId === contactId
        ? [contactId]
        : [previousContactId, contactId];

    return {
        familyMembers: updated,
        contactId,
        previousContactId,
        memberIds,
        released,
        householdName: linked.length > 0 ? nameInput : '',
        affectedContactIds
    };
}

function sameIds(a, b) {
    const x = a || [];
    const y = b || [];
    return x.length === y.length && x.every((id, i) => id === y[i]);
}

/**
 * Undo a household edit's household fields on a member list, keeping every other
 * change made since (#528). The members the edit changed (`planned` differs from
 * `previous`) are restored together or not at all: each must still hold either
 * what the edit set (it is then put back) or what it had before (left as is). If
 * any of them holds something else — another household change was saved
 * meanwhile, or the member is gone — reverting only some of them could leave two
 * contacts linking each other, so nothing is reverted and a conflict is thrown.
 * Every other field (name, email, phone, …) is kept.
 *
 * @param {Array} current   the member list now
 * @param {Array} planned   planHouseholdEdit(...).familyMembers
 * @param {Array} previous  the member list the edit was planned from
 * @returns {Array|null} the restored list, or null when nothing needed restoring
 * @throws {Error} with code 'household-revert-conflict' when the households changed since
 */
export function revertHouseholdFields(current, planned, previous) {
    const plannedById = new Map((planned || []).map(m => [m.id, m]));
    const currentById = new Map((current || []).map(m => [m.id, m]));
    const holds = (cur, ref) => sameIds(cur.linkedMembers, ref.linkedMembers) && cur.householdName === ref.householdName;
    const toRevert = new Map();
    for (const previousMember of previous || []) {
        const plannedMember = plannedById.get(previousMember.id);
        if (!plannedMember || plannedMember === previousMember) continue;
        const cur = currentById.get(previousMember.id);
        if (cur && holds(cur, plannedMember)) toRevert.set(cur.id, previousMember);
        else if (!(cur && holds(cur, previousMember))) {
            const err = new Error('Another change to these households was saved meanwhile.');
            err.code = 'household-revert-conflict';
            throw err;
        }
    }
    if (toRevert.size === 0) return null;
    const restored = current.map(cur => {
        const previousMember = toRevert.get(cur.id);
        if (!previousMember) return cur;
        const next = { ...cur, linkedMembers: (previousMember.linkedMembers || []).slice() };
        if (previousMember.householdName !== undefined) next.householdName = previousMember.householdName;
        else delete next.householdName;
        return next;
    });
    // The restored households must not be invalid in any new way against every
    // member, including ones this edit did not touch (another client may have linked
    // a member it released into a different household). A problem already present
    // before the edit or now (e.g. a duplicate link in old data) is not this
    // revert's doing and does not block it.
    const existing = new Set([...householdGraphViolations(current), ...householdGraphViolations(previous)]);
    if ([...householdGraphViolations(restored)].some(v => !existing.has(v))) {
        const err = new Error('Another change to these households was saved meanwhile.');
        err.code = 'household-revert-conflict';
        throw err;
    }
    return restored;
}

/**
 * Whether a member list forms valid households: every linked id is another
 * existing member, no member is linked by more than one contact or more than once,
 * and no contact is itself linked by someone else.
 * @param {Array} familyMembers
 * @returns {boolean}
 */
export function isValidHouseholdGraph(familyMembers) {
    return householdGraphViolations(familyMembers).size === 0;
}

/**
 * The household-graph problems in a member list, as stable keys: a self link, a
 * link to a missing member, a member linked more than once (by one contact or by
 * several), and a contact who is itself linked.
 * @param {Array} familyMembers
 * @returns {Set<string>}
 */
export function householdGraphViolations(familyMembers) {
    const ids = new Set((familyMembers || []).map(m => m.id));
    const linkCount = new Map();
    const out = new Set();
    for (const member of familyMembers || []) {
        for (const id of member.linkedMembers || []) {
            if (id === member.id) out.add('self:' + id);
            else if (!ids.has(id)) out.add('missing:' + member.id + ':' + id);
            linkCount.set(id, (linkCount.get(id) || 0) + 1);
        }
    }
    for (const [id, count] of linkCount) if (count > 1) out.add('multi:' + id);
    for (const member of familyMembers || []) {
        if ((member.linkedMembers || []).length > 0 && linkCount.has(member.id)) out.add('contact-linked:' + member.id);
    }
    return out;
}
