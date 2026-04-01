---
spec_id: invoicing
---

# Invoicing

Covers invoice generation helpers, the invoicing settings tab, and email/text invoice dialog components.

## Test Coverage

- `tests/react/lib/invoice.test.js`
- `tests/react/views/InvoicingTab.test.jsx`
- `tests/react/components/EmailInvoiceDialog.test.jsx`
- `tests/react/components/TextInvoiceDialog.test.jsx`

## Acceptance Criteria

### Invoice Helpers

- `getInvoiceSummaryContext` returns a context object with firstName, combinedTotal, currentYear, and numMembers for a valid member; returns null for unknown members.
- Context includes payment amount, remaining balance, and "remaining balance" label when partially paid.
- `buildInvoiceSubject` formats a subject line containing the billing year and member name.
- `buildInvoiceBody` in "text-only" variant produces a greeting with the member's first name and billing year.
- "text-link" variant includes the provided share URL in the body.
- "sms" variant uses "Hey" instead of "Hello" for the greeting.
- "full" variant includes "ANNUAL BILLING SUMMARY" heading and individual bill names in the breakdown.

### InvoicingTab View

- Renders "Email Template" section heading.
- Renders "Payment Methods" section.
- Shows template content in a contenteditable editor with token chips (e.g., "Household Total").
- Shows token insert buttons for "Billing Year", "Household Total", and "Payment Methods".
- Shows live preview panel with To and Subject fields.
- Shows "Save Template" button.
- Renders existing payment methods with their type labels.
- Shows "Add Payment Method" button; clicking it calls `service.updateSettings` with an appended payment method.
- Hides "Save Template" and "Add Payment Method" buttons when the year is read-only.
- Shows a duplicate payment text warning when the template contains both the `%payment_methods%` token and hardcoded provider names.

### EmailInvoiceDialog

- Renders dialog title with the member's full name ("Email Invoice for Alice Smith").
- Shows three variant options: "Text only", "Text + link", and "Full invoice".
- Shows Subject and Message fields.
- Shows "Copy Email" and "Open Mail App" action buttons.
- Displays the member's email address in metadata.
- Renders nothing when `open` is false.

### TextInvoiceDialog

- Renders dialog title with the member's full name ("Text Invoice for Alice Smith").
- Shows two variant options: "Text only" and "Text + link".
- Shows "Copy Message" and "Open Messages" action buttons.
- Displays the member's phone number in metadata.
- Renders nothing when `open` is false.
