# #629: exact household cents, serial implementation and release gates

[ADR 0010](../docs/adr/0010-household-cent-projection.md) is the approved contract. This documentation-only prerequisite performs no implementation, production read/write, deployment or migration. #629 retains its existing size-M documentation/prerequisite route, `openai=gpt-6.1-sol/high`; it remains open through its implementation/release gates, and this documentation PR uses `Refs #629`. #603 / draft #628 remains held, preserving its carried-items work.

The complete fix is larger than M; deliver the five bounded subsystem PRs below, rather than relabeling the entire fix M. No conversion of #629 to an L tracker is required. File implementation issues with their own Inputs / Outputs / Acceptance criteria / Validation and the high-stakes routes `anthropic=opus-5.5/high openai=gpt-6.1-sol/high`. Use native serial dependencies M2 → M1, M3 → M2, M4 → M3, M5 → M4; the final implementation/release gate blocks #629, and #629 blocks #603. Do **not** make implementation issues depend on #629 closing: their documentary prerequisite is the merged ADR/spec PR, so that would create a cycle. The final release evidence must cover every series PR.

Each proposed M scope below is one coherent behavior seam with named exclusions and acceptance tests. Before claiming a child, enumerate its actual call sites against then-current main. If evidence makes a scope exceed M, record that evidence and split it at an unused/inactive seam before coding; no partially active financial release and no mechanical file-per-PR decomposition.

## Checkpoint 0: contract precedes code

Inputs: approved proposal and four owner conditions linked in ADR 0010. Output: reviewed ADR/spec amendment and this plan. Validate links, narrow supersession of the rounding freeze, both remainder rules, integer-cent invariants and separate live-report authorization. Gate: contract recorded before money code starts. Documentation approval does not approve any code head. Root handles GitHub issue/review writes; this phase changes only documentation.

## M1: unused exact component projection and allocation

**Inputs:** ADR 0010; bill/ledger/seed source shapes and current eligibility predicates.

**Outputs:** pure exact decimal/rational parser, quantizer, six-component/`U` projection and deterministic row allocator, with one reviewed ESM/CommonJS delivery/parity seam (candidate `src/lib/money.js` / `functions/money.js` under existing directories). No production caller imports the new primitive yet.

**Acceptance:** parse source `Number.toString()` including exponent form; retain exact annualization/division/sums; round signed half-cent ties away from zero; normalize zero; reconstruct `G` from source bill fields rather than floating-point summary totals. Allocate with ordinal record ids/group identity, exact reversal pairing, seed → item → non-additive detail hierarchy and valid legacy/no-sourceId detail handling; holds expose inconsistent provenance without changing data. Allocation precedes public-safe stripping; private keys never enter member payloads. Stored `splitCents` is not replaced.

**Validation:** focused pure tests implementing ADR 0010's complete component/allocation matrix; permutation/property tests, signed mixed rows, original/reversal cancellation, canonical-cent integrity checks (including valid legacy binary residue), exact inherited-target floor/ceiling feasibility, zero-row preservation and explicit infeasible-hierarchy holds, plus client/Functions vectors. Size rationale: one unused pure interface and its contract tests; no services, persistence, public response or UI integration. Gate: explicit human financial review of this PR's exact head, normal review/CI. May merge unused; no deploy.

## M2: coherent financial authority, caps and rollover (after M1)

**Inputs:** merged contract and tested pure primitive; current helper/caller graph.

**Outputs:** wire `calculations.js:getHouseholdFinancials`, `calculateSettlementMetrics`, `buildCarryForward`; `BillingYearService.js` payment/refund cap consumers; and `billing-year.js:calculateOutstandingBalance`, `buildCarryForwardSummary`, `applyCarryForwardToPriorYear`, `buildNewYearData`, plus `year-end-review.js` preview consumers to the same cent authority. Keep dollar-return compatibility only at API/display boundaries and explicit integer-cent authority internally. Existing `calculateAnnualSummary` remains available for raw audit/independent member displays, but its float subtotal is not exact `G`.

**Acceptance:** activate settlement, cap, close and carry boundaries together; remove financial epsilon comparisons at every listed seam. Preserve bill floor, `B`, eligibility, caller reopened-refund distinctions, append-only ledgers, stored `splitCents`, per-record credit netting, carry-only `U` and transaction/version gates. Validate caps against recomputed candidate-ledger components, never independently quantized request amounts; cover existing fractional R/payment records crossing a cent boundary. New carry snapshots conserve assigned cents; existing stored records remain untouched. Inventory every remaining `CREDIT_EPSILON` caller and prove it cannot feed a projected financial outcome, or remove it.

**Validation:** calculations, service/payment/refund, billing-year and review suites with one-cent settlement/caps, #620, cancellation/reopening, carry chains, zero-net seeds, closed-year assertions, integrity holds and ledger immutability. Size rationale: replaces the authority and its direct decision consumers; excludes renderers, invoice/public serialization, cache protocol, credential access and deployment. If the actual caller inventory exceeds M, split only by first adding an unused adapter behind the existing authority, then activate **all** direct decisions in one bounded successor; do not merge an actively mixed epsilon/cent gate as a releasable state. Gate: exact-head human financial review and normal review/CI. No deploy.

## M3: authenticated financial display and invoice consumers (after M2)

**Inputs:** authoritative cent components and allocated rows; existing UI/invoice scope.

