---
spec_id: ui-components
---

# UI Components

Covers shared, reusable UI components and contexts used across the application: action menus, dialogs, selectors, navigation, status badges, empty states, and toast notifications.

## Test Coverage

- `tests/react/components/ActionMenu.test.jsx`
- `tests/react/components/BillAuditHistoryDialog.test.jsx`
- `tests/react/components/BillingYearSelector.test.jsx`
- `tests/react/components/ConfirmDialog.test.jsx`
- `tests/react/components/EmptyState.test.jsx`
- `tests/react/components/NavBar.test.jsx`
- `tests/react/components/PaymentHistoryDialog.test.jsx`
- `tests/react/components/StatusBadge.test.jsx`
- `tests/react/contexts/ToastContext.test.jsx`

### PaymentMethodsManager

- Renders "Payment Methods" section heading.
- Renders existing payment methods with type icons and labels.
- Shows "Add Payment Method" button; clicking calls `onUpdate` with the appended method.
- Shows toggle (On/Off) for each method; toggling calls `onUpdate` with the updated enabled state.
- Three-dot action menu on each method with Edit and Remove options.
- Edit dialog validates E.164 phone and http(s) URL; supports QR code upload.
- Remove confirmation dialog; calls `onUpdate` with the method filtered out.
- Hides mutation controls (add, toggle, edit, remove) when `readOnly` is true.
- Used on the Settings page; no longer rendered on the Invoicing tab.

## Acceptance Criteria

### ActionMenu

- Renders a trigger button but not the dropdown initially.
- Opens the dropdown on trigger click; closes on second click, Escape key, or outside click.
- Calls item `onClick` handler when a menu item is clicked.
- Supports danger-styled menu items.
- Sets `aria-expanded` on the trigger to reflect open/closed state.

### BillAuditHistoryDialog

- Renders a chronological event list filtered to the specific bill.
- Shows event type descriptions ("Bill created", "Bill updated") and details (amount change with arrow notation, member added/removed, creation frequency).
- Shows "No history recorded yet" when no events exist.
- Filters events so only events for the specified billId are shown.
- Renders nothing when `open` is false.

### BillingYearSelector

- Renders a year selector combobox with all available billing years.
- Calls `switchYear` when the selection changes.
- Shows status-appropriate action buttons: "Start Settlement" for open years, "Close Year" and "Back to Open" for settling years, "Archive Year" for closed years.
- Confirmation dialogs gate status transitions; cancelling does not trigger the action.
- "Start New Year" opens a label input dialog; calls `createYear` with the entered label; shows an error for duplicate year labels.
- Hides "Start New Year" for archived years.
- Archive flow offers to start a new year after archiving ("Year Archived" dialog).

### ConfirmDialog

- Renders nothing when `open` is false.
- Renders title, message, confirm button (with custom label), and Cancel button when open.
- Calls `onConfirm` on confirm button click.
- Calls `onCancel` on Cancel click, Escape key, or overlay click.
- Supports destructive styling via `destructive` prop and primary styling by default.

### EmptyState

- Renders title and optional message.
- Renders icon when provided.
- Renders an action slot (e.g., a button).
- Omits optional sections when not provided.

### NavBar

- Renders brand ("FFB"), nav links (Dashboard, Manage, Settings), user email, and Sign Out button.
- Marks the current route's link as active with `aria-current="page"`.

### PaymentHistoryDialog

- Renders a payment list with method labels (Venmo, Cash) for a specific member.
- Shows "Total Paid" and "Remaining Balance" summary.
- Shows a reverse button for each non-reversed payment; hides reverse buttons when `readOnly`.
- Shows "No payments recorded yet." when no payments exist.
- Renders nothing when `open` is false.

### StatusBadge

- `getPaymentStatus` returns null for zero total, "outstanding" for zero paid, "partial" for partial payment, "settled" for full payment, and "overpaid" for excess payment.
- Renders appropriate badge text ("Outstanding", "Settled", "Partial") for known statuses.
- Renders nothing for unknown or null status values.

### ToastContext

- `showToast` displays a toast message.
- Auto-dismisses after 3 seconds.
- Can be manually dismissed via a dismiss button.
- Replaces the previous toast when a new `showToast` call is made.
- Throws when `useToast` is used outside of `ToastProvider`.
