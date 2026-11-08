# Charge Notice issuance and recovery

**Status: Proposed.** The [original owner decision](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6716004056)
accepted all seven contract choices and the four R1–R4 amendments below. The
[bounded owner amendment](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6717695902)
restores #635's already accepted [own-parent numerical and early-guard scope](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/635#issuecomment-6714986894),
which the all-Notice carve at `c3f9490` incorrectly removed. It changes no formula.
This ADR remains Proposed until the new amended documentation head is reviewed
and merged; `c3f9490` must not be rewritten or merged. Both CodeRabbit P1 threads
[4505108837](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#discussion_r4505108837)
and [4505108847](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#discussion_r4505108847)
remain open until the reviewer accepts the corrected text.

Tracks [#648](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/648).
Authorization covers documentation and ticket scope only; no implementation,
code-head approval, merge, deployment, live read/report, data repair/migration or
#614 old-tab-loss acknowledgment. Contract acceptance establishes no runtime
conformance. [Plan #648](../../plans/648-charge-notice-recovery.md) records the
corrected partial-hunk split. #635 retains displays/ordinary invoices plus exact
selected Notice projection, complete pre-mutation finalized-candidate validation,
raw-zero dialog visibility and the synchronous output snapshot/freeze boundary.
[Notice follow-up #651](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/651)
and its filed, unstarted children [R1 / #652](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/652),
[R2 / #653](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/653),
[R3 / #654](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/654)
and [R4 / #655](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/655)
retain post-await immutable-source/current-state rechecks, fresh recovery,
atomic versioned producer and scoped sender/rules, outside the #611/#629/#603
financial release chain. R1 consumes M3's projection; R3 extends its existing
early guards and R4 integrates recovery against that baseline.

The earlier native graph/Project #10 readback preceded removal of #648 from
#635; that blocker was restored after the CodeRabbit findings. Keep #648 until
the amended #649 head merges, then remove only #648 and read back the graph.
Closed #634 remains the other #635 prerequisite. #635 has no reverse
implementation dependency on #651–#655/#614/#638. No source split or standalone
candidate is validated here; #646 remains draft with its P1 open pending an
authorized split and final-head reviews.

The four owner amendments are part of every relevant R1–R4 acceptance contract:

1. Decouple deferred recovery after the parent, all four children and native
   dependencies exist and are read back, preserving #635's numerical/early-guard
   baseline. #635 keeps #634 and the #648 design blocker until amended #649
   merges; #636 still depends on #635. The recovery parent is outside the
   #611/#629/#603 financial release chain, with no reverse implementation edge.
2. Before close or rollover, list every intent not `sent` with its Notice and
   household identity and status, plus counts, as a non-blocking warning. A failed
   status read says **Delivery status unavailable**; it never becomes an empty
   list or a financial hold. No new dispatch authorization is permitted after
   close; an external send already authorized by a successful claim may finish.
3. Use exactly one historical factual new-format email copy for initial creation
   and recovery, even seconds after billing. It never says the amount is now due.
4. A `not_addressable` result directs the administrator to existing text-invoice
   or share entry points, subject to current hold/privacy/lifecycle guards. It
   never changes this Notice's recipient, auto-notifies, or auto-mints a link.

## Problem

Today billing changes the selected Usage Charges from deferred to billed and
queues a year save before Notice/link/email work completes. A financial hold,
source change or failure can interrupt the follow-up after owed has increased.
The normal billing action no longer selects those charges. Repeating the Notice
helper overwrites its historical snapshot, and repeating the mail helper creates
another independent mail document. Awaiting one save does not protect against a
later stale full-year overwrite.

## Retained #635 baseline — future implementation obligation

Main `4b223cb` already has #644's exact authority behind
`getHouseholdFinancials`/`calculateSettlementMetrics`. The legacy Notice path
rounds stored `1.005` to `$1.00` while exact authority admits it at 101 cents;
a raw-zero deferred row is valid until flipped to billed, where it creates an
`INVALID_DOMAIN` hold after the legacy mutation/event/save. These are present
source defects, not future-only release gaps. This observation does not verify
production Hosting/deployment or live data. The numerical/early-guard subset
belongs in the earliest financial release independently of #614/#638, subject
to existing complete-set release gates.

M3 uses one exact selected-set projector: each Notice is its own parent,
`T = q(Σ exact raw)`, with largest remainder and ascending ordinal record-id
ties. Preview, new stored snapshot amount/rows, event amount, email rows and
running totals all use it. Preserve raw source amounts and historical snapshots.
One `1.005` row yields `$1.01`, also its B contribution; two separate `0.005`
Notices each yield one cent and need not sum to household B. No universal
Notice/B equality, per-Notice settlement promise or new formula is introduced.

Before any state mutation, event, queued save or persistence,
`billDeferredCharges` validates a complete household candidate **copy** with the
actual selected rows flipped to billed and finalized Notice/source IDs. Any
hold, `T = 0` or empty selection refuses the whole selection with no effects.
A pre-bill Dashboard check is insufficient. Raw-zero-only and mixed raw-zero/
positive selections both fail; never silently drop a confirmed zero row.
`ChargeNoticeDialog` shows raw-zero candidates as **Not billable**, using the
existing correction copy, while valid positive selections remain usable under
the guard. Positive raw rows allocated zero display cents remain valid (two
`0.004` rows together allocate `1/0` cents at `T = 1`).

At the Notice output boundary, take one fresh `service.getState()` snapshot
synchronously after the billing mutation/queued-write call returns. Validate
through the same availability reader and take all five raw arrays from that
snapshot: `familyMembers`, `bills`, `payments`, `creditAdjustments`,
`owedAdjustments`. Do not mix render-time props with post-bill state. Freeze
projection/presentation before the first transport `await`. This is not a
confirmed persisted-write boundary: legacy SaveQueue swallows failures.
Later transport metadata, such as a share URL obtained after an await, may be
appended without recomputing frozen financial rows/parent or identity/display
context; this does not promise that future transport text already exists.
Ordinary-invoice async guards remain unchanged. M3 adds no live `getState`/
availability continuation contract after awaits or new async invalidation
promise.

**Known limitation until #651:** stale or failed asynchronous Notice delivery,
legacy orchestration and save uncertainty remain. M3 does not establish atomic,
recoverable or durably confirmed issuance. The proposed versioned contract below
is #651/R1–R4 work and does not reverse-block #635. R1 remains standalone/inert,
consuming the M3 contract without importing an unlanded UI module. If a future
implementation chooses an actual M3 code import requiring #635 source, record
native R1 blocked-by #635 and check for cycles before starting that work; never
add a reverse #635-to-R1 edge. No import decision or native edge is added here.

Required future #635 tripwires include one shared fixture proving preview/new
document/email-row/event/running-total parity, `1.005 → $1.01`, separate `0.005`
Notices at one cent each with non-binding B comparison, positive `0.004` row
allocation, raw-zero-only/mixed whole-selection refusal with no mutation/event/
queued save, both existing whole-cent writers, and preserved source-hold/stale/
overflow fixtures. They are obligations, not passing runtime evidence.

## Proposed #651 prerequisites and authority

Use the versioned year-write primitive from #614, including its `rev`,
`lastWriteId`, stale/offline handling and unsaved-input preservation. Do not add a
parallel compare-and-swap mechanism. Its every-writer audit must include the
household-compensation transaction now present in `BillingYearService`, as well
as saves, lifecycle transitions, creation and rollover. Compensation must remain
compatible with stop-on-stale behavior; it must never apply a fresh revision to
stale arrays.
See the [#614 writer-inventory audit](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/614#issuecomment-6715850475).

#615's stage-1 rules must be deployed before #614 merges. #614 deployment still
needs its separate owner acknowledgment that pre-feature tabs may lose writes
after a year becomes versioned. #615's `createdAt` count needs a separately
authorized production read; any backfill needs its own authority. None is
granted here. #614 remains independent of this recovery feature. The Functions
source guard must continue to prohibit **every Functions write to a billing-year
document**, including recovery and compensation paths.

R2 must reuse the complete financial authority in
`functions/household-money.mjs`, not legacy Functions billing helpers or a new
formula. #638's explicit artifact admission must clear before R2 imports or
deploys that source graph. Verify the closed module graph, exact allowlisted
paths and Node 24 CJS/ESM packaging/security tests. Any additional recovery
entrypoint, module or dispatch target must pass its own explicit artifact gate;
do not silently expand #638 or use wildcard allowlists. A larger admission/API
surface needs a separately reviewable scope. Neither #638 source work nor a
deployment is authorized here.

## Proposed atomic issuance

Bind the operation to the authenticated administrator and selected year. Allocate
the Notice, event and write identities once, outside a retryable transaction.
Through #614's queue and versioned primitive, read the durable year and target
Notice/intent before writes; compare the fixed expected revision, validate the
original selection and household, and validate the finalized billed candidate.
Commit all of the following or none:

- The exact selected source records marked billed with the same `chargeNoticeId`
  and billing timestamp; raw amounts and member ownership stay unchanged.
- One `CHARGES_BILLED` event linking the Notice and exact source IDs.
- One frozen original Notice at the existing Requests substrate path,
  `users/<uid>/billingYears/<yearId>/disputes/<chargeNoticeId>`.
- One deterministic, administrator/year/Notice/channel-scoped `mailQueue`
  delivery intent. Use an unambiguous canonical identity encoding; an existing
  key with different identity or immutable payload is a conflict, never overwrite.

The callback performs only transaction reads, pure validation/projection and
writes. No service-state mutation, link creation/pruning, provider call or
notification occurs inside it. Validate cardinality, encoded document sizes,
transaction operation/rules-access budgets and safe integer bounds before
mutation; fail the whole selection rather than split its billing commit.
Resolve/adopt local state only after confirmed commit. An uncertain outcome is
classified by #614's write identity. If a later revision prevents that proof,
stop as unknown and offer fresh recovery discovery; never replay billing or
adopt a fresh revision onto the attempted payload.

The Notice becomes recorded atomically with billing, independently of email
success. Current `projectMemberDisputes` excludes Charge Notices, and the
Functions response separately projects Refund Notices only. This bounded
proposal adds no member endpoint or public-share Notice payload. Raw source
fingerprints, membership/recipient bindings and queue state remain private.
Any future member-facing Notice availability needs its own reviewed projection
and scope checks. The owner choice about atomic Notice visibility concerns
recording/availability to existing authorized readers, not automatic public
publication.

## Frozen identity and schema

Version the Notice and queue envelopes explicitly. Their immutable binding must
include administrator/year/Notice identity, billing event identity, original
contact member ID, original household member IDs, intended normalized recipient
email (explicitly absent when none exists), the exact source IDs, and a canonical
fingerprint of the original raw
source records. Specify canonical ordering and encoding, reject duplicate or
ambiguous IDs, and do not hash projected numbers as a substitute for raw sources.
The versioned canonicalization covers every immutable source field, including
raw finite-number money and member/bill linkage. It excludes only the expressly
defined billing-transition fields (`status`, `chargeNoticeId`, `billedAt`), whose
expected billed values are verified separately. It cannot silently ignore a
changed money, description, date or allocation input.

Freeze the original source linkage and reviewed presentation together:
projection/schema version, selected-set parent cents, allocated row cents,
member-safe descriptions/dates, original recipient/display context, and billing
time. Row cents sum exactly to the selected-set parent. ADR 0010's selected
Notice allocation remains distinct from the household billed component; the
Notice is not a new financial ledger or a claim that separate Notices sum to
that component. Historical snapshots are rendered as stored, never reallocated.

The Notice's financial content, recipient binding, source fingerprint and
original timestamps are create-once. Delivery status, claim/attempt evidence,
provider acceptance ID, errors and later authorizations live on the separate
queue record. Rules and server validation enforce the new format without
changing Review Request/Refund Notice behavior or broadening generic mail.

## Fresh recovery and privacy

A fresh administrator action names an existing Notice ID. It reads current
durable authority, not caller-held charges or an old open dialog. It verifies
the billed source IDs, original raw fingerprint and event linkage against the
immutable snapshot, plus current year revision, lifecycle, complete household
financial availability and original recipient/membership. It never re-bills,
re-emits the billing event, remints/prunes links or overwrites the Notice.

The owner-approved contract rejects a removed or changed contact, household
membership, recipient email, conflicting linkage or integrity hold. A new
household contact does not inherit a previous recipient's historical Notice.
The current helper permits missing `memberEmail`. Preserve the bill and frozen
Notice when no original email exists, with the intent `blocked` for reason
`not_addressable`. Do not invent an address or later reassign this Notice to a
newly supplied recipient. That delivery-only block creates no financial hold.
The UI offers navigation to
existing text-invoice/share entry points only when those paths are currently
authorized. Ordinary text invoices still exclude billed Usage Charges (`B`);
they do not become a copy of this Notice. No automatic link creation, substitute
recipient, new notification or hold/privacy/lifecycle bypass is introduced.
An unrelated revision change requires fresh authorization, not silent revision
replacement. Bind asynchronous completion to administrator/year/operation so a
year or account switch cannot apply results to another context.

Closed/archived years allow historical inspection only: no issuance, recovery
write, resend or automatic reopening. Any exceptional correction follows ADR
0007 through separately approved future work. This lifecycle policy is
owner-approved as a contract, with this amended ADR still Proposed pending
final-head review and merge. A missing snapshot or uncertain delivery is a Notice protocol block; it does not itself
create a household financial integrity hold or change settlement/close math.
Only the existing financial authority may determine financial availability.
Prefer link-free email with
truthful contact/existing-link guidance. New link minting would introduce the
separate M4/versioned-public-projection dependencies and is outside this proposal.

The current `buildChargeNoticeEmail` says "This amount is now due." Recovery
can occur after later payments/refunds leave the household settled, even when
the billed rows and original Notice are unchanged. The single new-format
message used for both initial creation and recovery records the historical
billing event, not a current payment demand.
Do not allocate household payments to individual Notices, infer that a Notice is
unpaid, recompute its snapshot amount or assert a current amount due. Required
sole new-format copy, including an initial send immediately after
billing (the list retains the frozen original rows):

> These charges were billed to your household on [billing date], totaling
> [original Notice amount]. This is a record of that billing event, not your
> current balance. Later payments or credits may have changed what remains to
> pay. Contact the administrator, or use your existing billing link, to check
> your current balance.

The owner accepted this communication boundary. Creation and recovery cannot
select different wording or reintroduce a first-send current-payment demand.
Apply it only to the new format; do not rewrite historical Notices or generic
legacy email.

## Delivery authorization and outcomes

The client requests delivery against a specific persisted year revision.
Reauthorization and the sender's claim independently run
`projectHouseholdMoney(source, member, { reopenedAdjustmentIds: null })` from
`functions/household-money.mjs` over the complete raw persisted year read in
their transaction, requiring `ok: true`; client availability Booleans are not
authority. Resolve the original household contact from that same read, validate
membership/email/lifecycle and immutable Notice linkage, and fail closed on
any admission/hold failure, including changes outside the selected charges.
The explicit `null` selects the ordinary Charge Notice context, without the
separate refund-not-received reopening overlay; it does not waive source
admission or redefine refund/settlement policy. Never use legacy
`functions/billing.js` calculations or reallocate the original Notice.
Before dispatch the sender transaction also rereads the Notice and stable
intent, verifies the fixed authorized revision and frozen binding, and claims
only an eligible unclaimed, addressable attempt.
It renders only the frozen presentation. The **successful sender claim is the
authorization linearization boundary**. Changes committed before it block
dispatch; changes after it cannot revoke an external send. The owner accepted
this claim boundary; the close/rollover warning below must
state its already-claimed-send exception truthfully.

The sender and recovery endpoint may update delivery records, never source year
documents. Reauthorization of the same logical intent is a server-controlled,
transactional transition following a fresh authenticated action and fixed
revision check; clients cannot reset delivery status. New-format dispatch can
share an internal dispatcher between creation and explicit recovery without
changing legacy generic-mail behavior. Route the new format away from the legacy
generic sender so there is one dispatch path. Merely updating `pending` cannot
reinvoke the existing `onDocumentCreated` trigger: an explicit dispatch handler
must invoke the shared dispatcher after eligible fresh reauthorization. A fresh
action can also dispatch an already authorized, still-unclaimed pending intent;
it does not create a new message. Transactional claims arbitrate creation-event
and explicit-dispatch races. There is no automatic send replay.

Keep a server-controlled monotonic attempt sequence and unique claim identity
with durable transition evidence, so an older invocation cannot overwrite a
newer attempt's status. Only `blocked` or `definitely_not_sent` can transition to
`pending` after new persisted authorization. `processing`, `unknown` and `sent`
can never transition back to pending; there is no abandoned-claim reaper.
Generic stale-processing lease/retry work in [#471](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/471)
must explicitly exclude versioned Notice intents. Preserve its legacy behavior
without borrowing that retry policy; R2 proves the exclusion even if a generic
reaper lands. This compatibility obligation adds no native dependency in either
direction; active overlapping sender changes must be serialized.

| Durable outcome | Meaning and permitted recovery |
| --- | --- |
| `pending` | No successful claim yet; observe/reconcile this same intent. |
| `processing` | Claimed; another send is forbidden. A stranded claim requires reconciliation, not self-reset. |
| `sent` | Provider accepted the message; not proof of inbox arrival or receipt. Observe only. |
| `blocked` | Current authority fails validation before dispatch. Fixing authority requires a fresh action; it never changes the original recipient binding. |
| `definitely_not_sent` | Evidence establishes failure before any external send attempt. A fresh action may authorize the same logical intent again. |
| `unknown` | Send may have happened, or evidence cannot settle an abandoned claim. Stop; no blind retry or replacement intent. |

A 30-second observation timeout or listener loss changes only the displayed
observation state; it never overwrites durable `pending`, `processing` or
`sent`. Failure after entering the external call, an ambiguous provider response,
or loss of acknowledgment after provider acceptance is unknown unless positive
evidence settles it. Persist pre-dispatch evidence so known validation failures
are distinguishable. No exactly-once, confirmed-receipt or provider-idempotency
guarantee is assumed. Any later provider-specific reconciliation proposal must
verify current provider documentation and receive its own review.

## Close and rollover warnings

Before a close or rollover action, show counts and a list of this year's Notice
intents not `sent`, including `blocked`/`not_addressable`, `pending`, `processing`,
`unknown` and `definitely_not_sent` (proven pre-dispatch failure). Identify each
Notice and its household and delivery status. If the status lookup fails, show
**Delivery status unavailable** as a warning, never an apparently empty list.
The administrator can knowingly proceed without sending or recovering these
Notices first. The warning adds no financial integrity hold, settlement lock,
readiness gate or service close/rollover refusal; existing financial and lifecycle
gates still apply independently.

Explain the consequence: after close the Notices are historical only, and no
new delivery claim or recovery authorization can start. Unclaimed unsent work
will not be sent later; a send that crossed the successful claim boundary while
the year was eligible may still finish. Do not promise cancellation of an
external send already in progress. Sender claims and lifecycle writes must
arbitrate through their transactional year read so a pre-close authorization
cannot be newly claimed after close. R4 supplies one shared warning read/API for
the existing close and rollover flows; future #606/#607 review flows retain it
without a reverse dependency from R4 to those tickets.

## Legacy boundary and accepted choices

Existing random mail documents lack Notice linkage. Absence of the deterministic
new key is not proof that an older Notice was never emailed. Missing original
snapshots cannot be silently reconstructed under a new rounding/recipient
contract. Existing snapshots stay unchanged; missing snapshots or untracked
delivery remain blocked/manual, with no new repair policy or migration implied.

The owner accepted all seven choices: atomic Notice recording with billing;
preserve billing/Notice and block delivery when the original email is absent;
strict refusal after original contact/membership/email changes; claim-time
sender authorization; stop on unknown delivery; the legacy blocked/manual
boundary; and the sole historical factual new-format email without a current
payment demand. The four amendments at the start of this ADR qualify those
choices. This acceptance is documentary and does not establish implementation
conformance. This amended design head still requires final-head review and merge;
every later financial/rules PR requires explicit human review of its exact head
and the repository review workflow. No approval implies merge or deployment
permission.

## Future implementation contract — runtime conformance not established

The owner accepted these contract choices subject to the four amendments and
the bounded #635/#651 ownership correction. The
corresponding future-contract sections in the specifications are reviewable
documentation only. They do not claim that current code conforms; this ADR
remains Proposed until the final amended head is reviewed and merged:

> Off-cycle billing commits the selected billed ledger rows, one billing event,
> an immutable versioned Charge Notice and one stable scoped delivery intent in
> the same #614 version-checked client transaction. The callback has no external
> side effects. A conflict or exceeded transaction budget produces no partial
> bill. The server never writes a billing-year document.
>
> Recovery requires a fresh authenticated action naming an existing Notice ID
> and current durable authority. It preserves the exact source binding and
> historical cents/recipient snapshot. It cannot rebill, recreate the event,
> replace the original snapshot, remint/prune links or reassign its recipient.
> Changed original household/contact/email or unavailable financial authority
> blocks delivery. Missing original email preserves billing/Notice and records
> a not-addressable delivery block; no address is invented or reassigned.
> Offer existing authorized text/share entry points without including `B` in an
> ordinary invoice or automatically minting a link. Closed/archived years are
> historical-view-only; no new claim is allowed, while an already claimed
> external send may complete.
>
> Exactly the same new-format copy at creation and recovery states the original
> charges were billed and identifies their historical snapshot total. It makes no claim that this is currently due,
> because subsequent payments/credits may have changed the household balance.
> No per-Notice payment allocation or new balance formula is introduced.
>
> Reauthorization and sender claim require successful complete raw-source
> projection through shared `projectHouseholdMoney` with the ordinary Notice
> context `reopenedAdjustmentIds: null`, never a client Boolean or new formula.
> #638 artifact admission precedes the R2 import/deploy; additional entrypoints,
> modules and dispatch targets require explicit reviewed artifact admission.
>
> The sender's transactional claim against the authorized year revision is the
> dispatch authorization boundary. Source changes before claim block dispatch;
> changes after claim cannot revoke an external send. New-format dispatch uses
> one common claimed path for creation and explicit recovery, with monotonic
> attempt evidence. Only a freshly authorized blocked/proven-pre-dispatch
> failure may become pending again. Processing, unknown and sent never reset.
>
> Sent means provider accepted, not confirmed received. Observation timeout does
> not change durable delivery status. Ambiguous send outcomes stop without
> automatic retry or a replacement intent. Historical missing snapshots or
> untracked delivery remain manual protocol blocks, with no inferred financial
> hold, migration or repair authority. No exactly-once/provider-idempotency
> guarantee is assumed.
>
> Close/rollover lists all not-sent intents and their identities/status/counts,
> or warns that delivery status is unavailable. The administrator may knowingly
> proceed; this adds no financial hold or readiness gate. Explain the
> historical-only consequence and already-claimed-send exception.

Uncommunicated Notices never remove their billed source rows or alter money.
These warnings define no new billed-charge auto-carry rule: existing financial
authority and frozen owed/settlement/carry formulas remain decisive.