**Outputs:** bounded adapters in SettlementBoard, payment/refund/history dialogs, Dashboard/YearEndReview preview and `invoice.js`/invoice renderers consume the same projected values. Keep independently rounded member bill lines (#620) and raw audit inspection; no redesigned flows or unrelated copy changes.

**Acceptance:** household lines and declared additive rows reconcile without independent re-rounding; retain ordinary bill-invoice scope and the separate Charge Notice path. Raw values remain available for audit; stored data is unchanged. Usage Charge visibility, confirmation and refund eligibility remain as before.

**Validation:** targeted component/invoice tests for all changed money states plus desktop/phone visual evidence where visible states change. Size rationale: display adaptation to one already-tested authority, without new financial formulas, public writers or persistence changes. Gate: exact-head human financial review and normal review/CI; no deploy before the complete set.

## M4: both public writers and money-version consumer (after M3)

**Inputs:** canonical components/allocations and M3 invoice scope.

**Outputs:** update `share.js` and its ShareLinkService/ShareLink/Email/Text/Invoicing generation callers **together with** `functions/billing.js`, `functions/index.js:resolveShareToken` and ShareView's actual response/cache gate. Both writers emit one shared money-projection version; cache and Function responses are checked before money renders. No writer may keep a compatible marker while replacing money with legacy semantics. Payment-method/access-count-only updates keep their existing behavior.

**Acceptance:** client-created cache, Function response and self-healed cache agree on every scoped monetary field, group/row allocation and absence/removal of optional fields. Allocation precedes removal of internal ids/provenance. Keep existing scopes/privacy, expiry/revocation and counters, household/member grain, reversed-payment history omission and no year-document Admin writes. Missing/old/unknown version resolves live before displaying amounts; incompatible Function results fail recoverably. Test a pre-change tab replacing an old cache **after** Function self-healing and repeat rejection; cover replacement/merge semantics, not just helper parity. The money version is separate from year `rev` and draft versioning.

**Validation:** actual handler/cache response tests in `tests/functions.test.js`, share-builder/generation tests and ShareView cache-hit/miss/late-writer tests; run shared discriminating vectors plus public privacy and invoice regressions. Size rationale: one public projection/compatibility subsystem, both writers and its reader reviewed as a unit; no new authenticated authority, token policy or Firestore rule redesign. Gate: exact-head human financial review plus full applicable regression/CI for the complete financial dependency set. No deploy yet.

## M5: offline flip-report tool and complete-set release evidence (after M4)

**Inputs:** current/replacement projection revisions and the complete reviewed dependency set.

**Outputs:** a deterministic comparison tool proven on local fixtures and a release checklist that consumes its counts. Implementing this tool authorizes **no live access**. Prepare a read-only entrypoint with no mutation APIs. Separately the owner runs it or authorizes a report over **live billing years** before Hosting: union count of households whose settlement state or displayed owed changes; both individual counts and overlap; inspected years/households, integrity holds/unassessable households, snapshot time and both compared revisions. Keep raw personal data out of public artifacts.

**Acceptance:** known fixtures produce the expected flip/owed counts, overlap is not double-counted, invalid/unassessable households (including inherited-target allocation infeasibility) are visible and cannot masquerade as unchanged. Record all series heads and reviews, dependency-set verification, actual old/new-client compatibility behavior and release outcomes. Size rationale: one offline read-only comparison/report boundary and release evidence; no money policy changes, migrations or deploy-auth changes. Gate: exact-head human financial review of the tool and normal checks; separate owner authorization is required to run against live years. This plan/contract has not authorized or run that report.

## Release checkpoint: no partial financial release

1. Read back the final reviewed/merged dependency set and SHAs; verify no intermediate money artifact was deployed. Unused primitives may merge alone. Existing versioned-year-write staging and #614/#616 owner acknowledgments remain independent prerequisites; this series bypasses none of them.
2. Obtain the owner's execution or separate authorization for the read-only live report above. Review its counts and integrity holds before approving Hosting. No ledger normalization, backfill or financial-data write is permitted. Resolve material holds before release review rather than silently excluding them.
3. Obtain exact-revision/target deployment authorization under DEPLOYMENT.md. Deploy the **complete reviewed** Functions projection and version response first; verify it from the approved artifact before Hosting. The two public writers/consumer come from the same reviewed subsystem change, not separate live partial releases. Test the pre-change client's real handling of that response/schema and caches during this interval. Pre-change tabs continue their old math and may write old caches until reload; the new client must never consume those incompatible amounts. This contract cannot force an already-open old build to adopt cent semantics. Record the numerical/UX interval and reload behavior honestly; if the observed public behavior cannot meet the reviewed release requirements, hold deployment and surface the concrete conflict to the owner, without inventing an unapproved dual projection or data migration.
4. After the report is reviewed and Functions verification recorded, separately authorize and deploy consuming Hosting from the reviewed complete-set revision. Verify compatible cache hits, live fallback, late old-cache writes, financial state/cap/close parity and update/reload behavior. Record both deployed revisions. Rollback must preserve money-version rejection and Function/client compatibility; use coordinated reviewed artifacts and never relabel an old projection as compatible.
5. #603 resumes only when its actual prerequisites/deployment gates clear. Rebase its carried-items work onto the shared projection and retain its separate exact-head financial review, tests and Functions-before-Hosting gates. Close #629 only when its implementation/release acceptance is evidenced; #617 stays open.

No migration, normalization, backfill, production financial write or live report is authorized by this plan. A merge or green CI does not substitute for a required owner checkpoint.
