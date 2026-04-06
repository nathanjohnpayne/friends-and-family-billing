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
- Card header shows Annual/Paid/Balance summary boxes; Balance shows $0.00 when settled.
- Card header shows a "+N" badge next to the member name for households with linked members.
- Displays "Household includes N linked member(s)" text for members with linked members, and "Individual" for standalone members.
- Cards expand via a "Details / Hide details" toggle to show linked members and bill breakdown.
- Expanded view shows "Linked Members" section with linked members above the bill breakdown; each linked member row has Annual/Paid/Balance summary boxes matching the parent card layout.
- Each linked member row is clickable and toggles an individual bill breakdown section; all linked member breakdowns default to collapsed.
- Expanded linked member breakdown shows each bill with a formula and result, matching the primary member breakdown format.
- When a linked member shares the same bill set as the primary member, the expanded breakdown shows "Same bills as [primary name]" instead of individual formulas.
- When a linked member has a different bill set, the expanded breakdown shows their unique bill formulas and a per-member total.
- Linked member expand/collapse state is independent per member within a household.
- Bill breakdown shows "Primary Member Calculation" header for households; each bill row displays a formula showing the split math (e.g., "$300.00 / month × 12 ÷ 8 members = $450.00").
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

- Renders billing year pill (no status badge—lifecycle state is communicated solely through the stepper).
- Renders lifecycle bar (stepper) with all four statuses: Open → Settling → Closed → Archived. The stepper is the single authoritative lifecycle indicator on the dashboard.
- Renders a forward lifecycle action button between the stepper and KPI grid:
  - Open state: "Start Settlement" (enabled).
  - Settling state, not ready: "Close Year" (disabled) with hint text showing how many members are still outstanding.
  - Settling state, all paid: "Close Year" (enabled).
  - Closed state: "Archive Year" (enabled).
  - Archived state: no button.
  - Each enabled button triggers a ConfirmDialog before executing the transition.
- Renders KPI cards for Outstanding, Settled, and Open Reviews (3 cards; Status card removed as redundant with stepper).
- Open Reviews card shows "Review requests" subtitle text below the count.
- Renders progress bar with percentage and settlement message.
- Progress bar headline is accurate for every lifecycle phase: "Planning in progress" (Open, < 100%), "Ready to start settlement" (Open, 100% settled), "Settlement in progress" (Settling), "Settlement complete" (Settling, all paid), "Year closed" (Closed), "Archive view" (Archived).
- Shows empty state ("Add members and bills") when no members exist.
- Shows loading state ("Loading...") when data is loading.
- Backward lifecycle transitions (Back to Open, Reopen to Settling) are not available on the dashboard; they remain exclusively in Settings → Billing Controls.
