# Proposed Charge Notice recovery plan — #648

**Status: Proposed amended design; owner-approved contract and four bounded
implementation scopes, now filed and unstarted.**
The [owner decision on PR #649](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6716004056)
accepts all seven choices in [ADR 0012](../docs/adr/0012-charge-notice-recovery.md)
and R1–R4 with four amendments: a clean #635/Notice split; non-blocking
not-sent warnings before close/rollover; one historical factual new-format email
for creation and recovery; and existing authorized text/share guidance for
`not_addressable`. The filed scopes below carry these amendments. ADR 0012
remains Proposed pending review and merge of the final amended head. Acceptance is not code approval or a runtime-conformance claim.

Authorization covers documentation and ticket filing only. No implementation,
code-head approval, merge, deployment, live read/report, data repair/migration or
#614 old-tab-loss acknowledgment is granted. [Notice follow-up #651](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/651) tracks the Charge Notice work separately from #635 and outside the
#611/#629/#603 financial release chain. Its four filed, unstarted children are [R1 / #652](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/652), [R2 / #653](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/653), [R3 / #654](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/654), [R4 / #655](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/655).
Native parent/child/dependency and board readbacks completed before the #635
handoff. All five issues are only on Friends & Family Billing Project #10 in
Backlog: #651 is size:L with no route; #652–#655 are size:M with both high-effort
routes mirrored on the board. #635 now has only closed #634 as its native blocker.
This metadata handoff grants no implementation or release permission. This phase makes no source/test patch and
validates no standalone split candidate. Draft #646 retains its open P1 until a
later authorized actual split and exact-head reviews.

## Source audit

These are immutable source observations, not deployed-state assertions. Main is
`91d341ceb98021e3871107a5c444b8dd3f4374ad`; the current #646 draft audited is
`5887a85f375481ce1a92498643f1d641614e0711`. Issue #614/#615 text was read from
the locally cached API captures for this investigation; implementation must
refresh their decisions and live dependency/deployment evidence.

| Source | Consequence |
| --- | --- |
| [Main `BillingYearService`](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/91d341ceb98021e3871107a5c444b8dd3f4374ad/src/lib/BillingYearService.js), `save`, `_yearDocWrite`, `_saveConfirmed`, `setYearStatus`, `createYear` | Full-year writes and mixed writer paths require #614, not a local await-save workaround. |
| [Main `SaveQueue`](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/91d341ceb98021e3871107a5c444b8dd3f4374ad/src/lib/SaveQueue.js) | The current queue logs/swallow failures and continues. A resolved enqueue is not durable billing success. |
| [Draft `BillingYearService`](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/5887a85f375481ce1a92498643f1d641614e0711/src/lib/BillingYearService.js#L1603), `billDeferredCharges` | Billed source/event state is changed and saved before Notice work; finalized candidate validation alone does not make follow-up recoverable. |
| [Draft `ChargeNoticeService`](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/5887a85f375481ce1a92498643f1d641614e0711/src/lib/ChargeNoticeService.js#L72) | Async snapshot guards can abort after billing/link creation; deterministic `setDoc` still overwrites historical content/time on retry. |
| [Draft `mail`](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/5887a85f375481ce1a92498643f1d641614e0711/src/lib/mail.js#L23) | Every retry creates another random mail document. A 30-second timeout does not cancel delivery. |
| [Draft sender](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/5887a85f375481ce1a92498643f1d641614e0711/functions/index.js#L1385) | Recipient authorization spans every member in every year; it does not bind this Notice's household. Claiming a document prevents a second claim of that document, not duplicate logical mail documents. Post-send errors lack a distinct unknown outcome. |
| [Main compensation writer](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/91d341ceb98021e3871107a5c444b8dd3f4374ad/src/lib/BillingYearService.js#L929), `_compensateQueuedYearWrite` | Its transaction updates the year. #614 must include this newer writer and reconcile compensation with queue stop-on-stale behavior. |
| [Main rules](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/91d341ceb98021e3871107a5c444b8dd3f4374ad/firestore.rules) | Owner-scoped Notice writes currently allow replacement; mail creation accepts only the legacy fields. New immutable bindings need narrowly reviewed rules. |
| [Main member projection](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/91d341ceb98021e3871107a5c444b8dd3f4374ad/functions/billing.js), `projectMemberDisputes`, and Functions response | Charge Notices are excluded; only Refund Notices have a separate response projection. This proposal creates no public Notice payload/endpoint; new identity/source/queue fields stay private. |
| [Main shared financial authority](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/91d341ceb98021e3871107a5c444b8dd3f4374ad/functions/household-money.mjs#L339), `projectHouseholdMoney` | Complete raw-source admission and financial holds must be checked by the server, including fields outside the selected Notice. Node 24 CJS seam/module graph needs #638 admission before R2 import/deploy. |
| [Draft Notice email](https://github.com/nathanjohnpayne/friends-and-family-billing/blob/5887a85f375481ce1a92498643f1d641614e0711/src/lib/chargeNotice.js), `buildChargeNoticeEmail` | Current copy says the amount is now due. Recovery after payments/refunds can leave the household settled; new-format copy must describe historical billing without inferring a current demand or allocating payments to Notices. |

The existing authority is CONTEXT.md; ADRs 0001, 0002, 0005, 0007–0011;
`specs/year-end-review.md` (versioned writes); and `plans/629-cent-rounding-rollout.md`.
Do not infer financial or deployment clearance from this audit.
The [#614 writer-inventory audit](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/614#issuecomment-6715850475)
records the compensation-writer prerequisite separately from this proposal.

## Read-only #646 split inventory

Compared main `91d341ceb98021e3871107a5c444b8dd3f4374ad` to draft head
`5887a85f375481ce1a92498643f1d641614e0711`. This is a structural file/hunk audit,
not an applied patch, passing test run or approved independently reviewable head.
Line references below are at the audited head and must be refreshed when the
actual split is authorized.

| Remains in #635: authenticated display and ordinary invoices | Moves to the Notice follow-up |
| --- | --- |
| All changes to `src/lib/financial-display.js` and `src/lib/invoice.js`; `SettlementBoard.jsx`, `EmailInvoiceDialog.jsx`, `TextInvoiceDialog.jsx`, `Manage/InvoicingTab.jsx` | All changes to `src/lib/chargeNotice.js`, `src/lib/ChargeNoticeService.js`, `ChargeNoticeDialog.jsx` |
| `Dashboard/DashboardView.jsx`: imports 1–3 and calculations import; deferred aggregate 86–107; unavailable/KPI/progress/indicator hunks 116–244; invoice `creditAdjustments` props 345/364 | Same Dashboard: `issueChargeNotice` caller additions 461–471 (`creditAdjustments`, immutable `getState`, original year/household availability) |
| No `BillingYearService.js` production hunk from this draft | `BillingYearService.js`: `summarizeChargePreview` import and `billDeferredCharges` selected-preview/one-cent guard, event amount and finalized billed-candidate guard 1624–1645 |
| `SettlementBoard.test.jsx`, new `authenticated-invoices.test.jsx`, `emailTemplateParity.test.js`, new `financial-display.test.js`, `invoice.test.js` | `ChargeNoticeDialog.test.jsx`, `ChargeNoticeService.test.js`, `chargeNotice.test.js` changes |
| `DashboardView.test.jsx`: deferred-display integrity/counts case 544–558 | Same Dashboard test: original-year/household Notice continuation case 292–306 |
| Existing writer assertions outside the Notice additions remain with their existing scope | `BillingYearService.test.js`: new `toExactCents` import, writer tripwire 701–702, Notice billing/hold/candidate tests 983–1036; `year-end-review.test.js` writer tripwire 259–261 |
| Ordinary-invoice/display paragraphs in ADR 0010, plan #629, billing/invoicing specs, `.ai_context.md` and repository overview | Selected Notice allocation/preview/snapshot/send/guard paragraphs in those shared documents; split prose deliberately without claiming runtime completion |

The shared dependency is `chargeNotice.js` importing `financialUnavailable` from
new #635 `financial-display.js`. Keep that source dependency explicit: the Notice
parent and R3 depend on #635; #635 has no reverse dependency on recovery. R1 must
keep its schema/projection helpers inert without importing a not-yet-landed UI
module. Existing exact-money/household authority primitives already exist on
main. An alternative helper relocation would be a separately reviewed future
source choice, not a change made by this audit.

**Qualified writer evidence:** `BillingYearService.recordUsageCharge` 1438–1443
rounds its parsed finite input to integer cents and stores `cents / 100`;
`year-end-review.buildUsageChargeRecord` 252–261 uses exact `toCents` followed by
checked `snapshotDollars`. True-up records use the existing integer `splitCents`
allocation. Retain the two writer tripwires with the Notice scope. For valid,
representable whole-cent output from these normal writers, selected-parent
rounding introduces no sub-cent remainder difference. This proves nothing about
all stored years: legacy/imported/direct records may contain sub-cent or malformed
money, and extreme/unrepresentable inputs still need canonical admission.
Preserve the sub-cent fixtures and complete-source holds. Whole-cent writer
behavior does not waive stale/year/household/recipient checks, overflow checks,
finalized billed-candidate validation or admission of money outside the selected
charges. Those guards protect broader integrity than a remainder difference.

## Dependency and release boundaries

The required sequence was completed: file all scopes, install and read back
their native graph and Project #10 placement, then remove only #648 from #635.
Before/after evidence is retained in the primary checkout under
`.mergepath/issue-648/file-full-graph-before-handoff.json` and
`.mergepath/issue-648/file-full-graph-after-handoff.json`. The read-back graph is:

```text
#651 Notice follow-up, size:L, unrouted
  native children #652 (R1), #653 (R2), #654 (R3), #655 (R4)
  blocked by #648, #655 (R4), #635
#652 (R1) blocked by #648
#653 (R2) blocked by #652 (R1) and #638
#654 (R3) blocked by #653 (R2), #614 and #635 (shared display-helper source)
#655 (R4) blocked by #654 (R3)

#635 blocked only by closed #634; #648 blocker removed after full readback
#636 blocked by #635 and #638; #638 blocked by closed #633
#637 blocked by #636; #629 blocked by #637; #603 blocked by #629
These existing financial dependencies remain unchanged

Source/release conditions (not assertions that native edges/live evidence exist):
#614 merge requires reviewed/deployed #615 rules and all-current-writer coverage
#614 deploy requires separate owner old-tab acknowledgment and deploy authority
R3/R4 activation requires #615/#614 live plus R1/R2 rules/sender live
```

The fresh native graph has #614 and #615 each blocked by closed #612/#600;
it does not itself encode the stricter #615-live-before-#614-merge prerequisite.
That remains a separate required release condition, not deployment evidence.

The Notice parent and R1–R4 add no blocker to #635, #629 or #603. Their own-parent
Notice work is deferred outside that financial release chain; this scope change
does not certify every existing Notice/source record or waive the remaining
financial release gates. Keep #646 draft and its P1 open until an authorized
source split actually removes the unsafe Notice follow-up and the resulting
heads receive their required reviews. Documentation alone fixes no runtime bug.

#614 does not depend on recovery. R3's source work may merge after #614 source
lands, but no producer/UI activation is permitted until prerequisites are live.
R1/R2 can be prepared earlier as inert work; their rules/sender must be deployed
before any new-format producer is activated. R2's shared financial import and
deployment additionally require #638's closed-graph/exact-path admission and
Node 24 tests, not merely eventual M4 clearance. Additional callable entrypoints,
modules or dispatch targets must re-enter the explicit artifact gate; do not
silently enlarge #638 or use wildcard allowlists. Split additional admission
work into a separately reviewed scope if R2 would exceed size:M. #638 adds no
dependency on #635, so the server authority does not create a #635 cycle; its
source work and deployment still need their own phase authorization. The
complete compatible financial Functions set must precede Hosting activation
under the existing M4 release contract. A link-free email does not waive that
release gate or authorize unrelated public-share changes.

#615's production `createdAt` query/count and any subsequent repair require
separate authorization. Rules deployment before #614 merge and explicit
old-tab-loss acknowledgment before #614 deployment remain independent gates.
No diagram arrow grants that authorization or represents confirmed deployment.
Stage-2/reviewed-rollover gates remain as specified in #616/#607; this proposal
does not move them.

**Historical handoff requirement:** #651 and #652–#655 had to exist with all
native relationships and board state read back before removing #648 from #635.
That sequence is complete; #648 itself still requires final amended-head review
and merge before documentary completion. Metadata/design completion must not
masquerade as implemented recovery. Implementation remains unauthorized. The
amended ADR stays Proposed until its final head is reviewed and merged.

Each R1–R4 implementation scope is `size:M`, high-stakes, routed `anthropic=opus-5.5/high` and
`openai=gpt-6.1-sol/high`. Before starting, inventory the listed source surface
and bound its diff. If it cannot fit one independently reviewable M-sized
change, stop and propose a split for approval; do not silently expand it.
Every PR requires exact-head human financial/security review plus repository
review gates. No PR approval implies merge or deployment authority.

## R1 / #652 — inert versioned Notice and queue schema

Filed issue: [#652](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/652); unstarted.

**Dependencies/inputs:** blocked by #648 documentary completion; owner-accepted
contract with ADR still Proposed pending final-head review/merge; refreshed #614/#615
contract; existing Notice, mail and rules schemas. Source budget: pure Notice and
intent identity/validation helpers, inert exact selected-set projection and
frozen-row validation, matching rules/test fixtures, schema docs;
no service, sender, UI or generic-mail behavior change.

**Outputs:** explicit versions and canonical scoped delivery key; exact raw
source fingerprint and immutable original recipient/membership binding; frozen
parent/row cents under ADR 0010; an explicit absent-original-email representation and blocked
not-addressable intent; narrowly scoped immutable-field rules. New producer permissions
remain disabled until compatible R2 deployment; no new-format mail can reach the
legacy sender through an interim rules allowance.

**Acceptance criteria:**

- Selected own-parent rows/running totals and new frozen rows conserve target
  cents under ADR 0010, including sub-cent/zero/invalid fixtures. Whole-cent
  recorder/review-writer tripwires remain, without certifying legacy sources.
- Duplicate/ambiguous source IDs, malformed versions, identity collisions,
  mismatched payloads and noncanonical fingerprints fail closed.
- The original Notice content/time cannot be replaced or deleted by a new-format
  retry; delivery metadata is separate. Other Request kinds retain their rules.
- Owner-only identity and mail field limits remain enforced; generic mail's
  current schema/behavior is unchanged.
- Document/transaction/rules-access/cardinality limits are explicit and bounded,
  including safe rejection of very large selections before any write.

**Validation:** pure helper round-trip/canonical-order and exact selected-set
projection tests, both normal-writer tripwires, and rules emulator
allow/deny matrix for schema versions, immutable fields and owner scope;
generic-mail and other Request regressions; `npm run test:rules` and relevant
existing suites. No live query or deploy is part of validation.

## R2 / #653 — new-format delivery state and sender claim

Filed issue: [#653](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/653); unstarted.

**Dependencies/inputs:** read-back native blockers R1 / #652 and #638 explicit artifact admission for the shared
financial module graph before import/deployment; refreshed sender/rules
contract; fixed snapshot and year-revision authorization envelopes. Source budget: new-format branch in mail
processing, a shared dispatcher and authenticated fresh-action reauthorization
entry point, queue-only state transitions, associated rules/functions tests.
Generic mail keeps its existing path. If this cannot fit size:M, stop and split
the inert state logic from the activation/API work before starting.

**Outputs:** new-format creation and fresh recovery use the same stable intent
and dispatcher, routed away from the legacy generic sender. A transaction
rereads year/Notice/intent and verifies revision,
source binding, lifecycle and original recipient/membership before claim. Both
reauthorization and claim require `ok: true` from the exact shared
`projectHouseholdMoney(source, member, { reopenedAdjustmentIds: null })` over the
complete raw persisted year from that transaction. The null reopening set is the
ordinary Notice context, not a refund-not-received overlay or an admission
waiver. No client availability Boolean, unexplained client proof, legacy
Functions formula or newly invented formula is authority. The server never
writes a year. The successful claim is the explicit authorization boundary.
Only the server may reauthorize/rearm a proven pre-dispatch outcome, after a
fresh authenticated action with a fixed current revision; it cannot reset a
claimed/unknown attempt. No generic privileged origin marker bypass is added.
Use an explicit dispatch handler for reauthorized pending work; updating a
document does not rerun `onDocumentCreated`. A fresh action may dispatch existing
authorized pending work through that same handler. Creation-event and explicit
handler races arbitrate through one transactional claim, not two senders.
Render exactly the ADR's sole historical factual new-format copy for both
initial creation (even immediately after billing) and recovery: charges were
billed on the original date for the snapshot amount, which is not a current
balance/payment demand. Subsequent payments or credits may change what remains
to pay. Keep legacy messages/historical snapshots unchanged; do not add a
per-Notice payment allocation or new balance formula.

**Acceptance criteria:**

- Two invocations/recovery requests share one logical intent and at most one
  eligible claim; a key/payload collision blocks rather than overwrites.
- Distinguish pending, processing, provider-accepted sent, blocked,
  definitely-not-sent and unknown. An external-call ambiguity or abandoned claim
  never becomes an automatic retry; no processing timeout self-resets.
- Persist monotonic attempt/unique claim evidence; late invocations cannot
  overwrite a later attempt. Fresh authorization permits only
  blocked/definitely-not-sent to pending, never processing/unknown/sent to pending.
- Recipient authorization is Notice/year/household-bound in addition to existing
  verified sender/rate policy. Changes before claim block. Tests document that
  changes after claim cannot revoke the external send. Closed/archived years
  refuse new claims/reauthorization, including previously authorized pending
  work; a pre-close successful claim may finish externally. Prove the
  lifecycle/claim race through the transactional year read.
- A hold from any admitted household source, including fields outside the
  selected charges, blocks reauthorization and claim. An absent original email
  remains blocked/not-addressable; no fabricated or reassigned recipient.
- Initial and recovery messages use exactly the same historical factual copy;
  no first-send branch says the amount is now due. Recovery after later
  payment/refund, including an already settled household,
  retains original rows/amount but never says the amount is now due or unpaid.
- No exactly-once/inbox guarantee or assumed provider idempotency. Any proposed
  provider-specific mechanism is researched against current primary docs first.
- Exclude versioned Notice intents from every generic stale-processing lease,
  reclaim or redelivery helper proposed in [#471](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/471).
  Preserve generic legacy behavior without importing its retry policy. Tests
  prove no Notice processing/unknown reset or replay even if the generic reaper
  lands. No native dependency is required in either direction; serialize actual
  overlapping sender edits if that work becomes active.
- Only the new format is activated; old generic mail and Request behavior remain
  compatible. Functions source guards prohibit all billing-year writes.

**Validation:** mocked provider boundary with failures before the call, during
the call, after acceptance and before durable status update; redelivery/crash/
concurrent claim tests, including a generic #471 reaper attempting to reclaim
versioned Notice processing/unknown work; forged identities and sender privacy
tests; rules suite;
functions suite and existing artifact/security/source guards. Production sends
are outside this ticket's test authority. Exercise malformed/unavailable raw
sources beyond the selected charges, ordinary null-reopening context, Node 24
CJS/ESM loading of the exact closed module graph, and artifact rejection of
unadmitted modules/entrypoints/targets. Test rendered historical copy after
payment/refund and settlement without per-Notice allocation.

## R3 / #654 — atomic client producer, no UI activation

Filed issue: [#654](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/654); unstarted.

**Dependencies/inputs:** read-back native blockers R2 / #653, #614 source with all-writer
inventory, and #635 for the shared private display helper; R1 is transitive. #615
deployment evidence remains a prerequisite for #614 merge. Extract the minimum
approved exact selected-set projection and finalized-candidate guards from draft
#646 as separately reviewed prerequisites, preserving ADR 0010. This Notice
producer is no longer a prerequisite of #635. Import the shared
helper only after #635 lands; no dependency runs back from #635 to this work.

**Source budget:** BillingYearService/#614 primitive extension, pure Notice
projection already covered by R1, service/persistence/queue tests. No new
rounding policy, UI activation, public link writer or Functions source-year
writer. If extracting the exact prerequisites exceeds size:M, stop for an
approved independent prerequisite split.

**Outputs:** one queued transaction bills the fixed selection, appends its event,
freezes its original Notice and creates its deterministic queue intent. Allocate
all IDs before retries. Commit callbacks have no external side effects. The API
returns a confirmed commit or explicit stale/offline/unknown outcome; callers
cannot mistake a swallowed queue failure for success.

**Acceptance criteria:**

- Exact source IDs/raw fingerprint and immutable Notice presentation/recipient
  bind all four records; either every write commits or none does.
- Missing original email preserves billed ledger/event and immutable Notice,
  with a blocked/not-addressable intent; no substitute address or financial hold.
  Persist this state explicitly so R4 warnings/guidance can identify it without
  guessing whether a message was sent.
- Two tabs, rapid same-tab operations, household compensation, stale saves and
  year/lifecycle/account changes respect #614 and source privacy.
- Lost response with matching rev/write identity is adopted. If another revision
  has advanced and proof is unavailable, stop unknown; do not rebill or relabel
  the attempt successful from a partial match.
- Existing mismatched Notice/intent is a conflict; existing source linkage is
  discovery evidence, never authority to issue another bill.
- Parent/row projection, finalized billed component and all transaction size/
  operation/rules-access limits validate before local mutation or writes.
- No UI calls the new producer until release prerequisites are verified live.

**Validation:** transaction mocks that replay, fail before commit, lose response
after commit and advance revision afterward; emulator atomicity/rules tests;
source-mutation assertions; zero/overflow/large-selection fixtures; all-writer
source guard and queue compensation regressions. No live-data validation.

## R4 / #655 — fresh recovery, lifecycle warnings and Notice UI integration

Filed issue: [#655](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/655); unstarted.

**Dependencies/inputs:** read-back native blocker R3 / #654 (R1/R2 are transitive); separately
verified live #615/#614 and compatible R1/R2 deployment evidence before activation; approved UI behavior and existing
M4/Hosting release gates. Source budget: recovery read/action client and
observation status, Charge Notice
dialog/Dashboard integration, a shared non-blocking warning read/API used by the
existing close/rollover flows, existing-path navigation guidance, and focused
service/UI tests. No new close workflow or #606/#607 implementation belongs here.
Stop and propose a bounded split before coding if this complete surface cannot
fit size:M; do not omit the warnings/guidance or silently expand the ticket.

**Outputs:** a fresh action by existing Notice ID reads durable authority, checks
the unchanged original binding and current financial/lifecycle state, then
observes or explicitly requests only eligible recovery of that same intent.
No rebilling, historical rewrite, new logical message, link remint/prune or
legacy repair. A 30-second listener timeout is an observation warning only.

**Acceptance criteria:**

- Billing success, Notice recorded, pending delivery, unknown delivery and
  provider acceptance are distinct. `Sent` is never described as received.
- Holds and changed contact/membership/email fail closed. Closed/archived years
  are historical-view-only; no new issuance/recovery/claim or automatic reopen.
  A successful claim before closure may finish its external send; do not promise
  cancellation or absolute post-close non-delivery.
- Existing snapshots remain untouched. Legacy missing snapshots and untracked
  mail remain blocked/manual, never assumed unsent because a new key is absent.
  A Notice protocol block does not invent a household financial integrity hold
  or settlement/close lock; existing financial authority remains decisive.
- Missing original email is shown as not-addressable delivery, with the billed
  ledger and Notice retained. A later email edit cannot reassign that Notice.
  Direct the administrator to existing text-invoice/share entry points only
  under their current hold/privacy/lifecycle guards; no new recipient, automatic
  notification or share minting. Ordinary text invoices still exclude `B` and
  must not be represented as containing this Notice.
- A fresh recovery after intervening payment/refund, even when settled, shows
  historical billing/acceptance status without asserting an unpaid Notice or
  current demand. Render the original snapshot; do not calculate Notice debt.
- Reload/repeated clicks/two tabs use the same ID. Account/year switches and
  stale dialogs cannot apply asynchronous results to a different context.
- Timeout/listener loss cannot overwrite pending/processing/sent; recovery never
  blindly restarts processing/unknown or invents a replacement intent.
- Before existing close/rollover confirmation, show not-sent intent counts and
  each Notice/household identity/status: blocked/not-addressable, pending,
  processing, unknown and proven pre-dispatch failure. Failed reads warn
  **Delivery status unavailable**, never a false empty result. The administrator
  can proceed knowingly; add no financial hold, readiness gate or close/rollover
  lock. Explain historical-only after close with the already-claimed-send
  exception. #606/#607 must retain this shared warning API in future work; R4
  does not depend on those tickets.
- Integrate only the Notice carve after #635's independent display work. Preserve
  complete-source/finalized-candidate/async guards and existing financial gates;
  run required exact-head checks. Documentation completion alone clears neither
  this implementation nor draft #646.

**Validation:** accessible service-backed UI tests for the outcomes above;
desktop/phone evidence of delivery outcomes, not-addressable guidance and
non-blocking close/rollover warnings, including failed reads; prove no financial
gate changes and no post-close new claim, while an already claimed send can
complete. Focused integration plus relevant
existing suites. Deployment and production verification remain separately
authorized work after exact-head human review.

## Cross-scope test matrix and acceptance boundaries

| Scenario | Required evidence |
| --- | --- |
| Uncertain commit, then later revision | Unknown stop; stable-ID discovery cannot rebill or overwrite. |
| Stable-key collision or payload disagreement | Transaction fails with no mutation/send. |
| Very large selection or transaction budget overflow | Whole action rejected before effects; no chunked partial bill. |
| Pre-feature/stale client and compensation writer | Rules/version protections and explicit unsaved-input behavior; no unsafe revision refresh. |
| Household/contact/email/year/status changes | Fresh durable checks and sender claim boundary; no recipient reassignment. |
| Missing original email | Bill/Notice preserved; not-addressable delivery only; existing guarded text/share navigation without auto-mint/notify, recipient reassignment or B entering ordinary invoices. |
| Close/rollover with unsent intents or failed status read | Counts/identities/statuses or explicit unavailable warning; proceed without a new hold/gate; no new post-close claim, already-claimed send may complete. |
| Financial hold outside selected charges | Shared server authority blocks reauthorization/claim despite a client true availability flag. |
| Recovery after payment/refund, including settled household | Historical factual email/status with frozen rows/total, no now-due claim or per-Notice allocation. |
| Provider acceptance followed by dropped status write | Unknown/processing without automatic resend; sent requires positive acceptance evidence. |
| Creation event racing explicit pending dispatch/retry | One eligible claim; monotonic attempt evidence prevents late status overwrite and generic/new-format dual send. |
| Generic mail, other Request kinds, source/artifact guards | Existing behavior preserved and no Functions year writer introduced. |
| Historical snapshot or legacy delivery without linkage | Original untouched; blocked/manual rather than fabricated recovery evidence. |

The owner accepted all seven ADR choices and all four amendments in the linked
PR decision. The final amended ADR/design head still needs review and merge;
implementation and each later merge/deployment need their own authority. No
current runtime conformance, live report, #614 acknowledgment, financial-data
repair or migration is asserted. The relevant future-contract specification text
cross-references ADR 0012 without claiming that current code implements it.

Uncommunicated Notices never remove their billed source rows or alter money.
These warnings define no new billed-charge auto-carry rule: existing financial
authority and frozen owed/settlement/carry formulas remain decisive.
