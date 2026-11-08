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
- **Carried items (ADR 0009).** `getInvoiceSummaryContext` exposes `carriedItems` (the same member-safe lines `buildCarriedItemsForShare` produces, from the household's `carry_opening` seeds) and `carriedTotal`; `combinedTotal` is unchanged (the opening balance was already folded in). The "full" variant renders a CARRIED FROM 2026 block between the bill tables and the ANNUAL PAYMENT SUMMARY, one line per item attributed to its member with the household credit and its detail at the household level and a carried total, in the copy of `specs/year-end-review.md` § Member-facing copy; a legacy seed renders one line. The Invoicing tab preview and the email dialog's Full invoice variant show the block, and so does every sent email variant: the Full invoice places it between the bill tables and the payment summary, and the text-only and text-link variants append it after the configured message and before the payment methods (one contract with `specs/year-end-review.md` § Member-facing surfaces and #604; no template token is added).
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
- Sends both HTML and plain-text fallback to Resend for maximum email client compatibility. The plain-text part is `markdownToPlainText(body)`: bold/italic markers, `## ` heading markers and backslash escapes are removed and links become `label (url)`, so text-only clients never see markdown syntax.
- Payment method URLs in `formatPaymentOptionsMarkdown()` are rendered as markdown links (`[url](url)`) so they appear as clickable `<a>` tags in both the sent email and the Manage-page live preview.

### TextInvoiceDialog

- Renders dialog title with the member's full name ("Text Invoice for Alice Smith").
- Shows two variant options: "Text only" and "Text + link".
- Shows "Copy Message" and "Open Messages" action buttons.
- Displays the member's phone number in metadata.
- Renders nothing when `open` is false.

### Future Charge Notice issuance and recovery contract (#648)

The [owner decision on PR #649](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6716004056)
accepts all seven [ADR 0012](../docs/adr/0012-charge-notice-recovery.md) choices
and four amendments. This is final proposed implementation-contract text for
review, not a runtime-conformance assertion. ADR 0012 remains **Proposed** until
the final amended head is reviewed and merged. Documentation/ticket filing alone
authorizes no implementation, code approval, merge, deploy, live report or #614
acknowledgment. The [plan](../plans/648-charge-notice-recovery.md) assigns the
Notice work to [Notice follow-up #651](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/651), separately from
#635's authenticated display and ordinary-invoice changes. The parent and its
R1–R4 children (#652–#655) are filed and unstarted. Native graph and Project #10
readbacks preceded the #635 metadata handoff; #635 retains only closed #634 as
its native blocker. This establishes no runtime or release conformance.

- Initial billing atomically commits the selected billed rows, one linked billing
  event, an immutable versioned Notice and one stable administrator/year/Notice/
  channel delivery intent through #614's version-checked client transaction.
  Retry identities are allocated once; callbacks perform no external effects.
  A collision, stale source, invalid finalized candidate or transaction-budget
  excess produces no partial bill. Functions never write a billing-year document.
- Preview and new snapshot rows allocate the exact selected raw sum to their own
  parent cents under ADR 0010, with ordinal record-id ties and conserved running
  totals. Reject invalid/zero-cent selections before effects. Preserve raw source
  records and historical snapshots. Separate Notices need not sum to household
  `B`; `B` alone decides billed owed. The real recorder and review writer create
  whole-cent outputs for admitted representable inputs; this does not certify
  legacy/imported/direct data or waive broader source/hold/stale guards.
- Fresh recovery names the original Notice ID and rereads durable year revision,
  event/source fingerprint, immutable recipient/membership and complete household
  financial authority. It cannot rebill, replace the snapshot, re-emit the event,
  remint/prune links, create a replacement message or reassign a recipient.
  A changed original contact/membership/email or any admitted-source financial
  hold blocks delivery. Server reauthorization and claim both require shared
  `projectHouseholdMoney(..., { reopenedAdjustmentIds: null })` with `ok: true`;
  no client Boolean or alternative formula is authority. #638 artifact admission
  and explicit admission of additional entrypoints/modules remain separate gates.
- An absent original email preserves billing and the Notice with a delivery-only
  `blocked`/`not_addressable` intent, never an invented address or financial hold.
  Show guidance to the existing text-invoice or share entry points under their
  current financial-hold, privacy, identity and lifecycle guards. This is
  navigation only: no automatic notification/link minting or recipient change.
  Ordinary text invoices exclude `B`; do not claim that they contain this Notice.
- Creation and recovery use **exactly the same historical factual new-format
  copy** defined in ADR 0012, including an initial send seconds after billing.
  It states the original billing date and frozen amount, never that this is now
  due, unpaid or the current household balance. Later payments/refunds may change
  what remains to pay; no per-Notice payment allocation is introduced. Historical
  Notices and generic legacy email remain unchanged.
- The successful transactional claim is the dispatch authorization boundary.
  Changes before claim block it; later changes cannot revoke an external send.
  Creation and explicit fresh recovery share one dispatcher and claim. Server
  attempt/claim evidence is monotonic. Only freshly authorized `blocked` or
  proven `definitely_not_sent` work can become pending again. `processing`,
  `unknown` and `sent` never reset; no timeout reaper or replacement intent.
  Generic processing-lease/retry work in #471 must exclude these versioned Notice
  intents and prove that exclusion; it supplies no Notice retry authority.
- Distinguish billing committed, Notice recorded, pending, processing, blocked,
  proven pre-dispatch failure, unknown and provider-accepted Sent. Sent means
  provider acceptance, not receipt. Observation timeout/listener loss does not
  rewrite durable status. Ambiguous external-call outcomes stop without replay.
  Missing legacy snapshots/untracked mail remain manual protocol blocks; absence
  of a new intent is not evidence the Notice was never sent.
- Closed/archived years are historical-view-only: no new issuance, recovery
  authorization or claim, and no automatic reopen. A send successfully claimed
  while eligible may still finish externally. Before close/rollover, warn with
  counts and each Notice/household identity/status for every intent not `sent`
  (including not-addressable, pending, processing, unknown and pre-dispatch
  failure). Lookup failure shows **Delivery status unavailable**, never a false
  empty list. The administrator may knowingly proceed; this warning adds no
  financial hold, readiness gate or close/rollover lock. Explain that unclaimed
  unsent Notices will remain historical and will not later send, with the
  already-claimed-send exception. Existing financial/lifecycle gates still apply.

Required future validation covers atomicity/stale/unknown commit outcomes;
selected-set, candidate and complete-source holds; immutable recipient/privacy;
new-format first/recovery copy parity; no processing/unknown replay even with a
legacy lease reaper; absent-email navigation; lifecycle/claim races; and
non-blocking warning list/read-failure behavior. These are implementation
obligations, not claims that the present test suite passes them.

Uncommunicated Notices never remove their billed source rows or alter money.
These warnings define no new billed-charge auto-carry rule: existing financial
authority and frozen owed/settlement/carry formulas remain decisive.
