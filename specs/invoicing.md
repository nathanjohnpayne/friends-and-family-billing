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

- **Approved M3 contract, specified before implementation.** The [owner's seven invoice conditions](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/635#issuecomment-6714971444) govern `getInvoiceSummaryContext`. Require complete raw `familyMembers`, `bills`, `payments`, `creditAdjustments` and `owedAdjustments` collections; never infer missing refunds from a rounded member summary or omit invalid money. A valid context carries `ok: true`, firstName, combinedTotal, currentYear, numMembers, canonical component cents and checked dollar aliases. Unknown/stale members, incomplete source and household integrity holds return the explicit private unavailable result below, replacing the earlier unknown-member null result.
- Ordinary invoice total is `I = max(0, G − S + O)`, and balance is `I − N`, with `N = P − R` and default **null** refund-reopening context. Active Service Credits and net opening balance affect `I`; deferred and billed Usage Charges do not. `B` keeps its separate Charge Notice and must never enter this total or balance through a reused settlement alias. Cancellation/eligibility remain the canonical authority's existing rules.
- Payment Received keeps showing gross projected `P` (already net of payment reversals). Only when effective `R > 0`, add one **Refunded** reconciliation row showing `R`, so `I − P + R = balance`. When `R = 0`, retain current rendering/copy, including existing negative-balance semantics and the "remaining balance" label when partially paid. No invoice-specific refund/credit entitlement is created; #617 stays open.
- Required fixtures: `G=100/P=120/R=20` gives balance $0.00 and Refunded $20.00; `R=30` gives $10.00 due; `R=0` keeps existing negative-balance output and omits Refunded. Include `B > 0` with `R > 0` proving B exclusion, and an original/reversal pair proving P already nets it and R is applied once. Null/default reopening remains distinct from the settlement board's active reopened-refund context.
- Household totals and declared additive household rows use the canonical projection/allocation, never independently rounded member totals. #620 independently rounded per-member bill lines and raw administrator audit values retain their existing grain; they do not promise to add to a household subtotal. Member data/tie keys do not become public invoice fields.
- Both public writers adopt `N` in M4/#636, including the Function's additional refunds read. #635 changes neither writer nor their payload/cache/version contract; unreleased intermediate source differences are not permission for a partial release.
- **Carried items (ADR 0009).** `getInvoiceSummaryContext` exposes `carriedItems` (the same member-safe lines `buildCarriedItemsForShare` produces, from the household's `carry_opening` seeds) and `carriedTotal`; `combinedTotal` is unchanged (the opening balance was already folded in). The "full" variant renders a CARRIED FROM 2026 block between the bill tables and the ANNUAL PAYMENT SUMMARY, one line per item attributed to its member with the household credit and its detail at the household level and a carried total, in the copy of `specs/year-end-review.md` § Member-facing copy; a legacy seed renders one line. The Invoicing tab preview and the email dialog's Full invoice variant show the block, and so does every sent email variant: the Full invoice places it between the bill tables and the payment summary, and the text-only and text-link variants append it after the configured message and before the payment methods (one contract with `specs/year-end-review.md` § Member-facing surfaces and #604; no template token is added).
- `buildInvoiceSubject` formats a subject line containing the billing year and member name.
- `buildInvoiceBody` in "text-only" variant produces a greeting with the member's first name and billing year.
- "text-link" variant includes the provided share URL in the body.
- "sms" variant uses "Hey" instead of "Hello" for the greeting.
- "full" variant includes "ANNUAL BILLING SUMMARY" heading and individual bill names in the breakdown.

### Private financial availability and output results

This is the concrete #635 runtime contract extending the approved #634 bridge. It defines private authenticated consumers only; M4 separately defines public hold responses and cache/version behavior.

- The invoice context and every invoice output boundary (`buildInvoiceSubject`, `buildInvoiceBody`, `renderInvoiceTemplate`, `buildInvoiceTemplateEmailPayload`) use a discriminated result. Failure is exactly `{ ok: false, kind: 'financial-unavailable', householdId }`, where `householdId` is the private affected identity or null when unresolved. No monetary fields, stale output, diagnostic source ids, allocation/tie keys or raw provenance accompany failure. Successful context has `ok: true`; successful subject/body/HTML output is `{ ok: true, value: string }`; successful compound email payload is `{ ok: true, html, text, markdown }`. Missing, malformed or failed context is rejected by every exported output boundary, including default-subject and empty-template branches. No caller treats failure as a string, empty invoice, payable zero or successful payload.
- Retain exact visible copy **Financial data unavailable** and **Correct the affected record before settling this household.** A held card or already-open invoice/payment/refund/Charge Notice surface retains identity/contact and permitted nonfinancial context plus Close/Cancel and existing raw history/correction access. Withhold affected payable figures, projected additive rows, financial status claims and payment/refund/preview/generate/copy/send actions. Do not infer Settled/Outstanding/Credit from missing amounts or invent balancing rows.
- Availability remains the stripped private `{ householdId, available, holdCount }` UI signal. Raw audit/correction paths retain their existing evidence and nonblocking reversal/refund-presence warnings, distinct from projected payable money. Invalid audit amounts use unavailable wording; no new reversal restriction is introduced.
- The year display model exposes `aggregatesUnavailable: !metrics.ok`. On any held household or unsafe aggregate, all affected money KPIs, settlement percentage/status sentence and deferred-money aggregate read **Unavailable**. Preserve structural household/paid/correction counts and existing service close/rollover refusals. An aggregate-only overflow creates no fictitious household or correction count and leaves valid household actions usable; do not show partial aggregates as complete totals.
- **Valid → held:** immediately withhold and clear composed subject/body/preview/link values, invalidate outstanding action tickets and hide financial output actions. Any continuation after an awaited link generation rechecks current availability and identity before clipboard, SMS/mail launch, new Notice write or email queue. An already-started side effect is not claimed to be cancelled; no later side effect follows a hold.
- **Held → still held:** source recomputation preserves the unavailable state. No automatic retry, repair, normalization, write-back or new retry workflow. **Held → valid:** only a newly recomputed valid raw source rebuilds current context/preview; a fresh user action is required. Old pending work and an old manually edited invoice never resume as current output. Close/reopen and member/year identity changes also invalidate pending actions; test-email sessions reset with preview identity.
- Direct renderer/API tests cover unavailable and malformed contexts for every output format. Component tests cover the entire valid → held → still held → valid transition, stale preview and asynchronous continuations, valid siblings and aggregate-only failure. Assert no queueEmail, clipboard, SMS/mail or share-generation call after failed availability. Desktop/phone synthetic evidence covers the changed valid/held states without private production data.

### Charge Notice projection and new snapshots

The [owner's eight Notice conditions](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/635#issuecomment-6714986894) authorize this bounded part of #635. The Notice remains separate from an ordinary invoice.

- Each selected set is its own parent: `T = q(Σ exact raw selected amounts)`, once. Use ADR 0010 largest remainder with ascending ordinal `String(record.id)` ties; missing/duplicate ambiguous ids or invalid selected money fail closed. Preserve existing selection eligibility, household membership, chronological display and confirmation ids. Running totals are cumulative allocated integer cents, never successive float re-rounding. No inherited whole-household allocation substitutes for this selected target.
- One projection supplies preview and **new** Notice `amount`/line-item snapshots. Newly sent Notice email uses those same allocated snapshot rows. Before changing deferred records to billed, generating/pruning a share link, writing a Notice or queuing email, verify household availability and selected projection. Recheck asynchronous continuations before their next side effect. A held/invalid selection has no money result and cannot preview, issue, send or copy. A valid selection with `T = 0` is not issuable: disable confirmation and refuse direct service/document issuance before status/event/write side effects; this is not a fabricated integrity hold.
- Historical Notice records and source charge amounts remain untouched. Historical renderers display stored snapshots as stored and do not recompute allocations. Existing append-only status marking, notice identity, event/return shape, transport and confirmation remain; the new event/return amount agrees with the selected projected snapshot. No new persisted money/provenance schema is required.
- There is **no sum-of-Notices promise**: separately issued selection snapshots may sum differently from canonical household `B` when source charges are sub-cent; only B governs owed. `recordUsageCharge` and `year-end-review.buildUsageChargeRecord` currently persist whole-cent charge amounts. Add tripwire tests for both writers so any change to that premise requires revisiting this decision.
- Required fixtures: `a=$0.005` in January and `b=$0.005` in February each produce a 1-cent Notice alone; combined they produce one 1-cent Notice with a/b rows 1/0 and allocated running totals 1/1. After separate billing household `B=1` cent while the two Notice snapshots sum to 2 cents. For two $0.004 charges each singleton is not issuable, while combined T is 1 cent with rows 1/0. Include invalid/non-finite selected money, id ties/permutations and preview/new snapshot/email parity assertions; preserve the existing parity regression.

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
