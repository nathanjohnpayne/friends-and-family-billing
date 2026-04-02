---
spec_id: settlement-board
---

# Settlement Board

Covers the settlement board component for tracking household payment status, the bills tab for managing bills, and the dashboard view for high-level billing year overview.

## Test Coverage

- `tests/react/components/SettlementBoard.test.jsx`
- `tests/react/views/BillsTab.test.jsx`
- `tests/react/views/DashboardView.test.jsx`

## Acceptance Criteria

### SettlementBoard Component

- Renders nothing when there are no family members.
- Renders a "Settlement Board" header with filter chips (All, Outstanding, Partial, Settled).
- Shows "Linked Groups N" count in the filter bar when households with linked members exist.
- Shows only parent and independent members as top-level cards; linked children are nested under their parent.
- Displays "Outstanding" badge for unpaid members and "Settled" badge for fully paid members.
- Card header shows Annual/Paid/Balance summary boxes; Balance box is hidden when zero (settled).
- Card header shows a "+N" badge next to the member name for households with linked members.
- Displays "Household includes N linked member(s)" text for members with linked members, and "Individual" for standalone members.
- Cards expand via a "Details / Hide details" toggle to show linked members and bill breakdown.
- Expanded view shows linked members above the bill breakdown for clear hierarchy.
- Bill breakdown includes per-person subtotal and household grand total rows.
- Filter chips filter the displayed cards by payment status; shows "No households match this filter." when no cards match.
- Expanded detail shows primary actions (Record Payment, Payment History, Text Invoice) as direct buttons.
- Secondary actions (Email Invoice, Generate Share Link, Manage Share Links) are in a three-dot overflow menu.
- Shows "Record Payment" button for outstanding members; hides it when `readOnly` is true or when the member is fully settled.
- Opens a payment dialog with amount input, method selector, and "Save Payment" button on "Record Payment" click.
- Validates payment amount before submission (shows "Enter a valid amount." for invalid input).
- Calls `onRecordPayment` with memberId, amount, method, and note when submitted.
- Shows a distribute checkbox (checked by default) for household members in the payment dialog; passes `distribute: true` in the callback.
- When settled, shows "Payment History" instead of "Record Payment" in the expanded detail.

### BillsTab View

- Renders bill count in the header (e.g., "Bills (1)").
- Renders bill cards with name and formatted amount (e.g., "$100.00 / month").
- Shows annualized cost summary and split summary with member count.
- Shows "+ Add Bill" button when the year is open; hides it when read-only.
- Read-only years show "View History" in the action menu but hide mutation actions (Convert, Edit Website, Remove Bill).
- Add Bill composer opens with name and amount inputs; calls `service.addBill` on submit; shows validation error when addBill throws.
- Expand split section to show member checkboxes; toggling a checkbox calls `service.toggleBillMember`.
- Delete confirmation dialog appears on "Remove Bill"; calls `service.removeBill` on confirm.
- Shows empty state ("No bills yet") when no bills exist.
- Action menu shows "Open Website" when a bill has a website URL, "Convert to Annual/Monthly" frequency toggle, and "Edit Website"/"Add Website" options.
- Frequency conversion dialog shows current and target frequency, and calls `service.updateBill` with converted values on confirm.
- Website edit dialog shows URL input and calls `service.updateBill` on save.

### DashboardView

- Renders billing year pill with label and status badge.
- Renders KPI cards for Outstanding, Settled, Open Reviews, and Status.
- Renders lifecycle bar with all four statuses (Open, Settling, Closed, Archived).
- Renders progress bar with percentage and settlement message.
- Shows empty state ("Add members and bills") when no members exist.
- Shows loading state ("Loading...") when data is loading.
- Settling status shows "Settlement in progress" message.
- When settling and all members are paid, shows "Ready to Close" and "Settlement complete".
