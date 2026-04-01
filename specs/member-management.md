---
spec_id: member-management
---

# Member Management

Covers the members tab UI for adding, editing, linking, and removing family members, and the manage view's tab navigation.

## Test Coverage

- `tests/react/views/MembersTab.test.jsx`
- `tests/react/views/ManageView.test.jsx`

## Acceptance Criteria

### MembersTab View

- Renders member count in the header (e.g., "Members (2)").
- Renders member cards displaying names, email addresses, and phone numbers.
- Shows "Household" label with linked member pills for members with linked members.
- Shows placeholder text ("Email not provided") for members without an email.
- Shows "+ Add Member" button when the year is open; hides it when the year is closed or archived.
- Add Member composer opens with Name (required), Email, and Phone inputs.
- Calls `service.addMember` on form submit with name, email, and phone; shows error message when `addMember` throws (e.g., duplicate name).
- Delete confirmation dialog shows the member name; calls `service.removeMember` on confirm.
- Shows empty state ("No family members yet") when no members exist.
- Shows loading state ("Loading...") when data is loading.
- Action menu for a parent member shows "Edit Household"; for an unlinked member shows "Link Household".
- Edit Household dialog shows "Manage Household for [name]" with member checkboxes; calls `service.updateMember` with updated `linkedMembers` array on "Save Household".

### ManageView Tab Navigation

- Renders all four tab links: Members, Bills, Invoicing, and Review Requests.
- Renders the correct tab content based on the route (MembersTab at /members, BillsTab at /bills, InvoicingTab at /invoicing, ReviewsTab at /reviews).
- Marks the current tab as active with `aria-current="page"`.
