# #629: exact household cents, serial implementation and release gates

[ADR 0010](../docs/adr/0010-household-cent-projection.md) is the approved contract. This documentation-only prerequisite performs no implementation, production read/write, deployment or migration. #629 retains its existing size-M documentation/prerequisite route, `openai=gpt-6.1-sol/high`; it remains open through its implementation/release gates, and this documentation PR uses `Refs #629`. #603 / draft #628 remains held, preserving its carried-items work.

The complete fix is larger than M. The original schedule assigned six financial implementation PRs across the five subsystem stages below plus artifact admission [#638](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/638), seven total. Later approved M2b scope and the pending M4 split below supersede that fixed PR count; do not relabel an expanded implementation M. No conversion of #629 to an L tracker is required. File implementation issues with their own Inputs / Outputs / Acceptance criteria / Validation and the high-stakes routes `anthropic=opus-5.5/high openai=gpt-6.1-sol/high`. Use native serial dependencies M2a → M1, M2b → M2a, M3 → M2b, M4 → M3, M5 → M4; the final implementation/release gate blocks #629, and #629 blocks #603. Do **not** make implementation issues depend on #629 closing: their documentary prerequisite is the merged ADR/spec PR, so that would create a cycle. The final release evidence must cover every series PR, including #638.

The read-only financial callgraph inventory spans at least eleven methods across five integration files; that evidence does not certify the combined authority/adaptation/activation work as M. Stage 2 therefore has two PRs: an unused domain adapter and one coherent activation. Each proposed M scope below names its seam, exclusions and acceptance tests. Before claiming a child, enumerate its actual call sites against then-current main. If evidence makes a scope exceed M, record that evidence and split it at an unused/inactive seam before coding; no partially active financial release and no mechanical file-per-PR decomposition.

## Checkpoint 0: contract precedes code

Inputs: approved proposal and four owner conditions linked in ADR 0010. Output: reviewed ADR/spec amendment and this plan. Validate links, narrow supersession of the rounding freeze, both remainder rules, integer-cent invariants and separate live-report authorization. Gate: contract recorded before money code starts. Documentation approval does not approve any code head. Root handles GitHub issue/review writes; this phase changes only documentation.

The [owner's source-boundary decision](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/633#issuecomment-6690912942) ([supporting record](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/633#issuecomment-6690891415)) adds a prerequisite: document the actual-finite-Number boundary and all seven conditions in ADR 0010 and the review/sharing specs before M2a money code. Every admitted money field must be an actual finite Number; numeric strings, `NaN`, infinities, `null`, `undefined` and booleans hold the affected household, with household/record-id/field/observed-type evidence. The hold blocks that household's settlement, caps, close, carry and public money projection, preserves record presence signals, and changes no write-time parsing. Corrections use the app to write Numbers; no conversion or migration is authorized. The guard inventory below governs sign/domain exclusions. M2b replaces the active coerced-money locks; M3/M4 hold rendering is a prestart contract gate; M5 adds the hold counts described below. These conditions approve no code head, live access or deployment.

### Source sign and domain guard inventory

The first relevant PR body must carry this inventory and its dispositions. M1/#632's merged primitives PR #639 has no source-domain eligibility guards; its body records that boundary. M2a/#633 is the first domain PR and owns the detailed inventory. A silent source drop defaults to an integrity hold unless a cited product contract documents the exclusion; do not classify a legacy guard as approved product behavior merely because it exists. Actual finite zero/negative Numbers remain a separate sign/domain question from invalid source types: arithmetic contribution of zero is not itself a silent drop. Signed zero remains valid in permitted signed fields such as `O`, and `q` normalizes it to integer zero. Valid negative opening seeds and exact negative reversals are preserved. Preserve statuses, cancellation, caller-specific reopening, membership and record presence.

| Source / existing seam | Current admission and amount handling | Required M2 accounting |
| --- | --- | --- |
| `G`: `calculations.js:getBillAnnualAmount` / `calculateAnnualSummary` | Empty assignment lists skip the bill; otherwise annual/monthly arithmetic coerces some strings, uses the full assigned-member denominator and iterates repeated assignments; absent member ids retain their denominator slots. There is no explicit finite/sign guard. | Validate admitted bill money fields as actual finite Numbers. Preserve assignment eligibility/iteration exactly; no membership repair or new bill-sign rule. |
| `S` / `B`: `addFinitePositiveAmount`, Service Credit and billed-charge totals | Active Service Credits / billed Usage Charges use `Number.parseFloat`, silently dropping non-finite and non-positive parsed values. Public Service Credit helpers repeat that parsing. | Non-conforming types hold. Inventory the zero/negative drops separately; they default to holds unless a cited product exception supports exclusion. The stored-zero-share exception does not justify dropping a malformed stored Service Credit. M2b replaces `calculations.test.js`'s two deliberate leading-numeric-string locks with hold assertions; no coerced-money test remains after activation. |
| `P`: `getPaymentTotalForMember` | Raw addition, including original/reversal entries; no finite/sign guard. | Finite-Number source guard plus ADR 0010's exact linked equal-and-opposite reversal validation; malformed/unmatched claimed reversals hold. Keep positive request validation and permitted overpayment; introduce no payment ceiling. |
| `R`: `getCreditAdjustmentTotalForMember` | Non-cancelled records, excluding caller-supplied reopened ids; raw `amount || 0` addition, without finite/sign validation. | Validate every admitted field; no missing/invalid-as-zero fallback. Carry amount uses the null reopened set; marking uses the supplied set. Do not add a disposition-sign policy without a product basis. |
| `O`: `getHouseholdOpeningBalance` and seed hierarchy | Non-voided seeds; client raw `amount || 0`, Functions `parseFloat` with finite filtering; signed values are intentional. Snapshot rounding also coerces through `Math.abs`. | Finite-Number checks at every admitted seed/item/detail money field, signed hierarchy conservation and inherited-target feasibility; no source normalization. Legacy opaque seeds remain valid. |
| Deferred Usage Charges: member/household totals and `buildCarryForward` | Deferred-status records use raw `amount || 0` addition without finite/sign validation. | Finite-Number guard on every admitted field; inventory any added sign/domain drop rather than importing the S/B positive-only filter. Keep deferred amounts outside current owed. |
| Review money edges: `toCents`, `compute`, `buildUsageChargeRecord`, `validateDraft` | Review inputs already require numeric finite values; positive bill/override/new-charge validation and per-record existing-credit matching are separate domain guards. Stored zero shares produce no records (`specs/year-end-review.md` § True-up and Service Credit math, Split; `year-end-review.js:buildRecords`); legacy zero existing-credit answers are accepted by the merged library without dropping their presence. | Preserve documented formula/recording behavior and stored `splitCents`. Supply unused exact replacements and old/new boundary tests without cloning the review engine or changing active callers in M2a. Inventory legacy zero-credit handling explicitly before activation; do not silently drop a source. |
| Presence signals: `getHouseholdRecordedRefund` | Presence is keyed to an active refund record even when its amount cannot contribute to a total. | A held record still exists for this warning; money validity must not erase the presence signal. |

The ordinary Service Credit recorder must conform to the already approved zero-share no-record rule (`specs/year-end-review.md` § Split): keep its input parser and `splitCents`/last-member remainder unchanged, append only positive split shares, and retain the complete zero-inclusive allocation in the existing `SERVICE_CREDIT_RECORDED` event (`payload.shares: [{ memberId, amount }]`, `memberCount = targetIds.length`). This prevents an ordinary future write from immediately producing an invalid active zero source. It does not change S/B admission, existing raw records, or historical correction: persisted zero Service Credits remain held, with no migration, normalization or recovery policy added.

The inventory must name every retained sign/domain exclusion and its product basis, every default hold, and its regression evidence. Stop for an owner choice if an undocumented policy is needed; M2a does not choose new financial behavior. The scoped source-type decision does not authorize changes to recorder parsers, migrations, stored normalization, #617's carry-only limitation, or release/acknowledgment gates.

## M1: unused generic exact arithmetic and allocator

**Inputs:** ADR 0010's generic exact-number, quantization and largest-remainder contracts.

**Outputs:** pure decimal/rational parser, exact arithmetic, quantizer and deterministic allocator, with one reviewed ESM/CommonJS delivery/parity seam (candidate `src/lib/money.js` / `functions/money.js` under existing directories). No source-domain eligibility, component construction or production caller integration yet.

**Acceptance:** parse source `Number.toString()` including exponent form; retain exact multiply/divide/sum; round signed half-cent ties away from zero; normalize zero. Allocate by ordinal immutable keys with exact floor/ceiling feasibility, one increment per eligible row and zero-row preservation; expose an integrity hold rather than an alternative algorithm. Stored `splitCents` is not replaced.

**Validation:** generic exact-number vectors and allocator tests: signed ties, exponent notation, permutation/tie stability, signed mixed rows, endpoint feasibility and impossible inherited targets. Size rationale: one unused generic pure interface and its tests; excludes source-domain adapters, services, persistence, public response and UI integration. Gate: explicit human financial review of this PR's exact head, normal review/CI. May merge unused; no deploy.

## M2a: unused source-domain and candidate-ledger adapter (after M1)

**Inputs:** M1 primitives, ADR 0010 and existing bill/ledger/seed source shapes and eligibility predicates.

**Outputs:** an unused pure domain adapter for exact source extraction, six-component/`U` authority results, proposed post-mutation ledger projection and carry snapshots. Reconstruct `G` from bill source fields, never a floating-point summary. Include current eligibility/cancellation/reopened-refund distinctions, exact reversal pairing and seed → item → non-additive detail allocation with canonical-cent integrity checks, valid legacy/no-sourceId detail handling and inherited-target holds. Keep dollar compatibility at explicit adapter edges. No existing financial gate or renderer calls it yet.

**Acceptance:** apply the finite-Number boundary, household-only integrity holds with household/record-id/field/observed-type evidence, and the sign/domain inventory above; retain record presence signals. Leave active legacy S/B parser locks untouched until M2b; all recorder parsers remain unchanged. Candidate-ledger projection supports existing refund-cap decisions without inventing a payment amount cap; preserve positive payment validation and overpayment eligibility. Carry snapshots conserve assigned cents without modifying existing records. Private allocation keys remain internal; public-safe stripping is a later consumer concern. Existing `calculateAnnualSummary` raw audit/member displays and stored `splitCents` remain available.

**Validation:** the complete ADR 0010 source/six-component fixture matrix, candidate aggregate cap boundary tests, reversal cancellation, carry chains and hierarchy properties, legacy binary residue and infeasible-target integrity holds, plus client/Functions domain vectors. Size rationale: one unused source-domain adapter tested independently of orchestration, financial decision activation and UI/public integration. Gate: exact-head human financial review and normal review/CI. May merge unused; no deploy.

### M2a source interface and guard evidence

`functions/household-money.mjs` is the unused canonical source; `src/lib/household-money.js` and `functions/household-money.js` are thin ESM/Node24 CJS entrypoints. No production financial caller imports them. `projectHouseholdMoney(source, primaryMember, options)` accepts the full raw current **or proposed post-mutation** snapshot and returns complete safe integer-cent authority/allocated rows, or `{ ok: false, householdId, holds }` without money. A caller must supply the complete proposed ledger, not a rounded request delta. `projectHouseholdsMoney` assesses each primary household independently and preserves source household order. It partitions private detail declarations by eligible seed ownership. An ambiguous seed id holds only its candidate owners. Unowned or malformed declarations append explicit `{ ok: false, kind: 'declaration_error', householdId: null, holds }` configuration results after real household results, retaining the declared seed/item ids and no money. Consumers must treat these as overall unavailable while retaining valid sibling projections; metrics/reporting must not count a configuration result as a household. This unused private result distinction chooses no stored/public schema, rendering or recovery behavior. Source preflight enumerates every invalid admitted money field across components and nested O rows before arithmetic, so #637 can count all component/record causes through the same eligibility without a new reporter-side parser. This is private diagnostic data, not a public response schema.

`buildCarryMoneySnapshot` returns detached seed/items/detail plus marking ids for each assessed household; it performs no status transition or write. It uses null reopening for carry amounts and the supplied set for marking eligibility. Preserve the documented aggregate feed gate: materialize a seed only when credit > 0, deferred aggregate > 0, or the review-only unused incoming credit feed > 0. Otherwise return `seed: null` and no marking ids, retaining the full signed projection for audit. A negative-only or cancelling deferred aggregate is not the documented positive-feed zero-net seed case; with another positive feed, preserve signed arithmetic. `carryUnusedOpeningCredit` controls whether U carries; U never enters a disposition. It returns no aggregate carry amount if any household holds or the aggregate exceeds safe cents. Valid sibling projections remain available. Every new cents/100 dollar edge must round-trip to its assigned cents or hold; a safe integer-cent credit can still be unrepresentable in the existing stored Number-dollar model. Exact clamping occurs before safe-Number conversion so an unrepresentable negative intermediate hidden by the owed/A/U floor cannot cause a false hold. Before returning any seed or marking ids, build a detached proposed source ledger with the actual positive `carry_forward` disposition and existing deferred/opening markings, then reproject it under null reopening. Its balance must equal `max(0, pre-carry balance)`, allowing an already-Outstanding open household to carry deferred charges without rejecting its existing debt. The active reopened set may retain credit but cannot gain a new/increased shortfall. A signed half-cent R crossing can violate this invariant because half-away q is not translation-invariant across zero; hold the carry rather than rejecting signed R, changing the disposition amount or inventing balancing cents. Validate emitted disposition ids and Number-dollar round trips as well; no source writes or clock effects occur.

The optional private `detailGroups` projection input names a declared seed/item parent and lists groups of its already-validated detail source ids. Groups must cover that parent completely, with no duplicate/foreign ids. The adapter derives amounts, JSON(sorted constituent ids), minimum-id ties and inherited group/child feasibility from those source rows. Batch projection routes declarations only to the unique eligible seed owner; the owner still validates the item parent and full constituent cover, so a genuine unknown item cannot be dropped. It invents no persisted group schema or business membership and writes no `sourceIds` fields. Production grouping and public stripping remain later consumers' obligations.

`toExactCents`, `snapshotExactCredit` and `projectHouseholdPreviewMoney` supply the review money edges. `tests/react/lib/household-money-review-boundaries.test.js` records old/new boundaries for every named legacy quantizer consumer while leaving `compute*`, record factories, draft/source binding, exact proration and stored `splitCents` active behavior unchanged. These legacy evidence fixtures do not clear #634: that activation must replace the active coerced-money locks and retire legacy financial authority together.

| Retained rule / hold | Product basis and regression evidence |
| --- | --- |
| Empty/unassigned bill exclusion, full denominator and repeated assignment iteration | ADR 0010 Boundary and exact inputs; shared vectors preserve absent/repeated assignments and source-level aggregation. No new G sign guard. |
| S/B non-positive stored source holds; every non-finite/non-Number admitted field holds | Owner decision conditions 1, 2 and 7; shared vectors cover both non-positive guards, all invalid types, every component, nested fields and sibling isolation. No parser conversion, zero fallback or stored-zero-share exception is used here. |
| Cancelled dispositions, voided seeds and nonmatching statuses remain ineligible | ADR 0010 eligibility freeze; shared cancellation/reopening vectors. Type validity does not remove record presence; the refund warning remains a whole-record signal. |
| Negative seeds, finite signed G/R/deferred and signed zero are not silently dropped | Existing signed/raw source arithmetic plus no authorized global sign restriction; shared signed/zero vectors. q normalizes zero. Exact linked reversal pairs retain opposite projected amounts; unmatched/malformed claimed pairs hold under ADR 0010. |
| Canonical-cent parent/child checks, allocation feasibility and private provenance | ADR 0010 hierarchy/allocator rules; binary-residue, zero-child, signed endpoint, grouped-detail, missing/duplicate/foreign-id and permutation vectors. Detail is non-additive. |
| Carry aggregate feed must be positive before a seed materializes; no marking ids without carry | ADR 0010 Incoming credit, carry and epsilon retirement (`credit/deferred cents > 0`), and `calculations.js:buildCarryForward` hasCarryableCredit / hasDeferredCharge gate; shared negative-only, cancelling/zero aggregate, sub-cent-zero contribution and positive-feed zero-net vectors. Keep signed deferred rows visible for audit and retain signed arithmetic when another positive feed qualifies. This documented exclusion is distinct from a silent malformed-source drop. |
| Carry metadata comes only from the already-admitted household/component map | ADR 0010 household grain/provenance and eligibility freeze; shared null-entry, cross-household/cross-kind id collision and generated-seed re-projection regressions. Deferred marking ids and review-credit detail use the same scoped maps; global id-only lookups cannot supply metadata. |
| Finalized generated carry seeds must pass the source hierarchy validator before any seed or marking ids return | ADR 0010 new-carry conservation and provenance contract; the generated deterministic-credit/deferred-source-id collision regression holds rather than renaming a source or emitting a seed that fails re-projection. Ordinary generated zero-net seeds re-project successfully. |
| Truthy non-boolean reversed markers and malformed reversal links hold with the claiming record id | ADR 0010 malformed/unmatched claimed reversal rule. Both legacy share writers use `!p.reversed` despite docstrings saying `reversed === true`; retain that predicate for admitted valid data, hold truthy malformed claims, and retain false/undefined (also other falsy legacy markers). Shared marker, null/missing/unknown-link and sibling-isolation diagnostics assert the actual payment record id, field and observed type. No active writer changes or general metadata type rule. |
| Batch detail-group declarations stay scoped to eligible seed owners | ADR 0010 household integrity/provenance; shared unique-owner plus seedless-sibling, unknown/malformed private declaration, ambiguous-owner plus unrelated-third-household regressions. A tagged `declaration_error` is non-household configuration evidence, not a phantom household or silently discarded declaration. |
| Proposed source ledger must preserve old-year settlement before carry returns | ADR 0010 exact old-year invariant and existing `billing-year.js:applyCarryForwardToPriorYear` disposition/marking model; signed R half-cent crossing and neighboring values, emitted-id collision, normal positive, reopened-refund, open debt and closed-year conservation regressions. Keep signed R admitted; hold only impossible carry, with no returned seed/marking ids or balancing amount. |
| Existing review positive request validation, per-record matching, exact proration and zero-share no-record behavior | `specs/year-end-review.md` True-up and Service Credit math / Split; merged review regression suite and named money-edge tests. This documented write-time exception does not waive source validation. |
| Payment overpayment, carry-only U, null-reopened carry amount and supplied-set marking | ADR 0010 and existing carry contract; candidate aggregate-cap, permitted-overpayment, closed-year balance, empty-year chain and generated conservation vectors. No payment amount ceiling or U disposition is introduced. |
| Unsafe published cents / unrepresentable new Number-dollar snapshots hold | ADR 0010 exact-cent authority and carry conservation; max-safe component cancellation/clamp, unsafe composition/aggregate and dollar-round-trip vectors. No stored schema change. |

Shared source/domain vectors run through both ESM and CJS entrypoints in `tests/react/lib/household-money.test.js` and `tests/functions.test.js`. The primitive library, active financial modules, recorder parsers, artifact allowlists and deploy/security tooling remain unchanged. Source interoperability is not artifact admission, activation, human exact-head clearance or deployment.

## Artifact admission prerequisite: #638 (after M2a, before M4)

[#638](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/638) depends on M2a (#633), when the required Functions source modules are known, and blocks M4 (#636) alongside its M3 prerequisite (#635). M1 and M2a prove source interoperability only: their new modules are not in the current deployment artifact allowlists.

This separate PR registers the complete required module set in both the artifact producer and verified consumer. Validate that the artifact contains every required Functions module, that admission remains closed to unexpected files, and that security checks and compatibility with retained artifacts are preserved. Normal review/CI and explicit human review remain required. This prerequisite authorizes no deployment and does not permit a partial financial release; M1 does not change artifact or security tooling.

## M2b: coherent activation of existing financial gates (after M2a)

### Owner-approved minimal bridge and serial M/M split

[Owner-approved bridge scope](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/634#issuecomment-6696245972), confirmed directly in the current Codex conversation, supersedes the audit's pending proposal. This is scope approval only, not approval of any code head or release.

1. Keep a held household visible with exact card copy **“Financial data unavailable”** and **“Correct the affected record before settling this household.”** Aggregate money KPIs and the settlement percentage/status sentence read **“Unavailable”** whenever any household is held. Keep household counts plus a count needing correction. No other M3 display work transfers.
2. `paidCount` excludes held households; `remaining` cannot reach zero while a hold exists. Ready-to-close is false by construction, not just hidden display.
3. Both `BillingYearService.setYearStatus('closed')` and the `createYear` orchestration seam refuse at the service boundary while any hold exists, with tests. UI disabling alone is insufficient.
4. Withhold **entry points only**: payment, refund, invoice preview/generate/send/copy for held households. This includes already-open dialogs or stale previews after a valid → held change. Invoice API/renderer unavailable results remain M3; public share responses remain M4. The private `{ok:false, householdId, holds}` signal carries no money values or provenance/tie keys. No new public payload contract is inferred.
5. Valid households retain positive-amount payment validation, permitted overpayment, presence warnings and existing administrator audit/correction access. No repair workflow, write-back, automatic retry, migration or stored conversion.
6. Carry validation uses **actual finalized ids passed through the adapter**, never a deterministic stand-in ledger. The other audited integration findings are acceptance criteria: real service close/carry paths, complete raw inputs for `getHouseholdFinancials` (not reconstructed rounded summaries), and audit-only PaymentHistoryDialog warnings without new reversal restrictions.
7. This scope transfer is recorded in #634, #635 and `plans/629-cent-rounding-rollout.md` before code. M3 extends the bridge and may never regress a hold to Paid/settled or payable zero.
8. The M recheck selected the owner-preapproved **two serial PRs**. First, bridge consumers handle `ok:false` while no active financial producer emits it; second, coherent activation after the first merges and main CI passes. At no head may a consumer render a hold as Paid. Both require separate exact-head human financial review, normal review/CI, no deploy and no live report. Functions-before-Hosting remains a later complete-set release gate.

The added live entry-point guards span SettlementBoard, Dashboard, Manage/InvoicingTab and existing email/text/share dialogs, in addition to activation's financial modules and existing test call sites. Combining both slices would not certify one M PR. The split is by inactive consumer seam, not partial activation. First PR uses `Refs #634`; #634 stays open until the later activation PR completes its source acceptance. No new implementation issue or parallel stream is introduced. #638 remains unstarted.

**PR 1 (consumer bridge, `Refs #634`):** preserve all active calculations/eligibility and prepare private held-state handling across SettlementBoard, Dashboard, InvoicingTab, Email/TextInvoiceDialog and ShareLinkDialog, including already-open/async entry points. The existing off-cycle Charge Notice preview/confirmation is an invoice entry point too; test-email sessions must close/reset when their preview member changes. Keep history/correction access and nonfinancial context. Prepare service close/create-year refusals with mocked/supplied hold contract tests, without an active hold producer. A small private availability edge may coordinate consumers; it must not import/activate the source money adapter. No arithmetic, source coercion, cap or carry semantics change in this PR. Add behavioral and desktop/phone visual evidence. Exact-head human financial review and normal reviews/CI gate merge.

**PR 2 (coherent activation, `Closes #634`):** start only after PR 1 merges and main CI is green. Wire all financial authority, strict source holds, candidate refund ledgers, real finalized carry ids and the original activation callgraph below together. Real malformed-source tests exercise the merged bridge/service guards; valid sibling households remain usable. Rewrite the named coercion locks and epsilon authority as one activation. Exact-head human financial review and normal reviews/CI remain mandatory. No partial financial release, deploy or live report; stop at the phase checkpoint.

**Activation source contract (second PR, not deployed):** `getHouseholdFinancials(member, source, {reopenedAdjustmentIds})` requires `familyMembers`, `bills`, `payments`, `creditAdjustments` and `owedAdjustments` arrays. Success carries safe integer components and checked dollar aliases; failure carries household identity/diagnostics without money. The availability edge strips diagnostics before UI consumption. Aggregate overflow creates a year-level private hold without inventing a held household or disabling valid household actions.

The carry plan receives actual disposition ids plus source/destination labels before validation. The one whole-year candidate owns id namespace/collision checks, source status markings and next-year seeds; downstream helpers cannot generate replacement ids. Legacy zero-net seeds remain omitted; itemized review zero-net seeds retain their explanation. Source amount/cap/carry checks keep null reopening; board/metrics/history preserve their active reopening context.

| Caller group | Activation treatment |
| --- | --- |
| `getHouseholdFinancials`, metrics, outstanding/close, both refund caps, carry, history reversal warning, review quantizer/preview consumers | Exact raw-source authority; no epsilon or numeric-string coercion |
| `calculateAnnualSummary`, member payment/deferred/credit/opening display helpers | Raw member/audit or explicitly legacy display only; never settlement/cap/close/carry authority |
| `recordPayment`, existing service/usage write-input parsers | Existing positive-input parsing and stored split remainder preserved; no payment ceiling |
| `invoice.js`, `share.js`, public Function/cache writers and raw StatusBadge helper | Legacy M3/M4 numerical version remains unadapted; existing writer/cache parity tests retained, with canonical 66.67 versus legacy 66.66 explicitly separated |

Hold consumers skip legacy monetary sums before rendering non-coercible source values, preserving record-presence counts and audit/reversal/correction access. Unformattable audit amounts use the existing unavailable signal; valid member displays remain unchanged. This is the approved bridge integration, not a renderer API or recovery policy.

Settlement progress retains its nearest-whole-percent/clamp behavior, computed as an exact integer ratio so positive half-percent ties round upward.

No `CREDIT_EPSILON` export or authenticated authority caller remains. Functions/public legacy half-cent comparisons remain M4 work. No new schema, stored conversion, repair policy or deployment is included.

**Reviewability evidence:** the read-only recheck found live entry points in Manage/InvoicingTab plus email/text/share dialogs and stale-preview/async continuation paths beyond the original financial helper files and roughly66 existing helper test call sites. Combining this availability subsystem with arithmetic/candidate-ledger activation would not certify one M PR. Use the approved inactive consumer seam; do not split merely by file or partially activate money. #634 remains open after PR 1. #638 is unstarted and is not part of this authorization.


**Inputs:** tested unused adapter and the verified financial callgraph.

**Outputs:** wire `calculations.js:getHouseholdFinancials`, `calculateSettlementMetrics`, `buildCarryForward`; `billing-year.js:calculateOutstandingBalance`, `buildCarryForwardSummary`, `buildCarryOpeningItems`, `applyCarryForwardToPriorYear`, `buildNewYearData`; `BillingYearService.js:issueRefund` and the existing `createYear` orchestration seam; `SettlementBoard.jsx`'s HouseholdCard payment/refund action availability and `handleIssueRefund` cap; and `year-end-review.js` preview to the same cent authority. UI decision handlers belong in this activation series despite their file location; pure display work stays in M3 except the explicitly approved minimal held-state bridge above.

**Acceptance:** replace the two active leading-numeric-string S/B test locks with hold assertions when moving summation onto the authority. No test may assert coerced money after activation; legacy display helpers cannot decide money. Preserve presence signals for held records. Activate settlement, existing refund caps, payment-button availability, close and carry together; remove financial epsilon comparisons at every listed seam. `recordPayment` and `SettlementBoard.handleRecordPayment` keep their existing positive-amount validation and **no amount ceiling**: overpayment remains allowed. HouseholdCard's existing payment availability gate (`balance > CREDIT_EPSILON`) becomes a cent decision, not a new request ceiling. Both refund-cap layers (`issueRefund` and HouseholdCard's `handleIssueRefund`) validate against recomputed candidate-ledger components, never independently quantized request amounts. Preserve floor, `B`, eligibility, caller reopened-refund distinctions, append-only ledgers, stored `splitCents`, per-record credit netting, carry-only `U` and existing transaction/version orchestration. Inventory every remaining `CREDIT_EPSILON` caller and prove it cannot feed a projected financial outcome, or remove it.

**Validation:** wiring regressions across calculations, service/refund handlers, billing-year, review and HouseholdCard decisions: one-cent availability/refund caps, fractional aggregate crossings, permitted overpayment, #620, cancellation/reopening, carry/zero-net seeds, closed-year assertions, integrity holds and ledger immutability. Size rationale: source interpretation and carry-snapshot construction already landed unused in M2a, so this PR activates existing decisions through that adapter; excludes pure display/invoice, public protocol, credentials and deployment. The eleven-method/five-file inventory is a minimum, not automatic M certification: confirm the wiring diff fits M before starting; surface any remaining indivisible scope conflict instead of partially activating gates. Gate: exact-head human financial review and normal review/CI. No deploy.

## M3: authenticated financial display and invoice consumers (after M2b)

**Current source candidate:** #635 adapts the eleven production paths below to the
existing cent authority, including the synchronous Notice boundary. Ordinary
invoices use `I − (P − R)`, with B excluded, null reopening, Paid P and one
Refunded R row only when R > 0. The private renderer/output result contract is in
[the invoicing spec](../specs/invoicing.md#private-financial-availability-and-output-results).
The prior #649 design is preserved below; its documentation prerequisite merged
as `a02064ea`. This candidate grants no review, merge or release clearance.


### Owner-approved bounded Notice scope split (#648)

The [bounded owner amendment](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6717695902)
corrects the all-Notice carve in the [original split decision](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6716004056).
It restores #635's [already accepted own-parent projection and early guards](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/635#issuecomment-6714986894),
without a new formula. [Plan #648](648-charge-notice-recovery.md#read-only-646-split-inventory)
records the corrected partial-Notice-hunk/test inventory. The retained production
surface is eleven existing paths within the old thirteen-path budget; the old
seven-file pure-display carve is superseded:

| #635 retained production paths | Bounded scope |
| --- | --- |
| `financial-display.js`, `invoice.js`, `SettlementBoard.jsx`, `EmailInvoiceDialog.jsx`, `TextInvoiceDialog.jsx`, `Manage/InvoicingTab.jsx` | Display/ordinary invoices; ordinary-invoice async guards unchanged |
| `Dashboard/DashboardView.jsx` | Display/invoice work and synchronous post-billing source snapshot |
| `chargeNotice.js` | Exact selected own-parent preview/new snapshot/event/email rows/running totals |
| `ChargeNoticeService.js` | One five-array validated source and presentation frozen before first transport await |
| `ChargeNoticeDialog.jsx` | Exact preview, raw-zero **Not billable** rows with existing correction copy |
| `BillingYearService.js` | Exact event amount and complete finalized-candidate validation before effects |

Recheck the actual diff for size:M before source work; this inventory is not an
independently tested candidate or prior M certification. If it cannot fit, stop
for scope review. #646 remains draft with its open P1 until an authorized actual
split and final-head reviews. Documentation/ticket scope authorizes no source
implementation, code-head approval, merge, deploy, live read/report, repair,
migration or #614 old-tab acknowledgment. ADR 0012 remains Proposed pending
review/merge of the new amended documentation head; `c3f9490` is not mergeable.
Its two valid CodeRabbit threads stay open until reviewer acceptance.

[Notice follow-up #651](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/651)
and filed, unstarted R1–R4 (#652–#655) retain post-await immutable-source/current-
state rechecks, fresh recovery, atomic versioned producer and scoped sender/rules,
outside the #611/#629/#603 chain. R1 consumes the existing M3 projector contract;
R3 extends its early guards. #651/R3 depend on #635's baseline, never the reverse.
The earlier native/Project #10 handoff removed #648 from #635; after the review
findings that blocker was restored. Keep #648 until amended #649 merges, then
remove only #648 and read back the graph; closed #634 remains. No implementation
edge from #635 to #651–#655/#614/#638 is introduced. #636 stays blocked by #635
and #638; #638 by closed #633; #637 by #636; #629 by #637; #603 by #629.

Main `4b223cb` already activates the exact authority through #644; the legacy
`1.005 → $1.00` Notice and raw-zero-after-billing hold are current source defects,
not future-only gaps. Source activation establishes no verified Hosting/deploy
or live-data state. Retain the numerical/early-guard subset in the earliest
financial release independently of #614/#638; the complete financial/public
release gates, report, holds and exact-head review requirements still apply.

M3 **extends** #634's minimal bridge and never regresses a hold/incomplete aggregate
to Paid/settled, payable zero or stale money. Full invoice unavailable results and
display adaptation remain here; public response/cache/version semantics remain M4.

**Prestart gate:** define household integrity-hold rendering and bound the eleven-
path diff before implementation. Existing source work and this contract authorize
no implementation or partial release.

**Inputs/outputs:** authoritative cent components and allocated rows; bounded
authenticated display/invoice adapters retain #620 independent member bill lines
and raw audit access. Payment/refund availability and caps remain the M2b decision
logic. Exact selected Notice `T = q(Σ exact raw)` uses largest remainder with
ascending ordinal record-id ties; one function supplies preview, new stored
snapshot `amount`, email rows/running totals and `CHARGES_BILLED` event amount.
No source normalization or historical snapshot rewrite.

**Early guard/output contract:** before mutation/event/queued save/persistence,
`billDeferredCharges` builds a complete candidate copy with actual selected rows
flipped to billed and finalized IDs, projects complete household authority, and
refuses the whole selection on any hold, `T = 0` or empty selection. Raw zero
alone or mixed with positive is refused without effects or silently dropping a
confirmed row. Raw-zero dialog rows show **Not billable** and existing correction
copy; positive raw rows allocated zero display cents remain valid, including two
`0.004` rows together at `T = 1`, rows `1/0`. Valid positive selections remain
usable under the guard. The Dashboard pre-bill check alone is insufficient.

At Notice output take one fresh `service.getState()` snapshot synchronously after
the billing mutation/queued-write call returns, validate through the same
availability reader, and use all five arrays (`familyMembers`, `bills`, `payments`,
`creditAdjustments`, `owedAdjustments`) from it. No render-time/post-bill mixing.
Freeze financial rows/parent and identity/display context before the first
transport await; later transport metadata can be appended without recomputing
those values. A queued call return is not durable confirmation: SaveQueue still swallows failures. M3 adds
no live continuation `getState`/availability contract after awaits; ordinary-
invoice async guards remain unchanged.

**Acceptance:** additive household rows conserve cents; ordinary invoices keep
their scope. Each Notice is its own parent, not a new ledger: two separate
`0.005` Notices total one cent each and need not sum to B. One `1.005` Notice
matches its B contribution at `$1.01` as a one-row consequence, not a universal
Notice/B equality or per-Notice settlement promise. Existing financial formulas,
source amounts and historical snapshots stay authoritative. **Known limitation
until #651:** failed/stale asynchronous Notice delivery and legacy orchestration/
save uncertainty remain; M3 does not promise atomic/recoverable/durable issuance.

**Validation obligations, not passing test evidence:** one shared numerical
fixture proves preview/document/email-row/event/running-total parity; single
`1.005 → $1.01`; separate `0.005` Notices and non-binding B comparison; raw-zero-
only/mixed refusal without mutation/event/queued save; both whole-cent writer
tripwires; existing `.005`/`.004`, source-hold, stale and overflow fixtures.
Numerical Notice/candidate/snapshot-freeze tests remain #635; only post-await
Notice service/Dashboard continuation tests transfer to #651. Targeted display/
ordinary-invoice tests and desktop/phone evidence remain required. All later
financial heads need explicit human financial review plus repository review/CI;
no deploy before the complete set.

## M4: both public writers and money-version consumer (after M3 and #638)

**Contract gate:** the owner's [Decision A](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/636#issuecomment-6755855758), [Decision B](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/636#issuecomment-6755898275) and [Decision C](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/636#issuecomment-6756101119) settle public money, reopening and unavailable/history behavior. They supersede pending-choice wording in the earlier M4 scope record without erasing it. [ADR 0010](../docs/adr/0010-household-cent-projection.md#public-compatibility-and-release-boundary) is canonical; [sharing](../specs/sharing.md#unavailable-summary-636-decision-c) supplies presentation/retry/history tests and [invoicing](../specs/invoicing.md#invoice-helpers) preserves the invoice distinction. Reviewed documentation and separate phase approval still precede source work; these decisions approve no implementation/head/merge/live read/deploy.

**Inputs/outputs:** one complete five-array raw household snapshot, owner/year/status and complete ready Refund Notice context feed one `projectHouseholdMoney` result. Both public writers emit T=I+B, N=P−R, balance T−N with I floored first, monthly excluding B, truthful single B/R rows and history allocated P. Open/settling uses the board helper's active-report set; closed/archived and ordinary invoices remain null. Missing/loading/failed notice context yields unavailable. Add the Function's `creditAdjustments` and internal household notice reads regardless of detail scope, without expanding disclosure. Both writers emit version 1 and available/unavailable; actual cache/Function consumers validate version/state/shape before money, retain independent scoped historical workflows and handle authoritative hold/retry/background results under C. Never pair a compatible marker with legacy arithmetic or private diagnostics.

**Complete source inventory (main `bfcf9bb38f55a9339496af04c10f926894d71465`):** `share.js`, `functions/billing.js`, `functions/index.js:resolveShareToken`, ShareLinkService creation/rebuild, ShareLink/Email/Text dialogs, InvoicingTab's direct preview-link writer, Dashboard and RefundNoticeService/ChargeNoticeService issuance snapshots, BillingYearService contact/name rebuild inputs, useRefundNotices readiness/resolution, the member `submitRefundConfirmation` handler, year-status transitions, and ShareView's actual cache/live and independent historical consumers. The [expanded audit](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/636#issuecomment-6756391217) found this whole **larger than one coherent M PR**. The original single-M rationale is superseded; source remains blocked at the split checkpoint.

### Proposed serial split — pending owner phase approval

These are review boundaries proposed after the audit, not filed/authorized child scopes or certified M units. Resolve the issue/PR boundaries before implementation; do not claim the existing size-M label proves reviewability.

1. **M4a: inert consumer bridge.** Prepare version/state/shape validation, independent unavailable/history rendering, source-re-read retry, hold observation and background-result handling across ShareView, tested with supplied future payloads. No active producer emits the new protocol or activates money authority, and no consumer begins rejecting all current unversioned traffic before coordinated activation. Preserve active arithmetic.
2. **M4b: context/freshness and inactive producer preparation.** Prepare a tested public-safe serializer over one projection, bind ready/loading/error notice context to owner/year/status, reuse the board helper across runtimes, thread complete inputs through every listed mint/rebuild/issuance snapshot, and prepare targeted invalidation. Production money remains legacy/unversioned until M4c. The concrete snapshot/fencing/failure design below must be reviewable before certifying M4b or M4c as M; split further at inactive seams if needed. Any proposal to activate nonfinancial invalidation earlier must state its timing change explicitly for approval.
3. **M4c: coordinated activation.** After predecessors merge and main checks pass, activate both writers, all creation/rebuild callers, the cache/Function consumer gate and all required invalidations together. Real source/handler/cache/client regressions exercise the prepared seams. No compatible version on legacy math at any head, no file-by-file writer activation or partial financial release. #636 remains open until complete source acceptance is evidenced.

### Targeted invalidation and consistency gate before code

Decision B requires not-received report, resolution, disposition cancellation and year close to invalidate or rewrite affected household `publicShares` entries so **the next resolve goes live**, including reports while held. Scope by owner/year and affected household token members, not only the notice's one token; preserve unrelated households/years, counters, expiry and revocation. Existing one-hour cache/background timing otherwise remains unchanged; no year-document Admin writes or authorization/rules redesign is inferred.

A stale marker with no money write is an engineering proposal allowed by B, preferred for preserving the existing cache metrics; deletion is also allowed, but naive deletion loses cache-hit counts because the Function seeds from older token counters. Marker fallback likewise must preserve cached counts and count the visit once; existing cache-miss behavior is not sufficient. The mechanism is **not settled**. The audit found the Cancel Refund UI records a notice resolution, with no current source `creditAdjustments[].status='cancelled'` mutation writer; preserve the existing eligibility rule and cover actual source transitions without inventing a cancellation feature.

A year-update observer could cover stored disposition cancellation and close without writing the year, but asynchronous observation alone does not guarantee next-resolve behavior. Sequential source-write/mark operations can fail between writes; token enumeration, newly minted caches, separately read year/notice context and in-flight self-heal/rebuild writers can race or overwrite a marker with an older snapshot. Before source work, specify source/context snapshot binding, invalidation failure handling, ordering/fencing of concurrent writers, all transition coverage and counter preservation, with real race fixtures. If the existing allowed seams cannot meet B without new metadata, auth/rules changes, broader orchestration or weakening its next-resolve requirement, surface that concrete conflict for owner decision. Do not silently select an observer, epoch or consistency compromise. New shared Functions files, if proposed, also need explicit artifact admission; #638 does not automatically admit them.

**Acceptance/validation:** client-created cache, Function response and self-healed cache agree on every scoped monetary field and allocated row for the same snapshot; allocation precedes stripping private keys. Remove stale optional monetary keys during merge/self-healing and scope removal. Preserve household/member grain, reversed-payment history omission and historical notice amounts/actions. Use ADR 0010's shared A/B/C matrix through actual handler/cache/consumer paths: floor-before-B, net paid with P history, carry-forward/signed R, reversal, active/resolved/cancelled/mixed refunds, open/closed/archived status, held→retry→held→corrected, incompatible/malformed cache/Function, repeated late-old-cache rejection, background hold, held report persistence and Review reply, absence of all payment/QR/Question This/progress/status/pending money while held. Add context-switch, invalidation failure, late writer, multi-token household/sibling/year isolation and metrics/expiry tests. Passing helper parity alone is insufficient; these are future obligations, not passing evidence.

**Gates:** each proposed scope needs fresh reviewability before starting, exact-head human financial review and normal review/CI; no source implementation is authorized at this checkpoint. #462 stays open pending acceptance at a real head, with no new completion dependency; #564's future voided-refund record remains out of scope and whichever-lands-second parity remains. #617 stays open/non-blocking, U carry-only; #614/#615/#616 unchanged. No deploy or live read/report. Complete-set review and later separately authorized Functions-first/Hosting-second release, including the old-client interval, remain mandatory.

## M5: offline flip-report tool and complete-set release evidence (after M4)

**Inputs:** current/replacement projection revisions and the complete reviewed dependency set.

**Outputs:** a deterministic comparison tool proven on local fixtures and a release checklist that consumes its counts. Implementing this tool authorizes **no live access**. Prepare a read-only entrypoint with no mutation APIs. Separately the owner runs it or authorizes a report over **live billing years** before Hosting: union count of households whose settlement state or displayed owed changes; both individual counts and overlap; inspected years/households, integrity holds/unassessable households including a count of households held for non-conforming money fields by component with record ids, snapshot time and both compared revisions. Keep raw personal data out of public artifacts.

**Acceptance:** known fixtures produce the expected flip/owed counts and non-conforming-field household-hold counts by component with record ids, overlap is not double-counted, invalid/unassessable households (including inherited-target allocation infeasibility) are visible and cannot masquerade as unchanged. Record all series heads and reviews, dependency-set verification, actual old/new-client compatibility behavior and release outcomes. Size rationale: one offline read-only comparison/report boundary and release evidence; no money policy changes, migrations or deploy-auth changes. Gate: exact-head human financial review of the tool and normal checks; separate owner authorization is required to run against live years. This plan/contract has not authorized or run that report.

## Release checkpoint: no partial financial release

1. Read back the final reviewed/merged dependency set and SHAs; verify no intermediate money artifact was deployed. Unused primitives may merge alone. Existing versioned-year-write staging and #614/#616 owner acknowledgments remain independent prerequisites; this series bypasses none of them.
2. Obtain the owner's execution or separate authorization for the read-only live report above. Review its counts and integrity holds before approving Hosting. No ledger normalization, backfill or financial-data write is permitted. Resolve material holds before release review rather than silently excluding them.
3. Obtain exact-revision/target deployment authorization under DEPLOYMENT.md. Deploy the **complete reviewed** Functions projection and version response first; verify it from the approved artifact before Hosting. The two public writers/consumer come from the same reviewed subsystem change, not separate live partial releases. Test the pre-change client's real handling of that response/schema and caches during this interval. Pre-change tabs continue their old math and may write old caches until reload; the new client must never consume those incompatible amounts. This contract cannot force an already-open old build to adopt cent semantics. Record the numerical/UX interval and reload behavior honestly; if the observed public behavior cannot meet the reviewed release requirements, hold deployment and surface the concrete conflict to the owner, without inventing an unapproved dual projection or data migration.
4. After the report is reviewed and Functions verification recorded, separately authorize and deploy consuming Hosting from the reviewed complete-set revision. Verify compatible cache hits, live fallback, late old-cache writes, financial state/cap/close parity and update/reload behavior. Record both deployed revisions. Rollback must preserve money-version rejection and Function/client compatibility; use coordinated reviewed artifacts and never relabel an old projection as compatible.
5. #603 resumes only when its actual prerequisites/deployment gates clear. Rebase its carried-items work onto the shared projection and retain its separate exact-head financial review, tests and Functions-before-Hosting gates. Close #629 only when its implementation/release acceptance is evidenced; #617 stays open.

No migration, normalization, backfill, production financial write or live report is authorized by this plan. A merge or green CI does not substitute for a required owner checkpoint.
