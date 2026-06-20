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
- `totalCreditsOwed` is the sum of unresolved household credits and is tracked on a separate axis from `totalOutstanding`; an overpaid household still counts as settled (its surplus does not block settlement).
- `totalOutstanding` is the sum of per-household **net** shortfalls (`max(0, owed − Net Contribution)` beyond the epsilon), not a global gross difference: a recorded refund leaves the ledger and one household's overpayment never masks another household's debt. `percentage` is derived from the net shortfall (`(totalAnnual − totalOutstanding) / totalAnnual`), so returned money is never counted as settlement progress. `totalPayments` remains gross money received.

### Household Net Contribution and Credit

Off-cycle credits (#316, ADR 0001, ADR 0005) are read-only display calculations — no mutations are introduced.

- `CREDIT_EPSILON` is a sub-cent threshold (≈ half a cent); an overpayment at or below it is treated as zero so distributed-payment and bill-split rounding residue is not surfaced as money owed back.
- `getCreditAdjustmentTotalForMember` sums a member's active refunds and carried-forward credits (records whose `status` is not `cancelled`), and returns 0 for an unknown member or an empty/missing array. These adjustments subtract from gross payments. It accepts an optional `reopenedAdjustmentIds` set (defaulting to none) and excludes any adjustment whose `id` is in it, so a two-argument call is unchanged.
- `getHouseholdFinancials` computes a household's `owed`, `grossPaid`, `creditAdjustmentTotal`, `netContribution` (gross paid minus refunds/carry-forwards), and `credit` (the net amount overpaid, with sub-cent residue zeroed by `CREDIT_EPSILON`) at the household grain. Owed, payments, and adjustments are summed across the primary and linked members before differencing, so internal imbalance between members nets out and is invisible to the household credit. It threads an optional `reopenedAdjustmentIds` set through to the per-member adjustment sum.
- **Invariant:** in valid states a household's recorded dispositions (refunds + carry-forwards) are capped at its credit (enforced at the mutation/import boundary by later slices), so `netContribution >= owed` and a settled household never reads as underpaid. Every settlement surface — status, the collectable balance, the Record-Payment gate, and outstanding totals — derives from `netContribution`, so an over-disposition degrades to an honest collectable shortfall rather than splitting status from balance.

### Re-opening a Credit on Not-Received (#319, ADR 0003)

- Recording a refund (#318) optimistically clears the household credit. ADR 0003's one member-protection concession is that an **active, unresolved `not_received`** report **re-opens** that refund's credit **while the year is open**: the disposition stops counting, Net Contribution rises back, and the credit is owed again until the administrator resolves it (re-send / cancel / dismiss).
- The re-open is expressed as a set of `creditAdjustmentId`s (built from the refund notices by `reopenedCreditAdjustmentIds`, billing-sharing spec) and threaded into `getCreditAdjustmentTotalForMember` → `getHouseholdFinancials` → `calculateSettlementMetrics`. An adjustment in the set is excluded exactly as if it were `cancelled`, so only `credit` / `totalCreditsOwed` change.
- **`totalOutstanding` is never affected by a re-open.** Excluding a refund only raises Net Contribution, which can only shrink a shortfall; a re-opened credit is overpayment owed back, never underpayment, so settlement progress is never inflated by an unconfirmed refund.
- **Closed years are corrected forward (ADR 0007):** read-only years pass no re-open set, so a `not_received` arriving after close never reanimates a frozen ledger. The re-open is a derived display calculation only — the persisted `creditAdjustment` and the append-only ledger are never mutated.

### Deferred Usage Charges (#317, ADR 0005)

A Usage Charge is a `+owed` per-member ad-hoc debit stored in `owedAdjustments[]` (`kind: 'usage_charge'`). A **deferred** charge is recorded and visible but NOT yet billed, so these helpers surface a running "pending" figure that deliberately does **not** feed `owed`, `credit`, the settlement gate, or `calculateSettlementMetrics`.

- `getDeferredUsageChargeTotalForMember` sums a member's deferred usage charges only (records with `kind: 'usage_charge'` and `status: 'deferred'`), and returns 0 for an unknown member or an empty/missing array. Voided and already-billed charges, and credit-direction adjustments (Service Credits, #321), are excluded.
- `getHouseholdDeferredCharges` returns `{ count, total }` for a household (primary member plus their linked members, ADR 0001 grain), counting and summing only deferred usage charges. Another household's charges are not counted.
- Deferred usage charges never change a household's `owed`, `netContribution`, `credit`, or settlement status/metrics; `getHouseholdFinancials` and `calculateSettlementMetrics` do not take `owedAdjustments` as input.

### Carry-Forward Seam (#322, ADR 0005, ADR 0006, ADR 0007)

The single shared carry-forward seam (ADR 0005) rolls a closing year's **undisposed** items into next year (ADR 0006): undisposed household Credits and still-`deferred` Usage Charges. It is netted to one per-household **opening balance** (credits negative, charges positive) that the new year is seeded with, so the carried balance appears in the new year's annual total and first invoice. This is the integrative slice; the new-year construction and settlement math are high-risk and changes are additive and backward-compatible.

- `getHouseholdFinancials` accepts an optional sixth argument `openingBalance` (default `0`), after #319's fifth `reopenedAdjustmentIds` — a netted carried-forward modifier of the household's `owed`: a carried credit is negative (lowers owed), a carried charge is positive (raises owed). `owed` is floored at `0` so a carried credit larger than this year's bills reduces owed to zero rather than going negative (the residual rides the normal credit path as payments arrive). Defaulting to `0` keeps every existing call (including the #319 five-argument form) unchanged.
- `getHouseholdOpeningBalance` sums a household's `carry_opening` seed records (records in `owedAdjustments[]` with `kind: 'carry_opening'`, summed across the primary and linked members at the ADR 0001 grain), and returns 0 for an unknown household or an empty/missing array. Voided seeds and deferred Usage Charges are excluded (a deferred charge is pending, never an opening balance).
- `buildCarryForward` is the seam. Given a closing year's `familyMembers`, `bills`, `payments`, `creditAdjustments`, and `owedAdjustments`, it returns, per carrying household, `{ primaryMemberId, credit, deferredChargeTotal, deferredChargeIds, creditAdjustmentIds, openingBalance }` plus an aggregate `{ totalOpeningBalance, memberCount }`. A household's carryable `credit` is its `getHouseholdFinancials` credit (already net of recorded refunds/carry-forwards, so a disposed or partially-refunded credit is never double-carried). The opening balance nets the still-`deferred` Usage Charge total (positive) against the carryable credit (negative). A household with nothing undisposed (beyond `CREDIT_EPSILON`) is excluded. It operates at the household grain (ADR 0001): linked-member credits and deferred charges roll under the primary.
- **#319 reconciliation (integrated).** `buildCarryForward` accepts an optional `options.reopenedAdjustmentIds` set (default empty), built from the refund notices by `reopenedCreditAdjustmentIds` (#319). Per ADR 0003/0006, an active `not_received` re-opens a credit that is owed back **this** year and must **not** be carried; the seam therefore treats a re-opened recorded refund as still-effective for the carry (its amount stays subtracted from the carryable credit) and excludes the re-opened record id from `creditAdjustmentIds` (it is not re-disposed by the carry). Only genuine residual surplus rolls forward. The set is threaded into `createYear` via `options.reopenedAdjustmentIds` (the `BillingYearSelector` supplies it from `useRefundNotices`); when empty, behavior is unchanged.
- `calculateSettlementMetrics` accepts an optional sixth `owedAdjustments` argument (after #319's fifth `reopenedAdjustmentIds`); it folds each household's `carry_opening` opening balance into `owed`/`totalAnnual` and the Outstanding figure. Deferred Usage Charges in this array are still ignored (pending, not owed). Defaulting to `[]` keeps the #319 five-argument call unchanged.

### Outstanding Balance and Year Close

- `calculateOutstandingBalance` returns the sum of all unpaid household balances (per-household NET shortfall, accepting an optional `creditAdjustments` array so recorded refunds/carry-forwards are reflected), and returns 0 when everyone is paid up. It mirrors the outstanding figure in `calculateSettlementMetrics` so the close path and dashboard agree. The close gate blocks only on this present-tense Outstanding figure: an undisposed credit (a surplus) and a deferred Usage Charge are **not** counted (they auto-carry, ADR 0006), so neither holds the year open. (A future billed-but-unpaid charge — issue #320, developed in parallel and not in this base — will add into this present-tense Outstanding total at the commented seam; this slice does not implement it.)
- `buildCarryForwardSummary` (in `billing-year.js`) is the lifecycle entry point to the seam — a thin wrapper over `buildCarryForward` returning the per-household opening balances plus the aggregate total and member count for the close confirmation copy.
- `buildCloseYearMessage` includes the outstanding dollar amount when greater than zero, and omits the outstanding warning when the balance is zero. It accepts an optional third `carry` summary argument; when one or more members carry a net opening balance beyond the epsilon, it appends a sentence stating the magnitude of the net amount carrying forward (net credit when negative, net charges when positive) and the member count. With no carry argument it is unchanged.
- `applyCarryForwardToPriorYear` (in `billing-year.js`) marks a closing year's undisposed items carried-forward **append-only**: it returns fresh arrays where each carrying household gains one `creditAdjustments[]` record of `type: 'carry_forward'` (`status: 'recorded'`, stamped `toYear`) for its carried credit — disposing it on the old year exactly like a refund — and each still-`deferred` Usage Charge that carried has its `status` transitioned `deferred` → `carried_forward` in place (stamped `carriedForwardTo`), preserved and never deleted. It does not mutate the inputs.

### Year Label Management

- `suggestNextYearLabel` increments a numeric year label by one, or falls back to the current calendar year for non-numeric or null labels.
- `isYearLabelDuplicate` returns true for existing labels (trimming whitespace) and false for new labels.

### New Year Data Construction

- `buildNewYearData` resets `paymentReceived` to 0 for all members, preserves bill structure, starts with empty payments and billing events arrays, sets status to open, and deep-clones linked members to prevent reference sharing. It also initializes empty `creditAdjustments` and `owedAdjustments` arrays (parity with `buildSavePayload`/`buildInitialYearData`, so a freshly-created year never omits them from the shared document).
- **Carry-forward seeding (#322).** `buildNewYearData` accepts an optional fifth `carry` argument (a `buildCarryForwardSummary` result) and an optional sixth `fromYearLabel`. For each carrying household it seeds one `carry_opening` record in the new year's `owedAdjustments[]` — `{ kind: 'carry_opening', memberId: <primary>, amount: <netted opening balance>, status: 'carried_in', fromYear: <prior label> }` — so the carried balance flows into the new year's `owed` (via `getHouseholdOpeningBalance` + `getHouseholdFinancials`), its annual total, and its first invoice. Seed records ride the verbatim `owedAdjustments[]` round-trip both apps persist, so they are never dropped. Households whose netted opening balance is within `CREDIT_EPSILON` are not seeded. With no `carry` argument it seeds nothing and stays backward-compatible.

### BillingYearService State Management

- The subscribe/unsubscribe pattern notifies listeners on state changes and creates a new state reference on each update.
- `setUser(null)` resets state to defaults (loading false, empty arrays, null activeYear).
- Setting a valid user with an existing `activeBillingYear` loads that year's data from Firestore.
- Brand-new users (no user doc) get a default year created with a legacy email template containing `%billing_year%` and `%annual_total%` tokens.
- Load failures set an error state.

### Year Creation and Switching

- `createYear` rejects duplicate year labels with an error, writes new year data to Firestore with a `createdAt` server timestamp, and no-ops without a user.
- **Carry-forward at rollover (#322, ADR 0005/0006/0007).** Before writing the new year, `createYear(yearId, options)` computes the prior (current) year's carry summary (`buildCarryForwardSummary`, passing `options.reopenedAdjustmentIds` so a credit re-opened by an active `not_received` is held back, #319/ADR 0003) and (1) seeds the new year doc with one `carry_opening` opening-balance record per carrying household (via `buildNewYearData`), and (2) when anything carried, marks the prior year **append-only** (`applyCarryForwardToPriorYear`: a `carry_forward` credit record per carried credit, plus an in-place `deferred` → `carried_forward` status transition on each carried Usage Charge, preserved not deleted), emits a `YEAR_CARRIED_FORWARD` event, and persists the prior-year doc as a full document. When nothing is undisposed there is no prior-year write and no seeds, so behavior matches the pre-#322 path. The carried balance is materialized lazily here: if no next year ever existed the credit stayed live, and creating the next year is what carries it (ADR 0004/0007). This is a high-risk new-year-construction + append-only-mutation path.
- `switchYear` updates the active year in local state and writes `activeBillingYear` to the user doc with `merge: true`; failures set error state.

### Save Behavior

- `save` refuses to write when the year is closed or archived, enqueues a Firestore write with `updatedAt` server timestamp for open years, and no-ops without a user or active year.

### Year Status Transitions

- `setYearStatus` transitions the active year status, emits a `YEAR_STATUS_CHANGED` billing event with previous/new status and actor, persists the event to Firestore with `merge: true`, and sets `closedAt`/`archivedAt` timestamps when applicable.
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

#### Credit Dispositions

- `issueRefund` records a Refund (#318) for a household that carries a Credit by appending to `creditAdjustments[]` (append-only; `type: 'refund'`, `status: 'recorded'`, the household primary's `memberId`). Recording it clears the credit immediately (Model B, ADR 0003 — no member confirmation), since the refund subtracts from Net Contribution and lives outside the payments ledger; `payments[]` and the payment math are untouched. It emits a `REFUND_ISSUED` billing event and triggers save.
- The refund must target the household primary (rejects a linked member, ADR 0001), requires a non-empty reason, rejects non-positive amounts, rejects a household with no credit, and **caps the amount at the household's current credit** (the credit is computed from `getHouseholdFinancials`). Throws on a read-only year.

#### Settings

- `updateSettings` merges new settings into existing ones, preserving unmodified keys, and throws on read-only years.

### Read-Only Guard

- `_guardReadOnly` throws for closed, archived, or null active year, and passes for open and settling years.
