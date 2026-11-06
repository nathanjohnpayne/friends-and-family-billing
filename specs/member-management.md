---
spec_id: member-management
---

# Member Management

Covers the members tab UI for adding, editing, linking, and removing family members, and the manage view's tab navigation.

## Test Coverage

- `tests/react/views/MembersTab.test.jsx`
- `tests/react/views/ManageView.test.jsx`
- `tests/react/lib/household.test.js`

## Acceptance Criteria

### MembersTab View

- Renders member count in the header (e.g., "Members (2)").
- Renders member cards displaying names, email addresses, and phone numbers.
- Shows the household name ("Lindqvist household", or "Household" when none can be derived) with a neutral "Household contact" tag and member pills on the household contact's card. No UI copy ranks one member over another (no parent, child, primary or linked-member wording).
- Shows placeholder text ("Email not provided") for members without an email.
- Shows "+ Add Member" button when the year is open; hides it when the year is closed or archived.
- Add Member composer opens with Name (required), Email, and Phone inputs.
- Calls `service.addMember` on form submit with name, email, and phone; shows error message when `addMember` throws (e.g., duplicate name).
- Delete confirmation dialog shows the member name; calls `service.removeMember` on confirm. Removing a household contact is refused until a new contact is chosen, and the service's message is shown as a failure toast.
- Shows empty state ("No family members yet") when no members exist.
- Shows loading state ("Loading...") when data is loading.
- Action menu for a household contact shows "Edit Household"; for an individual it shows "Link Household"; for any other household member it shows "Make household contact", which calls `service.changeHouseholdContact(memberId)` and confirms with a toast.
- Edit Household dialog shows "Manage Household for [name]" with member checkboxes; calls `service.updateMember` with updated `linkedMembers` array on "Save Household".

### Household contact and household name (#528, ADR 0011)

- The **Household contact** is the UI name of the stored primary member (the record that carries `linkedMembers`). It is a label, not a rank.
- `service.saveHousehold({ contactId, memberIds, householdName })` forms, edits, renames or dissolves a household and chooses its contact. The contact becomes the stored primary and the other members its `linkedMembers`. Members may come from the edited household or be individuals; taking a member from another household is refused; members left out become individuals; a household of only the contact is dissolved.
- `service.changeHouseholdContact(memberId)` makes a household member the contact without changing membership or the name.
- A contact change moves no ledger row. Payments, reversals, Credits and Refunds, carried opening balances, Service Credits and Usage Charges stay on the member they were recorded for. Every household figure (owed, paid, balance, credit, settlement metrics, carry) is identical before and after.
- The optional household name is stored as `familyMembers[].householdName` on the contact's record, at most 60 characters after trimming whitespace. It moves to the new contact on a contact change and is dropped when the household is dissolved. Without a stored name, the household shows its members' shared surname, or the contact's surname. It survives save/load (member records are saved whole) and Start New Year (`buildNewYearData` clones it onto contacts).
- Refunds are issued to the household contact.
- Share links stay with the member they were minted for. After a contact change, the active links of the previous and the new contact have their cached `publicShares` documents rebuilt to match a fresh `buildPublicShareData`. Other members' links are untouched, and Refund Notices keep their `memberId`. A failed rebuild leaves the saved change in place; the cache then self-heals within the hour.
- A contact change appends a `HOUSEHOLD_CONTACT_CHANGED` billing event.
- If the billing-year write fails, the household change is rolled back (only its own fields and event), no share document is rebuilt, and the call rejects with "The household change could not be saved: …".
- Household operations run one at a time, bound to the year they were requested in. While one is pending, link-graph edits (`updateMember` with `linkedMembers`, `removeMember`) mutations that read the household to assign a ledger row (`issueRefund`, a distributed `recordPayment`) and year-level operations that snapshot the year (`createYear`, `setYearStatus`) are refused with "A household change is still being saved. Try again in a moment."

### ManageView Tab Navigation

- Renders all four tab links: Members, Bills, Invoicing, and Review Requests.
- Renders the correct tab content based on the route (MembersTab at /members, BillsTab at /bills, InvoicingTab at /invoicing, ReviewsTab at /reviews).
- Marks the current tab as active with `aria-current="page"`.
