# Proposed Charge Notice recovery plan — #648

**Status: Proposed; implementation tickets below are drafts, not filed work.**
The contract recommendation is [proposed ADR 0012](../docs/adr/0012-charge-notice-recovery.md).
No accepted spec or ADR is superseded. The
[#635 owner checkpoint](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/635#issuecomment-6715777283)
proposed a design prerequisite. The later
[#648 owner authorization](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/648#issuecomment-6715850733)
permits design/documentation and proposed ticket drafts only. No code,
acceptance, merge, deployment, production read/report, repair or migration is
authorized. #648 currently blocks #635; documentation completion must not remove
the actual implementation prerequisite.

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

## Dependency and release boundaries

The proposed source/release dependencies are:

```text
#615 reviewed rules + separately authorized deploy
  -> #614 merge (all current year writers, including compensation)
  -> #614 owner old-tab acknowledgment + separately authorized client deploy

R1 -> R2 -> R3 -> R4 -> #635 integration/clearance
#638 explicit module artifact admission -> R2 import/deploy
#614 source -> R3 source
#615/#614 live + R1/R2 rules/sender live -> R3/R4 producer/UI activation
```

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

**Before #648 closes**, install native dependencies for the approved
implementation scopes so #635 remains blocked by their completion. Do not close
#648 based on a merged design and thereby unblock #635 with no recovery code.
The drafts below must be approved before filing implementation issues.

Each draft is `size:M`, high-stakes, routed `anthropic=opus-5.5/high` and
`openai=gpt-6.1-sol/high`. Before starting, inventory the listed source surface
and bound its diff. If it cannot fit one independently reviewable M-sized
change, stop and propose a split for approval; do not silently expand it.
Every PR requires exact-head human financial/security review plus repository
review gates. No PR approval implies merge or deployment authority.

## R1 draft — inert versioned Notice and queue schema

**Dependencies/inputs:** proposed ADR accepted by the owner; refreshed #614/#615
contract; existing Notice, mail and rules schemas. Source budget: pure Notice and
intent identity/validation helpers, matching rules/test fixtures, schema docs;
no service, sender, UI or generic-mail behavior change.

**Outputs:** explicit versions and canonical scoped delivery key; exact raw
source fingerprint and immutable original recipient/membership binding; frozen
parent/row cents; an explicit absent-original-email representation and blocked
not-addressable intent; narrowly scoped immutable-field rules. New producer permissions
remain disabled until compatible R2 deployment; no new-format mail can reach the
legacy sender through an interim rules allowance.

**Acceptance criteria:**

- Duplicate/ambiguous source IDs, malformed versions, identity collisions,
  mismatched payloads and noncanonical fingerprints fail closed.
- The original Notice content/time cannot be replaced or deleted by a new-format
  retry; delivery metadata is separate. Other Request kinds retain their rules.
- Owner-only identity and mail field limits remain enforced; generic mail's
  current schema/behavior is unchanged.
- Document/transaction/rules-access/cardinality limits are explicit and bounded,
  including safe rejection of very large selections before any write.

**Validation:** pure helper round-trip/canonical-order tests; rules emulator
allow/deny matrix for schema versions, immutable fields and owner scope;
generic-mail and other Request regressions; `npm run test:rules` and relevant
existing suites. No live query or deploy is part of validation.

## R2 draft — new-format delivery state and sender claim

**Dependencies/inputs:** R1; #638 explicit artifact admission for the shared
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
Render the new format with the ADR's historical factual copy: charges were
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
  changes after claim cannot revoke the external send.
- A hold from any admitted household source, including fields outside the
  selected charges, blocks reauthorization and claim. An absent original email
  remains blocked/not-addressable; no fabricated or reassigned recipient.
- Recovery after later payment/refund, including an already settled household,
  retains original rows/amount but never says the amount is now due or unpaid.
- No exactly-once/inbox guarantee or assumed provider idempotency. Any proposed
  provider-specific mechanism is researched against current primary docs first.
- Only the new format is activated; old generic mail and Request behavior remain
  compatible. Functions source guards prohibit all billing-year writes.

**Validation:** mocked provider boundary with failures before the call, during
the call, after acceptance and before durable status update; redelivery/crash/
concurrent claim tests; forged identities and sender privacy tests; rules suite;
functions suite and existing artifact/security/source guards. Production sends
are outside this ticket's test authority. Exercise malformed/unavailable raw
sources beyond the selected charges, ordinary null-reopening context, Node 24
CJS/ESM loading of the exact closed module graph, and artifact rejection of
unadmitted modules/entrypoints/targets. Test rendered historical copy after
payment/refund and settlement without per-Notice allocation.

## R3 draft — atomic client producer, no UI activation

**Dependencies/inputs:** R1, R2, #614 source with all-writer inventory; #615
deployment evidence remains a prerequisite for #614 merge. Extract the minimum
approved exact selected-set projection and finalized-candidate guards from draft
#646 as separately reviewed prerequisites, preserving ADR 0010. Do not depend on
merging #635/#646 to create #635's own prerequisite.

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

## R4 draft — fresh recovery action and #635 integration

**Dependencies/inputs:** R1–R3; separately verified live #615/#614 and compatible
R1/R2 deployment evidence before activation; approved UI behavior and existing
M4/Hosting release gates. Source budget: recovery read/action client, observation
status, Charge Notice dialog/Dashboard integration, focused service/UI tests and
#635 rebase. Stop for a scope split if this exceeds size:M.

**Outputs:** a fresh action by existing Notice ID reads durable authority, checks
the unchanged original binding and current financial/lifecycle state, then
observes or explicitly requests only eligible recovery of that same intent.
No rebilling, historical rewrite, new logical message, link remint/prune or
legacy repair. A 30-second listener timeout is an observation warning only.

**Acceptance criteria:**

- Billing success, Notice recorded, pending delivery, unknown delivery and
  provider acceptance are distinct. `Sent` is never described as received.
- Holds and changed contact/membership/email fail closed. Closed/archived years
  are historical-view-only; no resend, mutation or automatic reopen.
- Existing snapshots remain untouched. Legacy missing snapshots and untracked
  mail remain blocked/manual, never assumed unsent because a new key is absent.
  A Notice protocol block does not invent a household financial integrity hold
  or settlement/close lock; existing financial authority remains decisive.
- Missing original email is shown as not-addressable delivery, with the billed
  ledger and Notice retained. A later email edit cannot reassign that Notice.
- A fresh recovery after intervening payment/refund, even when settled, shows
  historical billing/acceptance status without asserting an unpaid Notice or
  current demand. Render the original snapshot; do not calculate Notice debt.
- Reload/repeated clicks/two tabs use the same ID. Account/year switches and
  stale dialogs cannot apply asynchronous results to a different context.
- Timeout/listener loss cannot overwrite pending/processing/sent; recovery never
  blindly restarts processing/unknown or invents a replacement intent.
- Rebase #635 only after its prerequisite extraction, preserve its financial
  guards and source authority, and rerun its exact-head checks. Documentation
  completion alone never clears #635.

**Validation:** accessible service-backed UI tests for the outcomes above;
desktop/phone evidence of the changed states; focused integration plus relevant
existing suites. Deployment and production verification remain separately
authorized work after exact-head human review.

## Cross-scope test matrix and unresolved acceptance

| Scenario | Required evidence |
| --- | --- |
| Uncertain commit, then later revision | Unknown stop; stable-ID discovery cannot rebill or overwrite. |
| Stable-key collision or payload disagreement | Transaction fails with no mutation/send. |
| Very large selection or transaction budget overflow | Whole action rejected before effects; no chunked partial bill. |
| Pre-feature/stale client and compensation writer | Rules/version protections and explicit unsaved-input behavior; no unsafe revision refresh. |
| Household/contact/email/year/status changes | Fresh durable checks and sender claim boundary; no recipient reassignment. |
| Missing original email | Bill/Notice preserved; not-addressable delivery only, no invented address or financial hold. |
| Financial hold outside selected charges | Shared server authority blocks reauthorization/claim despite a client true availability flag. |
| Recovery after payment/refund, including settled household | Historical factual email/status with frozen rows/total, no now-due claim or per-Notice allocation. |
| Provider acceptance followed by dropped status write | Unknown/processing without automatic resend; sent requires positive acceptance evidence. |
| Creation event racing explicit pending dispatch/retry | One eligible claim; monotonic attempt evidence prevents late status overwrite and generic/new-format dual send. |
| Generic mail, other Request kinds, source/artifact guards | Existing behavior preserved and no Functions year writer introduced. |
| Historical snapshot or legacy delivery without linkage | Original untouched; blocked/manual rather than fabricated recovery evidence. |

The owner still needs to accept the ADR's atomic Notice availability,
preserve-bill/Notice policy for missing email with blocked delivery, strict
recipient/membership refusal, claim-time authorization boundary, stop-on-unknown
policy, legacy manual boundary and historical factual new-format email without
a current-payment-demand claim. Implementation issue creation, dependency
installation, acceptance, merge and each deployment remain later actions with
their own authority and exact-head evidence. This proposal records no old-tab
acknowledgment and no approval of a live report.

The ADR's [draft future specification amendment](../docs/adr/0012-charge-notice-recovery.md#draft-future-specification-amendment--not-in-force)
is the concrete proposed normative text for later acceptance. Its lifecycle and
legacy policies remain open owner choices. Do not copy it into accepted
specifications or characterize it as in force before that acceptance.
