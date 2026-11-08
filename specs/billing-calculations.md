---
spec_id: billing-calculations
---

# Billing Calculations

Covers all pure calculation logic for annual billing summaries, payment totals, member linkage, settlement metrics, and billing year lifecycle helpers.

## Test Coverage

- `tests/react/lib/calculations.test.js`
- `tests/react/lib/billing-year.test.js`
- `tests/react/lib/BillingYearService.test.js`
- `tests/react/lib/BillingYearService.mutations.test.js`

## Acceptance Criteria

### Annual and Monthly Amount Conversion

- `getBillAnnualAmount` returns the amount directly for annual bills, multiplies monthly bills by 12, and defaults to monthly when no frequency is specified.
- `getBillMonthlyAmount` divides annual bills by 12 and returns the amount directly for monthly bills.

### Annual Summary Calculation

- `calculateAnnualSummary` creates summary entries for every member, splitting bill costs evenly among assigned members.
- Full cost is assigned when only one member is on a bill.
- Bills with an empty members array are skipped and do not affect totals.

### Payment Totals

- `getPaymentTotalForMember` sums all payments for a specified member and returns 0 when no payments exist.
- `getMemberPayments` filters and sorts payments for a member in newest-first order; returns an empty array for unknown members.

### Linked Member Resolution

- `isLinkedToAnyone` returns true if any other member's `linkedMembers` array references the given member.
- `getParentMember` returns the parent member object for a linked child, or undefined for unlinked members.

### Settlement Metrics

