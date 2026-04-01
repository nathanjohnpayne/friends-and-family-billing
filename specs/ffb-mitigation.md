---
spec_id: ffb-mitigation
---

# FFB Mitigation Plan

Covers legacy script.js behavioral tests that validate critical billing operations against the original monolithic implementation, ensuring parity during the React migration.

## Test Coverage

- `tests/ffb-mitigation-plan.test.js`

## Acceptance Criteria

### Invoice Template Duplication Detection (P0.4)

- `detectDuplicatePaymentText` returns false for templates containing only the `%payment_methods%` token without hardcoded provider names.
- Returns false for templates with only hardcoded provider text and no `%payment_methods%` token.
- Returns true when the template contains both the `%payment_methods%` token and hardcoded provider names (Venmo, Zelle, Apple Cash, Cash App, PayPal).
- Returns false for empty, null, or undefined templates.
- Matches provider names case-insensitively.

### Settlement Status Display (P1.1)

- `calculateSettlementMetrics` returns 100% when all members have fully paid their shares, with `paidCount` equaling `totalMembers` and `totalOutstanding` at 0.
- `BILLING_YEAR_STATUSES` includes the "settling" status with a "Settling" label.
- Zero-balance households (members not assigned to any bill) count as paid and do not block the "Ready to Close" state.

### Confirmation Modals (P1.2)

- `showConfirmationDialog` is exported and callable from the legacy script context.

### Bill Frequency Toggle (P1.4)

- `toggleBillFrequency` is exported and callable.
- Does not modify the bill when the year is read-only (archived status).
- `getBillAnnualAmount` correctly computes annual totals from monthly amounts (multiplied by 12).
- `getBillMonthlyAmount` correctly computes monthly amounts from annual totals (divided by 12).
