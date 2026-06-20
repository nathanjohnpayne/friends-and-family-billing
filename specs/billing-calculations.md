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

- `calculateSettlementMetrics` computes total annual cost, total payments received, total outstanding balance, total credits owed to members, total member count, percentage settled (capped at 100), and count of fully paid members. It accepts an optional `creditAdjustments` array (defaulting to empty) so a three-argument call remains backward-compatible.
- Linked members are combined under their parent for household-level settlement tracking; the total member count reflects households not individuals.
- `totalCreditsOwed` is the sum of unresolved household credits and is tracked on a separate axis from `totalOutstanding`; an overpaid household still counts as settled (its surplus does not block settlement).
- `totalOutstanding` is the sum of per-household **net** shortfalls (`max(0, owed − Net Contribution)` beyond the epsilon), not a global gross difference: a recorded refund leaves the ledger and one household's overpayment never masks another household's debt. `percentage` is derived from the net shortfall (`(totalAnnual − totalOutstanding) / totalAnnual`), so returned money is never counted as settlement progress. `totalPayments` remains gross money received.

### Household Net Contribution and Credit

Off-cycle credits (#316, ADR 0001, ADR 0005) are read-only display calculations — no mutations are introduced.

- `CREDIT_EPSILON` is a sub-cent threshold (≈ half a cent); an overpayment at or below it is treated as zero so distributed-payment and bill-split rounding residue is not surfaced as money owed back.
- `getCreditAdjustmentTotalForMember` sums a member's active refunds and carried-forward credits (records whose `status` is not `cancelled`), and returns 0 for an unknown member or an empty/missing array. These adjustments subtract from gross payments.
- `getHouseholdFinancials` computes a household's `owed`, `grossPaid`, `creditAdjustmentTotal`, `netContribution` (gross paid minus refunds/carry-forwards), and `credit` (the net amount overpaid, with sub-cent residue zeroed by `CREDIT_EPSILON`) at the household grain. Owed, payments, and adjustments are summed across the primary and linked members before differencing, so internal imbalance between members nets out and is invisible to the household credit.
- **Invariant:** in valid states a household's recorded dispositions (refunds + carry-forwards) are capped at its credit (enforced at the mutation/import boundary by later slices), so `netContribution >= owed` and a settled household never reads as underpaid. Every settlement surface — status, the collectable balance, the Record-Payment gate, and outstanding totals — derives from `netContribution`, so an over-disposition degrades to an honest collectable shortfall rather than splitting status from balance.

### Deferred Usage Charges (#317, ADR 0005)

A Usage Charge is a `+owed` per-member ad-hoc debit stored in `owedAdjustments[]` (`kind: 'usage_charge'`). A **deferred** charge is recorded and visible but NOT yet billed, so these helpers surface a running "pending" figure that deliberately does **not** feed `owed`, `credit`, the settlement gate, or `calculateSettlementMetrics`.

- `getDeferredUsageChargeTotalForMember` sums a member's deferred usage charges only (records with `kind: 'usage_charge'` and `status: 'deferred'`), and returns 0 for an unknown member or an empty/missing array. Voided and already-billed charges, and credit-direction adjustments (Service Credits, #321), are excluded.
- `getHouseholdDeferredCharges` returns `{ count, total }` for a household (primary member plus their linked members, ADR 0001 grain), counting and summing only deferred usage charges. Another household's charges are not counted.
- Deferred usage charges never change a household's `owed`, `netContribution`, `credit`, or settlement status/metrics. `getHouseholdFinancials` and `calculateSettlementMetrics` now accept an optional trailing `owedAdjustments` array (#321), but only **active Service Credits** in it reduce owed; a deferred Usage Charge passed in is ignored, so a deferred charge still never affects settlement.

### Service Credits (#321, ADR 0005)

A Service Credit is the `−owed` mirror of a Usage Charge: a bill-level reduction (a service canceled, reduced, discounted, or with an issue) stored in `owedAdjustments[]` (`kind: 'service_credit'`, `status: 'active'`) with the amount as a positive magnitude. Unlike a deferred Usage Charge it takes effect immediately — it **lowers** the affected members' `owed`, and when a member has already paid the surplus surfaces as a household **Credit** on the existing refund/carry axis (no new disposition path). The bill's own `amount` and history are unchanged (Option B).

- `getServiceCreditTotalForMember` sums a member's active service credits (records with `kind: 'service_credit'` and `status: 'active'`) as a positive magnitude, and returns 0 for an unknown member or an empty/missing array. Voided credits (append-only void via status) and the `+owed` Usage Charge direction are excluded.
- `getHouseholdFinancials` subtracts the household's active service-credit total from the bill-derived owed (summed across the primary and linked members, ADR 0001 grain) and floors the result at zero, so an over-large credit becomes a Credit on the `netContribution` axis rather than negative debt. It returns the reduced `owed` plus `grossOwed` and `serviceCreditTotal`; the optional `owedAdjustments` argument defaults to empty so every existing four-argument caller is unaffected.
- `calculateSettlementMetrics` accepts the same optional trailing `owedAdjustments` argument and threads it through `getHouseholdFinancials`, so `totalAnnual` reflects owed **after** bill-level reductions and a fully-paid household whose owed dropped below its Net Contribution surfaces its surplus in `totalCreditsOwed`. A partially-paid household's outstanding shortfall shrinks by the credit. Backward-compatible: a four-argument call is unchanged.

### Outstanding Balance and Year Close

- `calculateOutstandingBalance` returns the sum of all unpaid household balances (per-household NET shortfall, accepting an optional `creditAdjustments` array so recorded refunds/carry-forwards are reflected, and an optional trailing `owedAdjustments` array so active Service Credits lower owed), and returns 0 when everyone is paid up. A `−owed` Service Credit can only **shrink** a household's shortfall, never inflate it (ADR 0006: the close-gate blocks only on present-tense money). It mirrors the outstanding figure in `calculateSettlementMetrics` so the close path and dashboard agree.
- `buildCloseYearMessage` includes the outstanding dollar amount when greater than zero, and omits the outstanding warning when the balance is zero.

### Year Label Management

- `suggestNextYearLabel` increments a numeric year label by one, or falls back to the current calendar year for non-numeric or null labels.
- `isYearLabelDuplicate` returns true for existing labels (trimming whitespace) and false for new labels.

### New Year Data Construction

- `buildNewYearData` resets `paymentReceived` to 0 for all members, preserves bill structure, starts with empty payments and billing events arrays, sets status to open, and deep-clones linked members to prevent reference sharing.

### BillingYearService State Management

- The subscribe/unsubscribe pattern notifies listeners on state changes and creates a new state reference on each update.
- `setUser(null)` resets state to defaults (loading false, empty arrays, null activeYear).
- Setting a valid user with an existing `activeBillingYear` loads that year's data from Firestore.
- Brand-new users (no user doc) get a default year created with a legacy email template containing `%billing_year%` and `%annual_total%` tokens.
- Load failures set an error state.

### Year Creation and Switching

- `createYear` rejects duplicate year labels with an error, writes new year data to Firestore with a `createdAt` server timestamp, and no-ops without a user.
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

#### Service Credits (#321)

- `recordServiceCredit` appends one or more Service Credit records to `owedAdjustments[]` (`kind: 'service_credit'`, `status: 'active'`, a generated adjustment ID, the captured `billId`/`reason`/`incurredDate` (defaulting to the local date), the amount as a positive magnitude, and a `createdAt` timestamp). The financial source of truth lives on the adjustment record. It emits a single `SERVICE_CREDIT_RECORDED` billing event (carrying the gross bill-level amount, billId, billName, and reason; mirroring `USAGE_CHARGE_RECORDED`) and triggers save.
- **Bill-level by default:** the amount is split among the bill's current members, with the last member absorbing the rounding remainder so the per-member records sum **exactly** to the gross amount (mirroring distributed payments). **Per-member variant:** when a `memberId` is supplied (a one-person issue), the whole amount lands on that single member, who must be assigned to the bill.
- It does **not** edit the bill (Option B): the bill's `amount`, members, and history are unchanged. It rejects non-positive amounts, requires a non-empty reason, throws when the bill does not exist, throws when the bill has no members to credit, throws when a per-member target is not on the bill, and throws on read-only years.
- The mutation is append-only: a credit is voided via a later status change, never physically deleted. It does not touch `recordPayment`/`reversePayment`, the `payments[]` ledger, or the bill.
- Settlement consequence (high-risk, `calculations.js`): an active Service Credit lowers the affected members' `owed`; when the member has already paid, the surplus surfaces as a household Credit on the existing refund/carry pipeline (`getHouseholdFinancials`, #316/#318) — no new disposition path.

#### Credit Dispositions

- `issueRefund` records a Refund (#318) for a household that carries a Credit by appending to `creditAdjustments[]` (append-only; `type: 'refund'`, `status: 'recorded'`, the household primary's `memberId`). Recording it clears the credit immediately (Model B, ADR 0003 — no member confirmation), since the refund subtracts from Net Contribution and lives outside the payments ledger; `payments[]` and the payment math are untouched. It emits a `REFUND_ISSUED` billing event and triggers save.
- The refund must target the household primary (rejects a linked member, ADR 0001), requires a non-empty reason, rejects non-positive amounts, rejects a household with no credit, and **caps the amount at the household's current credit** (the credit is computed from `getHouseholdFinancials`, including any credit produced by a Service Credit, #321, so it rides this same pipeline). Throws on a read-only year.

#### Settings

- `updateSettings` merges new settings into existing ones, preserving unmodified keys, and throws on read-only years.

### Read-Only Guard

- `_guardReadOnly` throws for closed, archived, or null active year, and passes for open and settling years.
