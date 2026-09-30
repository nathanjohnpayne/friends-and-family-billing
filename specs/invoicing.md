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
- `tests/e2e/invoicing-editor.spec.js`

## Acceptance Criteria

### Invoice Helpers

- `getInvoiceSummaryContext` returns a context object with firstName, combinedTotal, currentYear, and numMembers for a valid member; returns null for unknown members.
- Context includes payment amount, remaining balance, and "remaining balance" label when partially paid.
- The member-facing owed reflects the household's active Service Credits (#321): `getInvoiceSummaryContext` accepts an optional trailing `owedAdjustments` argument (defaulting to empty) and reduces `combinedTotal` — and therefore `balance` — by the sum of active `service_credit` adjustments for the primary plus linked members, floored at 0, mirroring `getHouseholdFinancials` so the invoice agrees with the dashboard/settlement board. Voided credits and the `+owed` Usage Charge direction are excluded; billed Usage Charges (#320) are NOT added here (they carry their own Charge Notice). A six-argument call is unchanged.
- `buildInvoiceSubject` formats a subject line containing the billing year and member name.
- `buildInvoiceBody` in "text-only" variant produces a greeting with the member's first name and billing year.
- "text-link" variant includes the provided share URL in the body.
- "sms" variant uses "Hey" instead of "Hello" for the greeting.
- "full" variant includes "ANNUAL BILLING SUMMARY" heading and individual bill names in the breakdown.

### InvoicingTab View

- Renders "Email Template" section heading.
- Shows template content in a TipTap WYSIWYG editor with inline token pills (e.g., `%household_total%` rendered as "Household Total" pill) and a formatting toolbar (bold, italic, link).
- Supports slash-command menu (`/`) for inserting block tokens (e.g., `/table_member_details`, `/payment_methods`, `/share_link`) and percent-prefix (`%`) for inline tokens (e.g., `%billing_year%`, `%household_total%`).
- Subject line uses a constrained single-line TipTap editor (SubjectEditor) with token support but no rich formatting.
- Shows live preview panel with To and Subject fields.
- Shows "Save Template" button.
- Hides "Save Template" button when the year is read-only.
- Shows a duplicate payment text warning when the template contains both the `%payment_methods%` token and hardcoded provider names.
- Payment methods are managed on the Settings page (see `PaymentMethodsManager` component). The `%payment_methods%` block-token card in the template editor also has a **Configure** button that opens the same `PaymentMethodsManager` in a dialog on this tab. Both entry points persist via `service.updateSettings` and sync the owner's share pages through `src/lib/paymentMethodsSync.js`: enabled methods (QR image stripped to `hasQrCode: true`) onto every non-revoked `publicShares` doc, and QR images to `publicQrCodes/{uid}_{methodId}` (`tests/react/views/InvoicingTab.paymentMethodsSync.test.jsx`, `tests/react/views/SettingsView.test.jsx`).

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
- Implemented as a Firestore-triggered function (`onDocumentCreated` on `mailQueue/{docId}`). No HTTP endpoint or Cloud Run invoker policy needed.
- Client writes to `mailQueue` collection via `queueEmail()` helper (`src/lib/mail.js`), which listens for status changes via `onSnapshot` and resolves/rejects the returned promise.
- Firestore security rules enforce that only authenticated users can create queue documents with their own `uid`, `status: 'pending'`, and only the plain fields `to`, `subject`, `body`, `uid`, `status`, `createdAt` (no client-supplied HTML or reply-to).
- For client-enqueued mail the function requires a verified sender email, only delivers to the sender's own email or a household member email recorded in the sender's billing years, and rate-limits per uid. Mail enqueued by Cloud Functions (Admin SDK, `origin: 'server'`) skips these sender checks.
- The "Send test email" action queues the template's markdown serialization (`buildInvoiceTemplateEmailPayload(...).markdown`: payment options as a list, the share link as a named link); the HTML is rendered server-side like every other email and carries the same bold/italic/list/blockquote/link/rule semantics as the Invoicing preview (`tests/react/lib/emailTemplateParity.test.js`). Markdown mode serializes the same document the preview renders (legacy plain-text templates go through `plainTextToDoc`) and backslash-escapes literal text (`docToPlainTextWithTokens(doc, { escapeMarkdown: true })`, plus token values and payment-method fields), so user-typed `*`, `[`, `]`, `\`, or a line starting `- `, `1. `, `>`, `#`, `---` renders verbatim; `simpleMarkdownToHtml` honours those escapes. The recipient must be the sender or a household member.
- An unverified email/password account sees a notice at the top of every signed-in page (`AppShell` → `EmailVerificationNotice`) with a **Resend verification email** control. Sign-up sends the verification email; because sign-up signs the user in and `GuestRoute` redirects immediately, a failed send is recorded (`reportVerificationSend`: sessionStorage + a window event) and the notice shows it after the redirect (`tests/react/routes.test.jsx`). LoginView also shows a delivery warning instead of the inbox instruction when it is still mounted.
- The function validates fields, converts markdown to HTML, sends via Resend, and updates the document with `status: 'sent'` or `status: 'error'`.
- Converts the body from markdown to HTML via `simpleMarkdownToHtml()`:
  - Supports every construct the invoice template serializer emits: bold (`**text**`), italic (`*text*`, and `***text***` for both), headings (`## Heading`), markdown links (`[text](url)`), bare URL auto-linkification, bullet lists (`- item`, with an indented continuation line kept inside the item), ordered lists (`1. item`), blockquotes (`> line`, consecutive lines form one quote), horizontal rules (`===`/`---`).
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
