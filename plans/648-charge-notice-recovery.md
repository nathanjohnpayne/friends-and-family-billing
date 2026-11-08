# Proposed Charge Notice recovery plan — #648

**Status: Proposed amended design; documentation and ticket-scope changes only.**
The [original owner decision on PR #649](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6716004056)
accepted all seven choices in [ADR 0012](../docs/adr/0012-charge-notice-recovery.md)
and R1–R4 with four amendments: the #635/recovery split; non-blocking not-sent
warnings before close/rollover; one historical factual new-format email for
creation and recovery; and existing authorized text/share guidance for
`not_addressable`. The [bounded owner amendment](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6717695902)
corrects the split: #635 retains the numerical and early-validation Notice
subset already accepted in the [own-parent decision](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/635#issuecomment-6714986894).
The all-Notice carve at `c3f9490` reversed that decision; restoring it introduces
no new formula. ADR 0012 remains Proposed until the new documentation head is
reviewed and merged. `c3f9490` must not be rewritten or merged; the two CodeRabbit
P1 threads [4505108837](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#discussion_r4505108837)
and [4505108847](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#discussion_r4505108847)
stay open until the reviewer accepts the corrected text.

Authorization covers documentation and ticket scope only. No source implementation,
code-head approval, merge, deployment, live read/report, data repair/migration or
#614 old-tab-loss acknowledgment is granted. [Notice follow-up #651](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/651)
tracks the deferred asynchronous/recovery work outside the #611/#629/#603
financial release chain. Its filed, unstarted children are [R1 / #652](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/652),
[R2 / #653](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/653),
[R3 / #654](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/654)
and [R4 / #655](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/655).
The prior native graph/Project #10 readback placed all five in Backlog: #651 is
size:L and unrouted; #652–#655 are size:M with both high-effort routes mirrored
on the board. #648 was removed from #635 after that readback, then restored when
the CodeRabbit findings exposed the scope regression. It remains a design
blocker until the amended #649 head merges; only then remove #648 and read back
the graph. Closed #634 remains the other native prerequisite. No recovery
implementation edge runs back to #635. No source/test patch or independently
validated split candidate is supplied here; draft #646/P1 remain open pending
an authorized actual split and exact-head reviews.

## Source audit

These are immutable source observations, not deployed-state assertions. The
original audit below compared main `91d341ceb98021e3871107a5c444b8dd3f4374ad`
and draft #646 `5887a85f375481ce1a92498643f1d641614e0711`. The bounded amendment
was verified against current main `4b223cb`: #644 already activated exact
`projectHouseholdMoney` behind `getHouseholdFinancials` and
`calculateSettlementMetrics`. Thus the legacy Notice path's `1.005 → 1.00`
versus exact `101` cents, and its raw-zero deferred row becoming an
`INVALID_DOMAIN` billed hold after mutation/event/save, are present current-main
defects. They are not merely future #635 gaps. This establishes source activation,
not verified Hosting/deployment or live-data behavior. No production access or
census was performed. The numerical/early-guard subset belongs in the earliest
financial release, independently of #614/#638; existing complete-set release
gates remain. Implementation must refresh #614/#615 decisions and live release
evidence separately.

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

The original structural comparison used main
`91d341ceb98021e3871107a5c444b8dd3f4374ad` and draft
`5887a85f375481ce1a92498643f1d641614e0711`. The corrected table assigns partial
Notice hunks to #635; the earlier seven-file pure-display carve is superseded.
This is a documentation inventory, not an applied patch, passing test run or
approved independently reviewable source head. Refresh line/hunk boundaries and
perform a fresh M reviewability check before source work.

| Retained in #635 (M3) | Deferred to #651 / R1–R4 |
| --- | --- |
| All display/ordinary-invoice changes in `src/lib/financial-display.js`, `src/lib/invoice.js`, `SettlementBoard.jsx`, `EmailInvoiceDialog.jsx`, `TextInvoiceDialog.jsx`, `Manage/InvoicingTab.jsx`; ordinary-invoice async guards remain unchanged | No ordinary-invoice async guard transfers |
| `src/lib/chargeNotice.js`: one exact selected own-parent projector shared by preview, new stored snapshot amount/rows/running totals, email rows and event amount | Versioned immutable source/recipient envelopes, new-format historical message and recovery contracts |
| `src/lib/BillingYearService.js`: `billDeferredCharges` exact event amount and complete finalized-candidate validation before mutation/event/queued save | #614-backed atomic versioned billing/event/Notice/intent producer; later durable recovery |
| `ChargeNoticeDialog.jsx`: exact preview; raw-zero candidates visible as **Not billable**, with existing correction copy; existing valid positive selections remain usable under the guard | Recovery/delivery UI, not-addressable guidance and lifecycle warnings |
| `Dashboard/DashboardView.jsx`: display/invoice changes and one synchronous fresh post-billing source snapshot for the Notice output boundary | Post-await current-state/immutable-source continuation rechecks and recovery integration |
| `src/lib/ChargeNoticeService.js`: all five raw arrays from that single validated snapshot; freeze projection/presentation before the first transport await | Live `getState`/availability continuation contract after awaits, immutable-source rechecks, fresh recovery and scoped dispatch |
| Numerical Notice, dialog zero/candidate, service snapshot/freeze and event parity tests; both whole-cent writer tripwires; display/invoice tests and ordinary-invoice async tests | Only the Notice post-await service/Dashboard continuation tests transfer, plus new R1–R4 protocol/recovery tests |
| Numerical/early-guard specification paragraphs and acceptance fixtures | Atomic versioned issuance/recovery/rules/sender specifications; no numerical ownership transfer |

The retained production surface is eleven existing paths (the six display/invoice
paths above, `DashboardView.jsx`, `chargeNotice.js`, `ChargeNoticeService.js`,
`ChargeNoticeDialog.jsx`, `BillingYearService.js`), within #635's old thirteen-path
budget. This inventory is prospective, not M certification: bound the actual diff
and recheck size:M before coding; stop for scope review if it cannot fit. Do not
silently restore the all-Notice carve.

### Retained M3 numerical and early-validation contract

Each selected Notice is its own allocation parent: `T = q(Σ exact raw)`; allocate
largest-remainder rows with ascending ordinal `String(record.id)` ties under
ADR 0010. One function supplies preview, new stored snapshot `amount`, email
rows/running totals and `CHARGES_BILLED` event amount. Preserve raw amounts and
historical snapshots. A one-row `1.005` selection yields `$1.01`, also its B
contribution; this one-row consequence is not universal Notice/B equality.
Two separate `0.005` Notices each total one cent and need not sum to household
B. There is no per-Notice settlement promise or new payment allocation.

Before any state mutation, event, queued save or persistence,
`billDeferredCharges` builds a candidate **copy** with the actual selected rows
flipped to billed and actual finalized Notice/source IDs. Run complete household
authority over that copy and refuse the **whole confirmed selection** on any
hold, `T = 0` or empty selection. The pre-bill Dashboard availability check is
insufficient. Raw-zero-only and mixed raw-zero/positive selections both fail
without effects; do not silently drop a zero row from the confirmed service
request. Show raw-zero candidates as **Not billable** with the existing
correction copy so refusal is explainable without a dead end; this does not
invent a new financial hold for the valid deferred state.
A positive source row whose allocated display cents are zero is different:
retain the accepted two `0.004` rows together, `T = 1` with allocated rows `1/0`.
Existing valid positive selections remain usable under the same guard.

At the Notice output boundary, synchronously after the billing mutation/queued
write call returns, take **one fresh `service.getState()` snapshot**. Validate it
through the same availability reader and thread all five raw arrays from it:
`familyMembers`, `bills`, `payments`, `creditAdjustments`, `owedAdjustments`.
Never mix render-time props with that post-bill source. Freeze the Notice
projection/presentation before the first transport `await`. This is a queued-write
boundary, not confirmed persistence: legacy SaveQueue swallows failures. M3 adds
no live `getState`/availability continuation contract after awaits and no new
asynchronous invalidation guarantee. Later transport metadata, such as a share
URL obtained after an await, may be appended without recomputing frozen financial
rows/parent or identity/display context; this does not promise that future transport text already exists.
Ordinary-invoice async guards stay unchanged.

**Known limitation until #651:** stale or failed asynchronous Notice delivery
and legacy orchestration/save uncertainty remain. The synchronous baseline does
not make issuance recoverable, atomic or durably confirmed. #651 alone owns
post-await immutable-source/current-state rechecks, fresh recovery, the atomic
versioned producer and scoped sender/rules work.

The shared source dependency remains explicit: #651/R3 consume #635's private
display/helper and numerical baseline; #635 never depends back on #651–#655,
#614 or #638. R1 remains standalone/inert and consumes the M3 contract without
importing an unlanded #635 UI module. If a future implementation chooses an actual
M3 code import requiring #635 source, record native R1 blocked-by #635 and check
for cycles before starting that work; never add a reverse #635-to-R1 edge. No
import decision or native edge is added by this documentation amendment. Existing
exact-money/household primitives are already on main. Any helper relocation
requires separate source review.

**Qualified writer evidence:** `BillingYearService.recordUsageCharge` 1438–1443
rounds its parsed finite input to integer cents and stores `cents / 100`;
`year-end-review.buildUsageChargeRecord` 252–261 uses exact `toCents` followed by
checked `snapshotDollars`. True-up records use the existing integer `splitCents`
allocation. Retain both writer tripwires in #635, alongside the numerical Notice
tests. For valid, representable whole-cent output from these normal writers,
selected-parent rounding introduces no sub-cent remainder difference. This proves nothing about
all stored years: legacy/imported/direct records may contain sub-cent or malformed
money, and extreme/unrepresentable inputs still need canonical admission.
Preserve the sub-cent fixtures and complete-source holds. Whole-cent writer
behavior does not waive stale/year/household/recipient checks, overflow checks,
finalized billed-candidate validation or admission of money outside the selected
charges. Those guards protect broader integrity than a remainder difference.

## Dependency and release boundaries

The prior graph/Project #10 handoff filed and read back the scopes before
removing #648 from #635. Historical before/after captures remain in the primary
checkout under `.mergepath/issue-648/file-full-graph-before-handoff.json` and
`.mergepath/issue-648/file-full-graph-after-handoff.json`; they do not describe
the restored blocker after the CodeRabbit stop. The current design graph is:

```text
#651 Notice follow-up, size:L, unrouted
  native children #652 (R1), #653 (R2), #654 (R3), #655 (R4)
  blocked by #648, #655 (R4), #635
#652 (R1) blocked by #648
#653 (R2) blocked by #652 (R1) and #638
#654 (R3) blocked by #653 (R2), #614 and #635 (M3 baseline source)
#655 (R4) blocked by #654 (R3)

#635 blocked by #648 and closed #634
  keep #648 until amended #649 merges; then remove only #648 after readback
  no implementation blocker from #651–#655, #614 or #638
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

The Notice parent and R1–R4 add no blocker to #635, #629 or #603. Their
asynchronous/recovery work is deferred outside that financial release chain; the retained M3 numerical
and early-validation subset belongs in the earliest financial release. This scope
change does not certify every existing Notice/source record or waive the remaining
financial release gates. Keep #646 draft and its P1 open until an authorized
source split preserves the M3 baseline while removing the unsafe asynchronous
follow-up and the resulting heads receive their required reviews. Documentation alone fixes no runtime bug.

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

**Handoff requirement:** the earlier metadata sequence completed, but the #648
blocker was restored after the two valid CodeRabbit P1 findings. Leave it in
place now. Only after a new amended #649 head receives exact-head review and
merges may only #648 be removed from #635, followed by graph readback. Metadata
completion is not documentary completion or implemented recovery. The amended
ADR stays Proposed until final-head review and merge; implementation remains
unauthorized. #635 gains no reverse implementation dependency on R1–R4/#614/#638.

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
intent identity/validation helpers, versioned frozen-row/schema validation
consuming the existing M3 projection contract, matching rules/test fixtures,
schema docs; no service, sender, UI or generic-mail behavior change. R1 does not own or
restore the #635 numerical projector or writer tripwires. R1 remains standalone/
inert and consumes the M3 contract without importing an unlanded UI module. If
future implementation chooses an actual M3 code import requiring #635 source,
record native R1 blocked-by #635 and check for cycles before starting that work;
never add a reverse #635-to-R1 edge. No import decision or native edge is added
here.

**Outputs:** explicit versions and canonical scoped delivery key; exact raw
source fingerprint and immutable original recipient/membership binding; frozen
parent/row cents under ADR 0010; an explicit absent-original-email representation and blocked
not-addressable intent; narrowly scoped immutable-field rules. New producer permissions
remain disabled until compatible R2 deployment; no new-format mail can reach the
legacy sender through an interim rules allowance.

**Acceptance criteria:**

- New versioned frozen rows validate the existing M3 own-parent target/row
  conservation contract, including sub-cent/zero/invalid fixtures. R1 consumes
  that baseline; numerical parity and both writer tripwires remain in #635 and
  certify no legacy source census.
- Duplicate/ambiguous source IDs, malformed versions, identity collisions,
  mismatched payloads and noncanonical fingerprints fail closed.
- The original Notice content/time cannot be replaced or deleted by a new-format
  retry; delivery metadata is separate. Other Request kinds retain their rules.
- Owner-only identity and mail field limits remain enforced; generic mail's
  current schema/behavior is unchanged.
- Document/transaction/rules-access/cardinality limits are explicit and bounded,
  including safe rejection of very large selections before any write.

**Validation:** pure helper round-trip/canonical-order and versioned frozen-row
validation against M3 fixtures, plus rules emulator
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

**Dependencies/inputs:** native blockers R2 / #653, #614 source with all-writer
inventory, and #635's landed numerical/early-guard baseline; R1 is transitive.
#615 deployment evidence remains a prerequisite for #614 merge. Reuse M3's exact
selected-set projector and complete finalized-candidate validation; R3 extends
those guards with versioned atomicity and durable source binding, rather than
introducing the first validation. No dependency runs back from #635 to this work.

**Source budget:** BillingYearService/#614 primitive extension, consuming M3
projection through R1's versioned envelope; service/persistence/queue tests. No
new rounding policy, UI activation, public link writer or Functions source-year
writer. Recheck size:M before coding; split for approval if the bounded extension
cannot fit, without moving the M3 numerical baseline out of #635.

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
observation status, post-await immutable-source/current-state continuation
rechecks and Charge Notice dialog/Dashboard integration, a shared non-blocking warning read/API used by the
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
- Integrate recovery after #635's declared numerical/early-guard baseline.
  Preserve its complete-source/finalized-candidate checks and add the deferred
  post-await immutable-source/current-state guards, with existing financial gates;
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
| #635: single stored `1.005` row | `$1.01` across preview/new document/event/email rows/running totals; one shared fixture proves parity. One-row B agreement is not universal. |
| #635: separate `0.005` Notices | Each totals one cent; household B sum comparison is explicitly non-binding. No per-Notice settlement promise. |
| #635: two positive `0.004` rows together | `T = 1`, allocated rows `1/0`; a zero displayed allocation does not make a positive raw row unbillable. |
| #635: raw zero alone or mixed with positive | Whole confirmed selection refused before state mutation, event, queued save or persistence; no silent filtering. Raw-zero dialog reason visible; valid positive selection remains usable. |
| #635: retained source/writer tripwires | Both existing whole-cent writer assertions, existing `.005`/`.004` rows, source holds, stale and overflow fixtures preserved. |
| #635: Notice output boundary | One fresh synchronous post-billing queued-write snapshot, same availability reader, all five raw arrays; freeze before first transport await. No durable-success or post-await invalidation claim. |
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

These are required future tripwires, not passing runtime evidence. The owner
accepted all seven ADR choices and all four amendments, with the bounded
ownership correction in the linked PR decisions. The final amended ADR/design head still needs review and merge;
implementation and each later merge/deployment need their own authority. No
current runtime conformance, live report, #614 acknowledgment, financial-data
repair or migration is asserted. The relevant future-contract specification text
cross-references ADR 0012 without claiming that current code implements it.

Uncommunicated Notices never remove their billed source rows or alter money.
These warnings define no new billed-charge auto-carry rule: existing financial
authority and frozen owed/settlement/carry formulas remain decisive.
