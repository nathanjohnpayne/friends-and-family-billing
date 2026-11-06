# #629: exact household cents, serial implementation and release gates

[ADR 0010](../docs/adr/0010-household-cent-projection.md) is the approved contract. This documentation-only prerequisite performs no implementation, production read/write, deployment or migration. #629 retains its existing size-M documentation/prerequisite route, `openai=gpt-6.1-sol/high`; it remains open through its implementation/release gates, and this documentation PR uses `Refs #629`. #603 / draft #628 remains held, preserving its carried-items work.

The complete fix is larger than M; deliver six financial implementation PRs across the five subsystem stages below plus the artifact admission prerequisite [#638](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/638), for seven PRs in total, rather than relabeling the entire fix M. No conversion of #629 to an L tracker is required. File implementation issues with their own Inputs / Outputs / Acceptance criteria / Validation and the high-stakes routes `anthropic=opus-5.5/high openai=gpt-6.1-sol/high`. Use native serial dependencies M2a → M1, M2b → M2a, M3 → M2b, M4 → M3, M5 → M4; the final implementation/release gate blocks #629, and #629 blocks #603. Do **not** make implementation issues depend on #629 closing: their documentary prerequisite is the merged ADR/spec PR, so that would create a cycle. The final release evidence must cover every series PR, including #638.

The read-only financial callgraph inventory spans at least eleven methods across five integration files; that evidence does not certify the combined authority/adaptation/activation work as M. Stage 2 therefore has two PRs: an unused domain adapter and one coherent activation. Each proposed M scope below names its seam, exclusions and acceptance tests. Before claiming a child, enumerate its actual call sites against then-current main. If evidence makes a scope exceed M, record that evidence and split it at an unused/inactive seam before coding; no partially active financial release and no mechanical file-per-PR decomposition.

## Checkpoint 0: contract precedes code

Inputs: approved proposal and four owner conditions linked in ADR 0010. Output: reviewed ADR/spec amendment and this plan. Validate links, narrow supersession of the rounding freeze, both remainder rules, integer-cent invariants and separate live-report authorization. Gate: contract recorded before money code starts. Documentation approval does not approve any code head. Root handles GitHub issue/review writes; this phase changes only documentation.

## M1: unused generic exact arithmetic and allocator

**Inputs:** ADR 0010's generic exact-number, quantization and largest-remainder contracts.

**Outputs:** pure decimal/rational parser, exact arithmetic, quantizer and deterministic allocator, with one reviewed ESM/CommonJS delivery/parity seam (candidate `src/lib/money.js` / `functions/money.js` under existing directories). No source-domain eligibility, component construction or production caller integration yet.

**Acceptance:** parse source `Number.toString()` including exponent form; retain exact multiply/divide/sum; round signed half-cent ties away from zero; normalize zero. Allocate by ordinal immutable keys with exact floor/ceiling feasibility, one increment per eligible row and zero-row preservation; expose an integrity hold rather than an alternative algorithm. Stored `splitCents` is not replaced.

**Validation:** generic exact-number vectors and allocator tests: signed ties, exponent notation, permutation/tie stability, signed mixed rows, endpoint feasibility and impossible inherited targets. Size rationale: one unused generic pure interface and its tests; excludes source-domain adapters, services, persistence, public response and UI integration. Gate: explicit human financial review of this PR's exact head, normal review/CI. May merge unused; no deploy.

## M2a: unused source-domain and candidate-ledger adapter (after M1)

**Inputs:** M1 primitives, ADR 0010 and existing bill/ledger/seed source shapes and eligibility predicates.

**Outputs:** an unused pure domain adapter for exact source extraction, six-component/`U` authority results, proposed post-mutation ledger projection and carry snapshots. Reconstruct `G` from bill source fields, never a floating-point summary. Include current eligibility/cancellation/reopened-refund distinctions, exact reversal pairing and seed → item → non-additive detail allocation with canonical-cent integrity checks, valid legacy/no-sourceId detail handling and inherited-target holds. Keep dollar compatibility at explicit adapter edges. No existing financial gate or renderer calls it yet.

**Acceptance:** candidate-ledger projection supports existing refund-cap decisions without inventing a payment amount cap; preserve positive payment validation and overpayment eligibility. Carry snapshots conserve assigned cents without modifying existing records. Private allocation keys remain internal; public-safe stripping is a later consumer concern. Existing `calculateAnnualSummary` raw audit/member displays and stored `splitCents` remain available.

**Validation:** the complete ADR 0010 source/six-component fixture matrix, candidate aggregate cap boundary tests, reversal cancellation, carry chains and hierarchy properties, legacy binary residue and infeasible-target integrity holds, plus client/Functions domain vectors. Size rationale: one unused source-domain adapter tested independently of orchestration, financial decision activation and UI/public integration. Gate: exact-head human financial review and normal review/CI. May merge unused; no deploy.

## Artifact admission prerequisite: #638 (after M2a, before M4)

[#638](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/638) depends on M2a (#633), when the required Functions source modules are known, and blocks M4 (#636) alongside its M3 prerequisite (#635). M1 and M2a prove source interoperability only: their new modules are not in the current deployment artifact allowlists.

This separate PR registers the complete required module set in both the artifact producer and verified consumer. Validate that the artifact contains every required Functions module, that admission remains closed to unexpected files, and that security checks and compatibility with retained artifacts are preserved. Normal review/CI and explicit human review remain required. This prerequisite authorizes no deployment and does not permit a partial financial release; M1 does not change artifact or security tooling.

## M2b: coherent activation of existing financial gates (after M2a)

**Inputs:** tested unused adapter and the verified financial callgraph.

**Outputs:** wire `calculations.js:getHouseholdFinancials`, `calculateSettlementMetrics`, `buildCarryForward`; `billing-year.js:calculateOutstandingBalance`, `buildCarryForwardSummary`, `buildCarryOpeningItems`, `applyCarryForwardToPriorYear`, `buildNewYearData`; `BillingYearService.js:issueRefund` and the existing `createYear` orchestration seam; `SettlementBoard.jsx`'s HouseholdCard payment/refund action availability and `handleIssueRefund` cap; and `year-end-review.js` preview to the same cent authority. UI decision handlers belong in this activation PR despite their file location; pure display work stays in M3.

**Acceptance:** activate settlement, existing refund caps, payment-button availability, close and carry together; remove financial epsilon comparisons at every listed seam. `recordPayment` and `SettlementBoard.handleRecordPayment` keep their existing positive-amount validation and **no amount ceiling**: overpayment remains allowed. HouseholdCard's existing payment availability gate (`balance > CREDIT_EPSILON`) becomes a cent decision, not a new request ceiling. Both refund-cap layers (`issueRefund` and HouseholdCard's `handleIssueRefund`) validate against recomputed candidate-ledger components, never independently quantized request amounts. Preserve floor, `B`, eligibility, caller reopened-refund distinctions, append-only ledgers, stored `splitCents`, per-record credit netting, carry-only `U` and existing transaction/version orchestration. Inventory every remaining `CREDIT_EPSILON` caller and prove it cannot feed a projected financial outcome, or remove it.

**Validation:** wiring regressions across calculations, service/refund handlers, billing-year, review and HouseholdCard decisions: one-cent availability/refund caps, fractional aggregate crossings, permitted overpayment, #620, cancellation/reopening, carry/zero-net seeds, closed-year assertions, integrity holds and ledger immutability. Size rationale: source interpretation and carry-snapshot construction already landed unused in M2a, so this PR activates existing decisions through that adapter; excludes pure display/invoice, public protocol, credentials and deployment. The eleven-method/five-file inventory is a minimum, not automatic M certification: confirm the wiring diff fits M before starting; surface any remaining indivisible scope conflict instead of partially activating gates. Gate: exact-head human financial review and normal review/CI. No deploy.

## M3: authenticated financial display and invoice consumers (after M2b)

**Inputs:** authoritative cent components and allocated rows; existing UI/invoice scope.

**Outputs:** bounded adapters in SettlementBoard, payment/refund/history dialogs, Dashboard/YearEndReview preview and `invoice.js`/invoice renderers consume the same projected values. Keep independently rounded member bill lines (#620) and raw audit inspection; no redesigned flows or unrelated copy changes. Payment/refund availability and refund-cap handlers already activated in M2b are decision logic, outside this display-only adaptation.

**Acceptance:** household lines and declared additive rows reconcile without independent re-rounding; retain ordinary bill-invoice scope and the separate Charge Notice path. Raw values remain available for audit; stored data is unchanged. Usage Charge visibility, confirmation and refund eligibility remain as before.

**Validation:** targeted component/invoice tests for all changed money states plus desktop/phone visual evidence where visible states change. Size rationale: display adaptation to one already-tested authority, without new financial formulas, public writers or persistence changes. Gate: exact-head human financial review and normal review/CI; no deploy before the complete set.

## M4: both public writers and money-version consumer (after M3 and #638)

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
