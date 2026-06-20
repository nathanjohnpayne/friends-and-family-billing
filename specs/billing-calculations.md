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

### Outstanding Balance and Year Close

- `calculateOutstandingBalance` returns the sum of all unpaid household balances (per-household NET shortfall, accepting an optional `creditAdjustments` array so recorded refunds/carry-forwards are reflected), and returns 0 when everyone is paid up. It mirrors the outstanding figure in `calculateSettlementMetrics` so the close path and dashboard agree.
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

#### Settings

- `updateSettings` merges new settings into existing ones, preserving unmodified keys, and throws on read-only years.

### Read-Only Guard

- `_guardReadOnly` throws for closed, archived, or null active year, and passes for open and settling years.
