---
spec_id: settlement-board
---

# Settlement Board

Covers the settlement board component for tracking household payment status, the bills tab for managing bills, and the dashboard view for high-level billing year overview.

## Test Coverage

- `tests/react/components/SettlementBoard.test.jsx`
- `tests/react/components/UsageChargeDialog.test.jsx`
- `tests/react/views/BillsTab.test.jsx`
- `tests/react/views/DashboardView.test.jsx`

## Acceptance Criteria

### SettlementBoard Component

- Renders nothing when there are no family members.
- Renders a "Settlement Board" header with filter chips (All, Outstanding, Partial, Settled).
- Shows "Linked Groups N" count in the filter bar when households with linked members exist.
- Shows only parent and independent members as top-level cards; linked children are nested under their parent.
- Displays "Outstanding" badge for unpaid members and "Settled" badge for fully paid members.
- The household card status is derived from the household's Net Contribution (gross paid minus recorded refunds/carry-forwards), not gross payments: a household whose Net Contribution equals its owed reads "Settled" even when gross paid exceeds owed (e.g. after a refund), while a household carrying an unresolved overpayment reads "Overpaid".
- Card header shows Annual/Paid/Balance summary boxes; Balance shows "Paid" when settled. For a household carrying an unresolved credit (overpayment net of refunds/carry-forwards beyond the sub-cent epsilon), the third box shows "Credit" with the household credit amount instead of "Balance"; internal imbalance between household members nets out (ADR 0001).
- The Balance, the Record-Payment action, and the payment-dialog balance all derive from the net shortfall (`owed − Net Contribution`), consistent with the card status. A household pushed below its owed (e.g. by a refund/carry-forward) shows a collectable Balance and the Record Payment action rather than "Paid"; the Paid box continues to show gross money received.
- The `owed` used for status, Balance, and Credit is the household owed **after active Service Credits** (#321): a `−owed` adjustment lowers it, so a service that was canceled/discounted reduces the collectable Balance and, for an already-paid household, surfaces a Credit. The displayed Annual figure and the bill breakdown formula remain the gross bill split (the bill's own amount is unchanged, Option B).
- Card header shows a "+N" badge next to the member name for households with linked members.
- Displays "Household includes N linked member(s)" text for members with linked members, and "Individual" for standalone members.
- Cards expand via a "Details / Hide details" toggle to show bill breakdown, linked members, and household total.
- Expanded view shows sections in a consistent top-to-bottom order: (1) Primary Member Calculation, (2) Linked Members, (3) Household Total. Each linked member row has Annual/Paid/Balance summary boxes matching the parent card layout.
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
- Shows an "Issue Refund" button (#318) in the expanded card for a household carrying a credit (beyond the epsilon); hides it when `readOnly`. It opens a refund dialog with the amount defaulted to the household credit and capped at it, a method selector, and a required reason; on submit it calls `onIssueRefund` with `{ memberId, amount, method, reason }` (and validates a non-empty reason and a valid amount within the credit).
- Opens a payment dialog with amount input, method selector, and "Save Payment" button on "Record Payment" click.
- Validates payment amount before submission (shows "Enter a valid amount." for invalid input).
- Calls `onRecordPayment` with memberId, amount, method, and note when submitted.
- Shows a distribute checkbox (checked by default) for household members in the payment dialog; passes `distribute: true` in the callback.
- When settled, shows "Payment History" instead of "Record Payment" in the expanded detail.

### Deferred Usage Charges (#317)

- For a household carrying one or more *deferred* Usage Charges (`owedAdjustments[]` records with `kind: 'usage_charge'` and `status: 'deferred'`), the card header shows a "Pending charges: $X.XX" line with the household running total and a charge count. The total aggregates the primary member plus their linked members (household grain, ADR 0001). Households with no deferred charges show no pending-charges line.
- Deferred Usage Charges are NOT-YET-DUE: they do not change the Annual, Paid, Balance, or status figures, and they do not affect the Record-Payment gate. A household with a large deferred charge but fully-paid bills still reads "Settled".
- The expanded card shows an "Add Charge" action when not read-only and an `onAddCharge` handler is provided; clicking it calls `onAddCharge(memberId)`. The action is hidden when `readOnly` is true.

### UsageChargeDialog Component

- Renders nothing when `open` is false.
- When open, shows the member name and fields for Amount ($), Description, and Incurred date, plus a cue that the charge is deferred / not billed yet.
- Calls `onSubmit` with `{ amount, description, incurredDate }` (amount parsed to a number) on Save Charge.
- Blocks submit and shows a validation error for a non-positive amount or a missing description.
- Calls `onClose` on Cancel and on Escape.

### DashboardView — Add Charge

- The dashboard wires the settlement board's "Add Charge" action to a `UsageChargeDialog`; submitting records the charge via `service.recordUsageCharge({ memberId, amount, description, incurredDate })` and shows a confirmation toast indicating the charge is pending and not yet billed.

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
- Renders KPI cards for Outstanding, Owed to Members, Settled, and Open Reviews (4 cards; Status card removed as redundant with stepper).
- The "Owed to Members" KPI shows the sum of unresolved household credits (`totalCreditsOwed`), distinct from "Outstanding"; it reads "None" when zero and a dollar amount otherwise, with the subtitle "Unresolved credits".
- Open Reviews card shows "Review requests" subtitle text below the count.
- Renders progress bar with percentage and settlement message.
- Progress bar headline is accurate for every lifecycle phase: "Planning in progress" (Open, < 100%), "Ready to start settlement" (Open, 100% settled), "Settlement in progress" (Settling), "Settlement complete" (Settling, all paid), "Year closed" (Closed), "Archive view" (Archived).
- Shows empty state ("Add members and bills") when no members exist.
- Shows loading state ("Loading...") when data is loading.
- Backward lifecycle transitions (Back to Open, Reopen to Settling) are not available on the dashboard; they remain exclusively in Settings → Billing Controls.