- `calculateSettlementMetrics` computes total annual cost, total payments received, total outstanding balance, total credits owed to members, total member count, percentage settled (capped at 100), and count of fully paid members. It accepts an optional `creditAdjustments` array (defaulting to empty) so a three-argument call remains backward-compatible, and an optional trailing `reopenedAdjustmentIds` set (#319, ADR 0003) that re-opens not-received refunds into `totalCreditsOwed` without touching `totalOutstanding`.
- Linked members are combined under their parent for household-level settlement tracking; the total member count reflects households not individuals.
- `totalCreditsOwed` sums unresolved household credit cents separately from `totalOutstanding`. A valid household with balance cents ≤ 0 counts in `paidCount`, including a household in credit or one on no bills with zero balance. A positive cent balance remains unpaid even if owed is zero; held households never count as paid.
- `totalOutstanding` sums positive household balance cents (`max(0, owed − N)`), so one household’s overpayment never masks another’s debt. `percentage` uses the exact satisfied/annual cent ratio, rounded to the nearest whole percent with positive ties upward and clamped to 0–100 (zero annual owed returns 0). `totalPayments` remains gross projected `P`; returned money is not counted as settlement progress.

### Household Net Contribution and Credit

Authenticated household settlement uses the ADR 0010 cent authority. Legacy raw member/audit and ordinary invoice/public helpers remain separate pending their M3/M4 adaptation; they do not decide settlement, caps, close or carry.

- Household components use ADR 0010 exact decimal source arithmetic and one half-away-from-zero quantization per component. Settlement, credit, caps, close and carry compare integer cents with no epsilon: a positive balance cent is outstanding, zero balance is settled, and negative balance is credit.
- `getCreditAdjustmentTotalForMember` sums a member's active refunds and carried-forward credits (records whose `status` is not `cancelled`), and returns 0 for an unknown member or an empty/missing array. These adjustments subtract from gross payments. It accepts an optional `reopenedAdjustmentIds` set (defaulting to none) and excludes any adjustment whose `id` is in it, so a two-argument call is unchanged.
- `getHouseholdFinancials(member, source, { reopenedAdjustmentIds })` requires the complete raw `familyMembers`, `bills`, `payments`, `creditAdjustments` and `owedAdjustments` arrays. It projects household components `G`, `S`, `O`, `P`, `R`, `B` before composing `N = P − R`, `owed = max(0, G − S + O) + B`, `balance = owed − N` and `credit = max(0, −balance)`. Success returns `{ ok: true, householdId, cents, ...checkedDollarAliases }`; an integrity hold returns `{ ok: false, householdId, holds }` without money. Source data is never reconstructed from raw member display summaries. A held household does not invalidate a valid sibling.
- **Invariant:** in valid states a household's recorded dispositions (refunds + carry-forwards) are capped at its credit (enforced at the mutation/import boundary by later slices), so `netContribution >= owed` and a settled household never reads as underpaid. Every settlement surface — status, the collectable balance, the Record-Payment gate, and outstanding totals — derives from `netContribution`, so an over-disposition degrades to an honest collectable shortfall rather than splitting status from balance.

### Re-opening a Credit on Not-Received (#319, ADR 0003)

- Recording a refund (#318) optimistically clears the household credit. ADR 0003's one member-protection concession is that an **active, unresolved `not_received`** report **re-opens** that refund's credit **while the year is open**: the disposition stops counting, Net Contribution rises back, and the credit is owed again until the administrator resolves it (re-send / cancel / dismiss).
- The re-open is expressed as a set of `creditAdjustmentId`s (built from refund notices by `reopenedCreditAdjustmentIds`, billing-sharing spec) and passed to the household source projection and `calculateSettlementMetrics`. Its eligible `R` excludes those dispositions under the caller context, preserving the existing cancellation/reopening rules. Legacy per-member audit/display helpers retain their own optional reopening parameter.
- **`totalOutstanding` is never affected by a re-open.** Excluding a refund only raises Net Contribution, which can only shrink a shortfall; a re-opened credit is overpayment owed back, never underpayment, so settlement progress is never inflated by an unconfirmed refund.
- **Closed years are corrected forward (ADR 0007):** read-only years pass no re-open set, so a `not_received` arriving after close never reanimates a frozen ledger. The re-open is a derived display calculation only — the persisted `creditAdjustment` and the append-only ledger are never mutated.

### Deferred Usage Charges (#317, ADR 0005)

A Usage Charge is a `+owed` per-member ad-hoc debit stored in `owedAdjustments[]` (`kind: 'usage_charge'`). A **deferred** charge is recorded and visible but NOT yet billed, so these helpers surface a running "pending" figure that deliberately does **not** feed `owed`, `credit`, the settlement gate, or `calculateSettlementMetrics`.

- `getDeferredUsageChargeTotalForMember` sums a member's deferred usage charges only (records with `kind: 'usage_charge'` and `status: 'deferred'`), and returns 0 for an unknown member or an empty/missing array. Voided and already-billed charges, and credit-direction adjustments (Service Credits, #321), are excluded.
- `getHouseholdDeferredCharges` returns `{ count, total }` for a household (primary member plus their linked members, ADR 0001 grain), counting and summing only deferred usage charges. Another household's charges are not counted.
- A **True-up** (ADR 0009, `specs/year-end-review.md`) is the bill-level Usage Charge: `kind: 'usage_charge'` with `basis: 'price_change' | 'late_start'`, split among the bill's members, one record per member sharing a `trueUpId`. A record without `basis` is a `'member'` charge. Every helper in this section keys on `kind` and `status` only, so True-ups are ignored by owed while deferred, counted by `getHouseholdDeferredCharges`, carried by `buildCarryForward`, and billable by `billDeferredCharges`; `src/lib/calculations.js` needs no change for them.
- Valid deferred Usage Charges do not change current household `owed`, `netContribution`, `credit` or settlement amounts. The complete raw source still includes them for source-integrity validation and exact carry projection; malformed admitted deferred money holds its household. Active Service Credits and billed Usage Charges retain their separate current-owed effects.

### Service Credits (#321, ADR 0005)

A Service Credit is the `−owed` mirror of a Usage Charge: a bill-level reduction (a service cancelled, reduced, discounted, or with an issue) stored in `owedAdjustments[]` (`kind: 'service_credit'`, `status: 'active'`) with the amount as a positive magnitude. Unlike a deferred Usage Charge it takes effect immediately — it **lowers** the affected members' `owed`, and when a member has already paid the surplus surfaces as a household **Credit** on the existing refund/carry axis (no new disposition path). The bill's own `amount` and history are unchanged (Option B).

- `getServiceCreditTotalForMember` sums a member's active service credits (records with `kind: 'service_credit'` and `status: 'active'`) as a positive magnitude, and returns 0 for an unknown member or an empty/missing array. Voided credits (append-only void via status) and the `+owed` Usage Charge direction are excluded.
- `getHouseholdFinancials` projects the active Service Credit component `S` from raw `source.owedAdjustments`, subtracts it inside `max(0, G − S + O)`, and exposes the checked `serviceCreditTotal` alias. An already-paid household can gain payment-backed credit as owed falls; excess Service Credit alone creates no money. The complete-source API replaces the earlier positional summary signature.
- `calculateSettlementMetrics` accepts the same optional trailing `owedAdjustments` argument and threads it through `getHouseholdFinancials`, so `totalAnnual` reflects owed **after** bill-level reductions and a fully-paid household whose owed dropped below its Net Contribution surfaces its surplus in `totalCreditsOwed`. A partially-paid household's outstanding shortfall shrinks by the credit. Backward-compatible: a four-argument call is unchanged.

### Billed Usage Charges (Charge Notice, #320, ADR 0005, ADR 0006)

Off-cycle-billing a member's deferred Usage Charges via a **Charge Notice** flips the
selected `owedAdjustments[]` records from `status: 'deferred'` to `status: 'billed'`. A
**billed** charge is present-tense money: it raises the household's `owed`, so unpaid →
Outstanding → blocks close (ADR 0006). A still-`deferred` charge does not.

- `getBilledUsageChargeTotalForMember` sums a member's usage charges whose `status` is `billed` (excluding deferred and voided), returning 0 for an unknown member or an empty/missing array.
- `getHouseholdFinancials` projects billed Usage Charges as component `B` from raw `source.owedAdjustments` and adds it **after** the invoice floor: `owed = max(0, G − S + O) + B`. The checked dollar alias is `billedChargeTotal`. Deferred charges do not enter `B` or current owed.
- `calculateSettlementMetrics` threads the same array through. An unpaid billed charge raises `totalAnnual` and `totalOutstanding` and drops the household from `paidCount` (so it blocks close); paying it through the normal `payments[]` ledger settles the household again. Deferred charges do not affect any metric.

### Carry-Forward Seam (#322, ADR 0005, ADR 0006, ADR 0007)

The single shared carry-forward seam (ADR 0005) rolls a closing year's **undisposed** items into next year (ADR 0006): undisposed household Credits and still-`deferred` Usage Charges. It is netted to one per-household **opening balance** (credits negative, charges positive) that the new year is seeded with, so the carried balance appears in the new year's annual total and first invoice. This is the integrative slice; the new-year construction and settlement math are high-risk and changes are additive and backward-compatible.

- `getHouseholdFinancials(member, source, options)` derives opening component `O` from the household’s eligible raw `carry_opening` seeds in `source.owedAdjustments`; it accepts no independently supplied opening-balance total. The cent formula remains `max(0, G − S + O) + B`: carried credit lowers the invoice under the floor, carried charges raise it, and billed charges are added afterward. Opening seeds are a distinct kind, so they do not enter `S`, `B` or deferred charges.
- `getHouseholdOpeningBalance` sums a household's `carry_opening` seed records (records in `owedAdjustments[]` with `kind: 'carry_opening'`, summed across the primary and linked members at the ADR 0001 grain), and returns 0 for an unknown household or an empty/missing array. Voided seeds and deferred Usage Charges are excluded (a deferred charge is pending, never an opening balance).
- `buildCarryForward(familyMembers, bills, payments, creditAdjustments, owedAdjustments, options)` finalizes one whole-year plan from the raw source and actual caller-selected disposition ids before validation. Success includes per-carrying-household checked aliases/ids, aggregate opening balance/count, detached `priorYear` arrays and next-year `seeds`; holds publish no writable plan or aggregate money. Carry credit is payment-backed credit under null reopening, already net of dispositions. A positive credit, deferred-charge aggregate, or enabled review-only `U` feed qualifies a household; thresholds compare projected cents to zero. No rounding tolerance admits a household with no qualifying feed.
- **#319 reconciliation (integrated).** `buildCarryForward` accepts an optional `options.reopenedAdjustmentIds` set (default empty), built from the refund notices by `reopenedCreditAdjustmentIds` (#319). Per ADR 0003/0006, an active `not_received` re-opens a credit that is owed back **this** year and must **not** be carried; the seam therefore treats a re-opened recorded refund as still-effective for the carry (its amount stays subtracted from the carryable credit) and excludes the re-opened record id from `creditAdjustmentIds` (it is not re-disposed by the carry). Only genuine residual surplus rolls forward. The set is threaded into `createYear` via `options.reopenedAdjustmentIds` (the `BillingYearSelector` supplies it from `useRefundNotices`); when empty, behavior is unchanged.
- **Itemized carry (ADR 0009).** The finalized plan constructs the seed/items/detail once; `buildCarryOpeningItems` clones its validated items rather than recomputing money or ids. Signed item cents sum exactly to seed cents, and non-additive credit detail cents sum exactly to the credit-item cents. The seed equals deferred cents minus payment-backed credit cents minus enabled unused incoming credit `U = max(0, incomingCredit − max(0, G − S + incomingCharge))`, all in projected cents. `U` is carry-only and receives no source-year disposition. Applying the validated plan preserves each source household’s zero or existing shortfall and clears its undisposed payment-backed credit under null reopening. A qualifying zero-net household retains its source markings; itemized review seeds preserve offsetting items at zero cents, while legacy non-itemized seeds omit an exact zero net amount. Valid legacy opaque seeds remain supported.
- `calculateSettlementMetrics` retains its optional sixth `owedAdjustments` argument after the fifth reopening context, constructs the complete raw source, and aggregates household cents. It never reconstructs `O` or other components from member summaries. Held households are excluded from `paidCount`; structural counts remain available while incomplete or unsafe aggregates withhold money/percentage. Aggregate overflow adds no phantom held household and does not block valid household actions.

### Outstanding Balance and Year Close

- `calculateOutstandingBalance` returns the checked dollar alias of the sum of positive household balance cents under the service’s null reopening context. Its raw source includes billed charges, Service Credits and opening seeds under the same cent formula as settlement metrics; valid deferred charges and undisposed credits are not present-tense debt. A household or aggregate integrity hold refuses the calculation and year operations instead of returning a partial total or zero.
- `buildCarryForwardSummary` (in `billing-year.js`) is the lifecycle entry point to the finalized plan. Options bind source/destination labels, actual `creditDispositionIds`, reopening context and optional review items/`U` before validation. Downstream apply/seed helpers consume that plan without generating replacement ids or recomputing amounts.
- `buildCloseYearMessage` includes the outstanding dollar amount when positive. With a supplied carry affecting households and an exact nonzero net opening-cent amount, it states the magnitude/direction and household count; an exact zero net amount omits that carry sentence. There is no epsilon threshold.
- `applyCarryForwardToPriorYear` (in `billing-year.js`) marks a closing year's undisposed items carried-forward **append-only**: it returns fresh arrays where each carrying household gains one `creditAdjustments[]` record of `type: 'carry_forward'` (`status: 'recorded'`, stamped `toYear`) for its carried credit — disposing it on the old year exactly like a refund — and each still-`deferred` Usage Charge that carried has its `status` transitioned `deferred` → `carried_forward` in place (stamped `carriedForwardTo`), preserved and never deleted. It does not mutate the inputs.

### Year Label Management

- `suggestNextYearLabel` increments a numeric year label by one, or falls back to the current calendar year for non-numeric or null labels.
- `isYearLabelDuplicate` returns true for existing labels (trimming whitespace) and false for new labels.

### New Year Data Construction

- `buildNewYearData` resets `paymentReceived` to 0 for all members, preserves bill structure, starts with empty payments and billing events arrays, sets status to open, and deep-clones linked members to prevent reference sharing. It also initializes empty `creditAdjustments` and `owedAdjustments` arrays (parity with `buildSavePayload`/`buildInitialYearData`, so a freshly-created year never omits them from the shared document).
- **Carry-forward seeding (#322).** `buildNewYearData` accepts a finalized `carry` plan plus its `fromYearLabel` and verifies both source/destination labels. It copies the plan’s validated `carry_opening` seeds into next-year `owedAdjustments`, preserving signed opening amounts and append-only source markings from the same plan. Legacy non-itemized zero-cent seeds were omitted by the planner; itemized review zero-net seeds retain their explanatory items. No carry argument produces no seeds. The full-document save preserves stored seeds verbatim.
- **Itemized seeds and next-year bills (ADR 0009).** A plan finalized with `itemized: true` supplies seed `items[]`; non-itemized plans supply the legacy opaque shape. The upcoming reviewed rollover supplies `deriveNextYearBills(...)` (next-year prices, ended bills omitted, new subscriptions added); the ordinary legacy call continues cloning source bills. These paths use the same finalized-plan monetary/provenance contract.

### BillingYearService State Management

- The subscribe/unsubscribe pattern notifies listeners on state changes and creates a new state reference on each update.
- `setUser(null)` resets state to defaults (loading false, empty arrays, null activeYear).
- Setting a valid user with an existing `activeBillingYear` loads that year's data from Firestore.
- Brand-new users (no user doc) get a default year created with a legacy email template containing `%billing_year%` and `%annual_total%` tokens.
- Load failures set an error state.

### Year Creation and Switching

- `createYear` rejects duplicate year labels with an error, writes new year data to Firestore with a `createdAt` server timestamp, and no-ops without a user.
- **Carry-forward at rollover (#322, ADR 0005/0006/0007).** Before writing the new year, `createYear(yearId, options)` computes the prior (current) year's carry summary (`buildCarryForwardSummary`, passing `options.reopenedAdjustmentIds` so a credit re-opened by an active `not_received` is held back, #319/ADR 0003) and (1) seeds the new year doc with one `carry_opening` opening-balance record per carrying household (via `buildNewYearData`), and (2) when anything carried, marks the prior year **append-only** (`applyCarryForwardToPriorYear`: a `carry_forward` credit record per carried credit, plus an in-place `deferred` → `carried_forward` status transition on each carried Usage Charge, preserved not deleted), emits a `YEAR_CARRIED_FORWARD` event, and persists the prior-year doc. When nothing is undisposed there is no prior-year write and no seeds, so behavior matches the pre-#322 path. The carried balance is materialized lazily here: if no next year ever existed the credit stayed live, and creating the next year is what carries it (ADR 0004/0007). This is a high-risk new-year-construction + append-only-mutation path.
- **Atomic + queue-serialized rollover writes (#330 P1, revised by ADR 0009).** The new-year seed and the prior-year marking are committed together **inside** `this._saveQueue.enqueue(...)` — originally as one `writeBatch`, now as the version-checked transaction of `specs/year-end-review.md` § Versioned year-document writes (source at the `rev` the transaction read, destination created with `rev: 1`) — never as two independent `setDoc` calls, so the rollover is atomic and serialized behind any pending save of the prior year, a queued pre-carry save lands first and the carry-marked write supersedes it, and a commit failure is captured and re-thrown after the enqueue settles so `createYear` fails loudly and never switches into a non-existent year.
- **Year-End Review rollover (ADR 0009).** `createYear(yearId, { reopenedAdjustmentIds, reconciliation })` with `'reconciliation' in options` is the review path: it appends the review's True-ups (`status: 'deferred'` in memory, persisted as `carried_forward`), Service Credits, and new Usage Charges to the prior year, computes the carry over that updated state, seeds the new year with the next-year bills and the itemized carry, appends the `TRUE_UP_RECORDED` / `SERVICE_CREDIT_RECORDED` / `USAGE_CHARGE_RECORDED` / `YEAR_CARRIED_FORWARD` / `YEAR_ROLLED_OVER` events on the prior year and `YEAR_CREATED_FROM_REVIEW` / `BILL_PRICE_ROLLED_OVER` / `BILL_CREATED` on the new year, and commits both documents in one Firestore transaction whose preconditions are that the new year does not exist, that the prior year's fingerprint equals the reviewed one, and that both documents' `rev` advance as the versioned-write rules require. Deterministic record ids, the source-status rule (open, settling, closed; never archived), the Closed-year Service Credit rule, and the stale / concurrent / uncertain-outcome recovery are specified in `specs/year-end-review.md`. An omitted `reconciliation` is the legacy call above with the same business outcome, committed through the same version-checked transaction (`specs/year-end-review.md` § Versioned year-document writes; the earlier "byte-for-byte unchanged" promise is withdrawn).
- `switchYear` updates the active year in local state and writes `activeBillingYear` to the user doc with `merge: true`; failures set error state.

### Save Behavior

- `save` refuses to write when the year is closed or archived, enqueues a Firestore write with `updatedAt` server timestamp for open years, and no-ops without a user or active year.

### Year Status Transitions

- `setYearStatus` transitions the active year status, emits a `YEAR_STATUS_CHANGED` billing event with previous/new status and actor, and persists it as a full-document, version-checked write through the SaveQueue (ADR 0009; it no longer writes a `merge: true` partial that replaces the events array from memory), setting `closedAt`/`archivedAt` timestamps when applicable.
- No-ops when the status is unchanged or when no user is set.
- Rolls back state and re-throws on Firestore errors.

### CRUD Mutations

#### Members

- `addMember` creates a member with a unique ID, trims name whitespace, rejects empty names and duplicate names, rejects invalid E.164 phone numbers, accepts valid E.164 and empty phone, and throws on read-only years.
- `updateMember` updates fields, rejects renaming to a duplicate, rejects non-existent members, validates E.164 phone on update.
- Linked member one-parent invariant: rejects self-linking, rejects linking a parent as a child, rejects linking a member already linked to another parent, rejects making a child into a parent, allows a parent to update their own linked list, and allows clearing linked members.
- `removeMember` removes the member, cleans up bill membership arrays, removes associated payments, unlinks from parent, and throws on archived years.

#### Bills

- `addBill` creates a bill with a unique ID defaulting to monthly frequency, emits `BILL_CREATED` event, rejects empty names and zero/negative amounts, accepts annual frequency, rejects non-http(s) website URLs, and accepts valid or empty websites.
- `updateBill` updates fields, emits `BILL_UPDATED` events per changed field, skips events for unchanged fields, rejects invalid/NaN amounts, coerces string amounts to numbers, and validates website URLs.
- `removeBill` removes the bill and emits `BILL_DELETED` event with the bill name.
- `toggleBillMember` adds or removes a member from a bill, emits `MEMBER_ADDED_TO_BILL` or `MEMBER_REMOVED_FROM_BILL` events, and throws for non-existent bills.

#### Payments

- `recordPayment` records a payment with a generated ID and timestamp, emits `PAYMENT_RECORDED` event, rejects zero amounts and unknown members, defaults method to "other".
- Distributed payments: when `distribute=true` for a household member, creates proportional payment entries across the household summing to the original amount and emits events with `distributed: true`; when `distribute=false` or the member has no linked members, records a single payment.
- `reversePayment` creates a negative reversal entry, marks the original as reversed, emits `PAYMENT_REVERSED` event, rejects unknown or already-reversed payments, and prevents reversing a reversal entry.
- `updatePayment` edits a payment's method and/or note in place, emits `PAYMENT_UPDATED` event with before/after values for audit trail, returns original unchanged when no fields differ, and rejects edits on reversed or reversal entries.

#### Usage Charges (#317)

- `recordUsageCharge` appends a Usage Charge to `owedAdjustments[]` with a generated adjustment ID, `kind: 'usage_charge'`, the captured amount/description/incurredDate, `status: 'deferred'`, and a `createdAt` timestamp. The financial source of truth lives on the adjustment record. It emits a `USAGE_CHARGE_RECORDED` billing event (mirroring `PAYMENT_RECORDED`), rejects non-positive amounts, requires a non-empty description, rejects unknown members, and throws on read-only years.
- The mutation is append-only: a charge is voided via a later status change, never physically deleted (mirroring payments-ledger immutability). It does not touch `recordPayment`/`reversePayment` or the `payments[]` ledger.
- A deferred charge does NOT raise the member's owed and does not affect current-year settlement; it is surfaced only as a pending figure.

#### Service Credits (#321)

- `recordServiceCredit` appends one or more Service Credit records to `owedAdjustments[]` (`kind: 'service_credit'`, `status: 'active'`, a generated adjustment ID, the captured `billId`/`reason`/`incurredDate` (defaulting to the local date), the amount as a positive magnitude, and a `createdAt` timestamp). The financial source of truth lives on the adjustment record. It emits a single `SERVICE_CREDIT_RECORDED` billing event (carrying the gross bill-level amount, billId, billName, and reason; mirroring `USAGE_CHARGE_RECORDED`) and triggers save.
- **Bill-level by default:** the amount is split among the bill's current members, with the last member absorbing the rounding remainder so the per-member records sum **exactly** to the gross amount (mirroring distributed payments). The split is the shared `splitCents(totalCents, memberIds)` helper in `src/lib/year-end-review.js` (ADR 0009), which True-ups use too; extracting it changes no share. A review-recorded Service Credit additionally carries `basis: 'price_change' | 'ended'`, `calc`, and `reconciliationId`. **Per-member variant:** when a `memberId` is supplied (a one-person issue), the whole amount lands on that single member, who must be assigned to the bill.
- It does **not** edit the bill (Option B): the bill's `amount`, members, and history are unchanged. It rejects non-positive amounts, requires a non-empty reason, throws when the bill does not exist, throws when the bill has no members to credit, throws when a per-member target is not on the bill, and throws on read-only years.
- A zero-cent split share creates no new adjustment record. The `SERVICE_CREDIT_RECORDED` event retains all target shares, zeros included, in `payload.shares: [{ memberId, amount }]`; `memberCount` remains the number of targets. Existing parsing and `splitCents` allocation/remainder are unchanged. This future-write rule does not admit or alter pre-existing zero Service Credits, which remain integrity-held under ADR 0010.
- The mutation is append-only: a credit is voided via a later status change, never physically deleted. It does not touch `recordPayment`/`reversePayment`, the `payments[]` ledger, or the bill.
- Settlement consequence (high-risk, `calculations.js`): an active Service Credit lowers the affected members' `owed`; when the member has already paid, the surplus surfaces as a household Credit on the existing refund/carry pipeline (`getHouseholdFinancials`, #316/#318) — no new disposition path.

#### Off-cycle Billing — Charge Notice (#320)

- `billDeferredCharges` off-cycle-bills a household's deferred Usage Charges as a single **Charge Notice**, keyed to the household primary. It selects `kind: 'usage_charge'`, `status: 'deferred'` records across the household grain (the primary plus their linked members, ADR 0001) — defaulting to **all** of them, narrowable by an optional incurred-date `range` (the "this month" preset) or an explicit `chargeIds` list — and flips each to `status: 'billed'`, stamping a generated `chargeNoticeId` and a `billedAt` timestamp. It returns `{ chargeNoticeId, memberId, amount, chargeIds, charges }`. A linked member's deferred charge is billed when its household primary is billed.
- The mutation is **append-only**: it changes status in place and never deletes a record (mirroring the payments-ledger and Usage Charge immutability). It does NOT touch `recordPayment`/`reversePayment`/`recordUsageCharge` or the `payments[]` ledger. It emits a `CHARGES_BILLED` billing event (mirroring `USAGE_CHARGE_RECORDED` / `REFUND_ISSUED`).
- A billed charge raises the household's owed (via `getBilledUsageChargeTotalForMember`), so unpaid → Outstanding → blocks close (ADR 0006); settlement is through the existing payments ledger. It rejects an unknown member, throws when no deferred charges match the selection, and throws on a read-only year. Another household's charges are never affected.

#### Future atomic Charge Notice boundary (#648; Proposed ADR)

The [owner-approved contract and four amendments](https://github.com/nathanjohnpayne/friends-and-family-billing/pull/649#issuecomment-6716004056)
are specified in [ADR 0012](../docs/adr/0012-charge-notice-recovery.md) and
[Invoicing: future Charge Notice contract](invoicing.md#future-charge-notice-issuance-and-recovery-contract-648).
ADR 0012 remains Proposed until final-head review/merge; this text describes a
future implementation, not current conformance or code approval.

- The fixed selected raw set is its own cent-allocation parent. Freeze its parent
  and row cents for the Notice, preserving source amounts; never treat the Notice
  as another ledger or infer that separate Notice totals equal household `B`.
  Zero/invalid selections, any complete-source hold, and a held finalized billed
  candidate stop before billing/event/Notice/mail effects. Retain broader stale,
  year, household and identity guards regardless of whole-cent normal writers.
- `recordUsageCharge` rounds to cents before storing cents/100; the review's
  `buildUsageChargeRecord` uses exact `toCents` and checked `snapshotDollars`.
  Keep both writer tripwires. This bounded evidence does not prove that stored
  legacy/imported/direct records are whole cents, valid or representable. Existing
  type/domain/overflow/provenance admission and legacy sub-cent fixtures remain.
- Billing, its event, the frozen Notice and deterministic delivery intent commit
  together through #614; replay never bills twice. A missing original email
  preserves bill/Notice with not-addressable delivery, not a financial hold.
  Functions never mutate a year; recovery preserves the original source linkage.
- Delivery state never allocates payments to a Notice or changes owed, financial
  holds, settlement, close readiness or rollover eligibility. Close/rollover
  warns about all not-sent intents (or unavailable status) and allows knowingly
  proceeding under existing financial gates. No new claim may start after close;
  an already claimed external send may finish.

The structural #646 split keeps displays/ordinary invoices in #635 and assigns
these Notice mutations/snapshots/guards to the separate Notice follow-up and
R1–R4. No source patch or independently tested split head is supplied by this
specification update; the open draft/P1 still requires a future authorized split.

#### Credit Dispositions

- `issueRefund` records a Refund (#318) for a household that carries a Credit by appending to `creditAdjustments[]` (append-only; `type: 'refund'`, `status: 'recorded'`, the household primary's `memberId`). Recording it clears the credit immediately (Model B, ADR 0003 — no member confirmation), since the refund subtracts from Net Contribution and lives outside the payments ledger; `payments[]` and the payment math are untouched. It emits a `REFUND_ISSUED` billing event and triggers save.
- The refund must target the household primary (rejects a linked member, ADR 0001), requires a non-empty reason, rejects non-positive amounts, rejects a household with no credit, and **caps the amount at the household's current credit** (the credit is computed from `getHouseholdFinancials`, including any credit produced by a Service Credit, #321, so it rides this same pipeline). Throws on a read-only year.

#### Settings

- `updateSettings` merges new settings into existing ones, preserving unmodified keys, and throws on read-only years.

### Read-Only Guard

- `_guardReadOnly` throws for closed, archived, or null active year, and passes for open and settling years.
- `createYear` is not guarded by `_guardReadOnly`: the rollover (legacy and review) writes the prior-year document from an open, settling, or closed year, the one deliberate append to a closed year (ADR 0007, ADR 0009). It rejects an archived source year.

Uncommunicated Notices never remove their billed source rows or alter money.
These warnings define no new billed-charge auto-carry rule: existing financial
authority and frozen owed/settlement/carry formulas remain decisive.
