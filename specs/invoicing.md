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
- **Unused incoming credit (#688).** The ordinary invoice balance is `max(0, G − S + O) − N − U`, where `U = max(0, I − A)` is the carried-in credit this year's bills do not use (ADR 0010 § Incoming credit). `U` is zero unless a carried credit exceeds the bills, so every other invoice is unchanged; `B` stays excluded and the reopening context stays null. Without the term a household with bills $60 and a carried credit of $132 would show balance $0.00, and after its $72 refund a balance due of $72.00. Fixtures: bills $264, carried −$300 → total $0.00, balance −$36.00, "$36.00 remains as a credit"; the same with a $36.00 refund → Refunded $36.00, balance $0.00, no "remains" sentence; a $10.00 refund → $26.00 remains.
- Required fixtures: `G=100/P=120/R=20` gives balance $0.00 and Refunded $20.00; `R=30` gives $10.00 due; `R=0` keeps existing negative-balance output and omits Refunded. Include `B > 0` with `R > 0` proving B exclusion, and an original/reversal pair proving P already nets it and R is applied once. Null/default reopening remains distinct from the open/settling settlement board and public share's active reopened-refund context.
- Household totals and declared additive household rows use the canonical projection/allocation, never independently rounded member totals. #620 independently rounded per-member bill lines and raw administrator audit values retain their existing grain; they do not promise to add to a household subtotal. Member data/tie keys do not become public invoice fields.
- **Ordinary invoice versus public share:** [#636 Decision A](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/636#issuecomment-6755855758) preserves invoice `I − N` (less `U`, #688) with B excluded while the public share uses `(I + B) − N`; G=$100/P=$100/B=$40 means invoice $0 and public $40 due. [Decision B](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/636#issuecomment-6755898275) explicitly limits #635 condition 2's null context to ordinary invoices, without editing its original comment: an active unresolved not-received refund in an open/settling year reopens public money like the board, while the ordinary invoice stays null-context. G=$100/P=$120/refund=$20 actively reported means public credit $20 and invoice $0; after close/archive or resolution both show $0. Cancelled dispositions stay excluded in both. See the [canonical public contract](../docs/adr/0010-household-cent-projection.md#public-compatibility-and-release-boundary) and shared matrix. M4 adds the Function's `creditAdjustments` and internal household notice reads; #635 changes neither public writer nor their version/cache contract, and no intermediate subset may release. [Approved Decision #671](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/671#issuecomment-6758892501) makes public serving admission-only; client-created/rebuilt money is a same-snapshot parity artifact for the release interval and owner previews, and [corrected condition 6](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/671#issuecomment-6759162183) retains persisted version 1: an identical certified envelope may be reused under valid age and unchanged complete canonical source inputs, while changed inputs or mismatching/incompatible content forces one server projection and serving of that fresh available/unavailable result. The [current-integrity owner decision](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/671#issuecomment-6771296181) requires fresh publication/certification when complete authority-consumed source input changes, including financial/eligibility settings while excluding payment-method-only presentation settings; it adds no ordinary-invoice validator or formula change. No persistence exception or replacement binding remains. This changes no ordinary-invoice formula/context or source/merge/release authority; reviewed documentation/head and separate source-phase/fresh M gates remain.
- **Carried items (ADR 0009).** `getInvoiceSummaryContext` exposes `carriedItems` (the same member-safe lines `buildCarriedItemsForShare` produces, from the household's `carry_opening` seeds) and `carriedTotal`; `combinedTotal` is unchanged (the opening balance was already folded in). The "full" variant renders a CARRIED FROM 2026 block between the bill tables and the ANNUAL PAYMENT SUMMARY, one line per item attributed to its member with the household credit and its detail at the household level and a carried total, in the copy of `specs/year-end-review.md` § Member-facing copy; a legacy seed renders one line. The Invoicing tab preview and the email dialog's Full invoice variant show the block, and so does every sent email variant: the Full invoice places it between the bill tables and the payment summary, and the text-only and text-link variants append it after the configured message and before the payment methods (one contract with `specs/year-end-review.md` § Member-facing surfaces and #604; no template token is added). Implementation contract (#604): `carriedItems` is the share builder's whole `{ fromYear, items, total, notApplied, remainingCredit, unusedCredit }` object, with the last three restated from canonical cents (`unusedCredit = U`, `notApplied = max(0, −(G − S + O)) − U`, `remainingCredit = min(U, Credit)`, the settlement Credit, so the sentence never promises more than Record Refund offers even though `B` stays outside the invoice balance), or `null` when no seed carries anything (the share payload's gate), and `carriedTotal` is the canonical opening balance O; a context whose `carriedTotal` disagrees with O is rejected like any other invalid money. "Before the payment methods" means before the first payment-methods block of the template (the `payment_methods` block token, or a line that is only `%payment_methods%`); a template without one gets the block after its last line, and the default message gets it after its closing line. The plain-text block (text-only, text-link, Full) is one bullet per item, member's first name first, with a "Your share of …" phrase on its own continuation line and the household credit's detail lines ("Pinecone Vault ended in August: −$4.00 (Ada)") joined by "; " on one continuation line beneath it (the mail renderer joins only one continuation line to a list item); the HTML preview and the markdown test email put each item on one list line, the credit's detail on a second line of the same item. Outside Full the block ends with the first-invoice sentence ("2027 total: $723.00 (2027 bills $668.00 + carried $55.00)", adding "− service credits $X", "; $Y not applied this year" (a forfeited Service Credit excess) and "; $Y of the credit unused" when they apply, so the arithmetic always reconciles) and, when `remainingCredit > 0`, the share page's "$Y remains" sentence. Full's ANNUAL PAYMENT SUMMARY lists `<year> bills`, any `Service credits`, `Carried from <prior>` and any `Not applied this year` before `Combined Annual Total`, and the "$Y remains" sentence after it. A legacy-only household's block is the single line in every variant. SMS (text invoice) bodies are unchanged. Snapshot text is HTML-escaped in the preview and markdown-escaped in the test email.
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
- **Valid → held:** immediately withhold and clear composed subject/body/preview/link values, invalidate outstanding action tickets and hide financial output actions. Ordinary-invoice continuations after awaited link generation recheck current availability and identity before clipboard, SMS/mail launch or email queue. An already-started side effect is not claimed to be cancelled; no later side effect follows a hold.
- Charge Notice output instead takes the bounded synchronous snapshot/freeze contract below. Post-await Notice invalidation/recovery belongs to #651; it does not share the ordinary-invoice continuation guarantee.
- **Held → still held:** source recomputation preserves the unavailable state. No automatic retry, repair, normalization, write-back or new retry workflow. **Held → valid:** only a newly recomputed valid raw source rebuilds current context/preview; a fresh user action is required. Old pending work and an old manually edited invoice never resume as current output. Close/reopen and member/year identity changes also invalidate pending actions; test-email sessions reset with preview identity.
- Direct renderer/API tests cover unavailable and malformed contexts for every output format. Component tests cover the entire valid → held → still held → valid transition, stale preview and asynchronous continuations, valid siblings and aggregate-only failure. Assert no queueEmail, clipboard, SMS/mail or share-generation call after failed availability. Desktop/phone synthetic evidence covers the changed valid/held states without private production data.

### Charge Notice projection and new snapshots

The [owner's eight Notice conditions](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/635#issuecomment-6714986894) authorize this bounded part of #635. The Notice remains separate from an ordinary invoice.

- Each selected set is its own parent: `T = q(Σ exact raw selected amounts)`, once. Use ADR 0010 largest remainder with ascending ordinal `String(record.id)` ties; missing/duplicate ambiguous ids or invalid selected money fail closed. Preserve existing selection eligibility, household membership, chronological display and confirmation ids. Running totals are cumulative allocated integer cents, never successive float re-rounding. No inherited whole-household allocation substitutes for this selected target.
- One projection supplies preview and **new** Notice `amount`/line-item snapshots. Newly sent Notice email uses those same allocated snapshot rows. Before billing, verify complete candidate household authority and the selected projection. Before the first Notice transport side effect, verify the synchronous output snapshot. At the Notice output boundary, validate all five raw arrays from one fresh synchronous post-billing `service.getState()` snapshot through the same availability reader, then copy financial rows/parent, identity and settings presentation before the first transport await. Later URL metadata cannot recompute this presentation. M3 adds no post-await Notice invalidation promise; stale/failed async delivery and legacy SaveQueue uncertainty remain until #651. A held/invalid selection has no money result and cannot preview, issue, send or copy. A valid selection with `T = 0` is not issuable: disable confirmation and refuse direct service/document issuance before status/event/write side effects; this is not a fabricated integrity hold.
- Raw-zero candidates are visibly marked **Not billable**, with the existing correction copy and an explicit exclusion before confirmation. Preview/count/confirmed IDs describe the remaining set. Positive source rows allocated zero cents remain included. Direct billing-service requests containing zero alone or mixed with positive reject the whole requested set before mutation/event/queued save; no confirmed row is silently removed.
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

### Future Charge Notice issuance and recovery contract (#648)

The [original owner decision](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6716004056)
accepts all seven [ADR 0012](../docs/adr/0012-charge-notice-recovery.md) choices
and four amendments; the [bounded owner amendment](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6717695902)
restores #635's already accepted numerical/early-guard Notice scope. This is
future implementation-contract text, not runtime conformance. ADR 0012 remains
**Proposed** until the new amended head is reviewed and merged. Documentation/
ticket scope authorizes no source implementation, code approval, merge, deploy,
live read/report, data repair/migration or #614 acknowledgment.

The [plan](../plans/648-charge-notice-recovery.md) assigns exact selected own-parent
projection, pre-mutation candidate validation, raw-zero dialog visibility and the
synchronous output snapshot/freeze boundary to #635 alongside displays/ordinary
invoices. One exact projector, `T = q(Σ exact raw)` with largest remainder and
ascending ordinal record-id ties, supplies preview, new stored `amount`, email
rows/running totals and `CHARGES_BILLED` amount. Single `1.005` yields `$1.01`;
separate `0.005` Notices each yield one cent and need not sum to household B.
No universal Notice/B equality, per-Notice settlement or formula change.

Before mutation/event/queued save/persistence, `billDeferredCharges` runs complete
household authority on a candidate copy with the actual selected rows flipped
to billed and finalized IDs. Any hold, `T = 0` or empty selection refuses the
whole set without effects. Raw zero alone and mixed raw-zero/positive selections
both fail; never silently filter a confirmed zero row. The pre-bill Dashboard
check alone is insufficient. The dialog shows raw-zero rows as **Not billable**
with existing correction copy, and keeps valid positive selections usable under
the guard. Positive raw rows allocated zero cents remain valid, including two
`0.004` rows together at `T = 1`, rows `1/0`.

At output take one fresh `service.getState()` snapshot synchronously after the
billing mutation/queued-write call returns, validate through the same availability
reader, and use all five raw arrays from it (`familyMembers`, `bills`, `payments`,
`creditAdjustments`, `owedAdjustments`), never render-time props mixed with post-
bill state. Freeze financial rows/parent and identity/display context before the
first transport await. A share URL or transport metadata obtained later may be
appended without recomputing frozen financial values; this is not a promise that
future transport text already exists. Legacy SaveQueue swallows failures, so the
boundary is not confirmed persistence. Ordinary-invoice async guards stay
unchanged; M3 adds no live `getState`/availability continuation contract after
awaits or new async invalidation guarantee.

**Known limitation until #651:** stale/failed asynchronous Notice delivery and
legacy orchestration/save uncertainty remain; #635 does not promise atomic,
recoverable or durably confirmed issuance. [Notice follow-up #651](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/651)
and filed, unstarted R1–R4 (#652–#655) own post-await immutable-source/current-state
rechecks, fresh recovery, atomic versioned producer and scoped sender/rules. R1
consumes the M3 projection and R3 extends the existing early guards. They add no
reverse #635 implementation dependency. #648 was removed from #635 after the
original graph/Project #10 handoff, then restored after review findings; keep it
until amended #649 merges, then remove only #648 and read back. Closed #634 stays.

Main `4b223cb` already activates #644 exact authority; the legacy sub-cent Notice
divergence and zero-after-billing hold are current source defects, not future-
only gaps. This establishes no verified Hosting/deploy or live-data state. The
retained subset belongs in the earliest financial release independently of
#614/#638, under existing complete-set gates. No source split or independently
validated candidate is supplied; #646/P1 remain open pending source authorization
and final-head reviews.

The following atomic/delivery requirements belong to #651/R1–R4; the existing
seven recovery choices and other amendments are unchanged:

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

Required #635 tripwires (obligations, not passing runtime evidence) include one
shared preview/new-document/email-row/event/running-total fixture, single
`1.005 → $1.01`, separate `0.005` Notices with non-binding B comparison, raw-zero-
only/mixed whole-selection refusal without mutation/event/queued save, both
existing whole-cent writers, and preserved `.005`/`.004`, source-hold, stale and
overflow fixtures. Numerical Notice/candidate/snapshot-freeze tests remain #635;
only post-await Notice service/Dashboard continuation tests transfer to #651.
Required #651 validation covers atomicity/stale/unknown commit outcomes;
versioned candidate and complete-source holds; immutable recipient/privacy;
new-format first/recovery copy parity; no processing/unknown replay even with a
legacy lease reaper; absent-email navigation; lifecycle/claim races; and
non-blocking warning list/read-failure behavior. These are implementation
obligations, not claims that the present test suite passes them.

Uncommunicated Notices never remove their billed source rows or alter money.
These warnings define no new billed-charge auto-carry rule: existing financial
authority and frozen owed/settlement/carry formulas remain decisive.
