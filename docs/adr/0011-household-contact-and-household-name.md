# Household contact and household name

Accepted 2026-11-06 for [#528](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/528), the data-model half of the redesign's RD-01 and RD-06 ([#524](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/524)).

## Context

A household has always been computed, not stored: one member's record carries `linkedMembers`, and the household is that member plus everyone listed (CONTEXT.md, ADR 0001). The UI called that member the "primary" and the others "linked members", and drew them as a parent with children. The redesign draws households as groups of peers. It also needs two things the model could not do: change which member holds the list without rebuilding the household by hand, and give a household a name.

## Decision

**The stored primary stays; the UI calls it the Household contact.** The household contact is a label, not a rank. It is where the household's shared settings live (its optional name) and who receives household-level actions (a Refund is issued to the contact, as before). No UI copy ranks one member over another.

**Changing the contact rewrites only the link list.** `BillingYearService.saveHousehold({ contactId, memberIds, householdName })` makes `contactId` the stored primary, sets its `linkedMembers` to the other ids, and clears `linkedMembers` on everyone else in the household. `changeHouseholdContact(memberId)` is the same edit with membership and name unchanged. Forming a household from individuals makes the chosen contact the primary. Members left out of `memberIds` become individuals. A member cannot be taken from another household. A household of only the contact is dissolved.

**No ledger row moves.** Payments and reversals, Credits and Refunds, carried opening balances, Service Credits and Usage Charges all stay on the member they were recorded for. This is safe because every household figure already sums over the whole member set (`[primary, ...linkedMembers]`, e.g. `getHouseholdFinancials`, `getHouseholdRecordedRefund`, `getHouseholdOpeningBalance`, `getHouseholdDeferredCharges`, `buildCarryForward`). The contact therefore changes which id keys a household, not what it owes, paid or holds in credit. The cent projection (ADR 0010) is defined over the same member set, so its integer-cent components are unchanged too.

**The contact cannot be removed without a replacement.** `removeMember` refuses a member who is a household contact; choose a new contact first. Household members who are not the contact can still be removed.

**The household name is optional and lives on the contact's record** as `familyMembers[].householdName`: a trimmed string of at most 60 characters. It moves to the new contact on a contact change, and it is dropped when the household is dissolved or a member stops being the contact. Without a stored name, a household is called by its members' shared surname, or the contact's surname when they do not share one; the UI appends "household". Member records are saved whole, so `buildSavePayload` (ADR 0008) carries the field without a new allowlist entry. `normalizeYearData` drops a blank or non-string value. `buildNewYearData` clones it onto contacts at Start New Year.

**Share links stay with their member.** Share tokens and cached `publicShares` documents are keyed by member id. After a contact change, the old contact's link becomes that member's own link (their own bills and payments) and the new contact's link shows the household. `saveHousehold` rebuilds the cached documents of both contacts' active links in one batch, exactly as `createAndPruneShareLink` builds them for each token's scopes. Other members' links do not change shape and are not rewritten. If the rebuild fails, the household change stays saved and the cache self-heals through `resolveShareToken` within the hour. Refund Notices keep the `memberId` they were issued to (recipient-bound, #542).

**A contact change is audited** with a `HOUSEHOLD_CONTACT_CHANGED` billing event.

**Household operations are confirmed, serialized and year-bound.** `saveHousehold` waits for its own billing-year write to succeed before rebuilding share documents. On failure it reverts only the household fields it changed, removes only its own event, enqueues a compensating save so a write queued meanwhile cannot persist the rejected change, and reports the error. Household operations run one at a time, each bound to the user and year it was requested in (rejected if either changed before its turn), with share-rebuild inputs snapshotted before the write. While one is pending, other link-graph edits (`updateMember` with `linkedMembers`, `removeMember`) are refused, so a rollback never has to merge a competing graph change.

## Consequences

- Promotion is a pure link-graph edit with a provable invariant (household totals equal before and after), covered by `tests/react/lib/household.test.js`.
- The carry seed for a new year is keyed by whoever is the contact at Start New Year (`coadj_<year>_<primaryMemberId>`). After a mid-year contact change it is keyed by the new contact. The amount is the household's, so nothing is lost or doubled.
- The UI screens that edit households in full (the Edit household dialog with a contact choice and name field, #531) and draw households as peers (#529) build on `saveHousehold` and `getHouseholdName`. This change adds only the label, neutral copy, and a "Make household contact" action.
