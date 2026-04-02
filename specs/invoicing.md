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
- Shows template content in a contenteditable editor with token chips (e.g., "Household Total").
- Shows token insert buttons for "Billing Year", "Household Total", and "Payment Methods".
- Shows live preview panel with To and Subject fields.
- Shows "Save Template" button.
- Hides "Save Template" button when the year is read-only.
- Shows a duplicate payment text warning when the template contains both the `%payment_methods%` token and hardcoded provider names.
- Payment methods management has moved to the Settings page (see `PaymentMethodsManager` component).

### EmailInvoiceDialog

- Renders dialog title with the member's full name ("Email Invoice for Alice Smith").
- Shows three variant options: "Text only", "Text + link", and "Full invoice".
- Shows Subject and Message fields.
- Shows three action buttons: "Copy", "Open Mail App", and "Send Email".
- "Send Email" calls the `sendEmail` Cloud Function with the composed subject and body; shows loading state ("Sending...") while in flight; shows success toast and closes dialog on success; shows error toast on failure.
- "Send Email" is disabled when the member has no email address.
- "Open Mail App" is preserved as a fallback for users who prefer their native mail client.
- Displays the member's email address in metadata.
- Renders nothing when `open` is false.

### Email Delivery (sendEmail Cloud Function)

- Sends HTML emails via Resend from `Friends & Family Billing <billing@mail.nathanpayne.com>`.
- Requires Firebase Auth ID token in the `Authorization: Bearer <token>` header. Rejects unauthenticated requests with 401. The Cloud Run service uses `invoker: "private"` — not publicly invocable; reached via Firebase Hosting rewrite with internal service-to-service auth.
- Accepts `{ to, subject, body, replyTo? }` as POST JSON to `/sendEmail`.
- Converts the body from markdown to HTML via `simpleMarkdownToHtml()`:
  - Supports: bold (`**text**`), headings (`## Heading`), markdown links (`[text](url)`), bare URL auto-linkification, lists (`- item`), horizontal rules (`===`/`---`).
  - Escapes HTML entities before markdown conversion to prevent XSS.
  - `sanitizeHref()` blocks non-http(s) protocols (`javascript:`, `data:`) and escapes quotes in href attributes to prevent attribute breakout.
  - Unescapes entity-encoded ampersands before re-escaping for attribute context to avoid double-escaping query-string parameters.
- Wraps HTML in a responsive email template with branded gradient header and plain footer.
- Sends both HTML and plain-text fallback to Resend for maximum email client compatibility.
- Payment method URLs in `formatPaymentOptionsMarkdown()` are rendered as markdown links (`[url](url)`) so they appear as clickable `<a>` tags in both the sent email and the Manage-page live preview.

### TextInvoiceDialog

- Renders dialog title with the member's full name ("Text Invoice for Alice Smith").
- Shows two variant options: "Text only" and "Text + link".
- Shows "Copy Message" and "Open Messages" action buttons.
- Displays the member's phone number in metadata.
- Renders nothing when `open` is false.
