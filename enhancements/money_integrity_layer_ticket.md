# 💰 Money Integrity Layer --- Immutable Ledger + Auditability Rules

**Type:** Architecture / Data Integrity / Trust Layer\
**Priority:** High\
**Component:** Payments / Audit Log / Financial Events\
**Epic:** Annual Billing Experience

------------------------------------------------------------------------

## Summary

Implement a **Money Integrity Layer** that treats financial changes as
immutable events and provides a consistent audit trail across:

-   bill amount changes
-   membership/split changes
-   payment records
-   dispute outcomes
-   year close/archive actions

This moves the system from "editable totals" to **financially
trustworthy software** where:

-   balances are derived from an event ledger
-   edits are recorded as new events (not overwrites)
-   users/admins can see what changed, when, and why

------------------------------------------------------------------------

## Problem Statement

Current (or typical) CRUD-style billing implementations create risk:

1.  Payments can be overwritten silently.
2.  Totals can change without explanation.
3.  Disputes have no durable evidence trail.
4.  Archived years can accidentally drift if recalculated.
5.  Users lose trust when numbers differ from receipts or prior views.

For annual billing---where users return after months---**auditability is
mandatory for trust.**

------------------------------------------------------------------------

## Core Principles

1.  **Append-only ledger**
    -   financial state is derived from events
2.  **No silent overwrites**
    -   updates create a new event with attribution
3.  **Deterministic computation**
    -   same input ledger → same balances
4.  **Immutable archives**
    -   archived years are frozen snapshots + event logs

------------------------------------------------------------------------

## Event Ledger Model (v1)

Store events in a per-billing-year collection:

    billingYears/{yearId}/events/{eventId}

### Canonical Event Shape

``` ts
type BillingEvent = {
  id: string
  billingYearId: string
  timestamp: number
  actor: {
    type: 'admin' | 'system' | 'member'
    userId?: string
    displayName?: string
  }
  eventType:
    | 'BILL_CREATED'
    | 'BILL_UPDATED'
    | 'BILL_DELETED'
    | 'MEMBER_ADDED_TO_BILL'
    | 'MEMBER_REMOVED_FROM_BILL'
    | 'PAYMENT_RECORDED'
    | 'PAYMENT_REVERSED'
    | 'REVIEW_REQUEST_CREATED'
    | 'REVIEW_REQUEST_RESOLVED'
    | 'YEAR_STATUS_CHANGED'
    | 'YEAR_ARCHIVED'
  payload: Record<string, any>
  note?: string
  source?: 'ui' | 'import' | 'migration' | 'system'
}
```

------------------------------------------------------------------------

## Ledger-Derived Computation Rules

Balances and totals are derived from ledger + canonical bill amounts:

-   `Annual Total` per bill from canonical strategy
-   Member shares from membership events (snapshot per bill)
-   Payments from `PAYMENT_RECORDED` events
-   Balance = (share totals) − (payments)

**Never** compute balances from a stored "paymentReceived" field alone.

------------------------------------------------------------------------

## UI/UX Requirements (Trust Surfaces)

### 1) Member Payment History (Read-only Ledger View)

On member detail / share link:

    Payment History
    Jan 14 — $100 (Zelle) — recorded by Nathan
    Jan 28 — $50 (Cash App) — recorded by Nathan

### 2) "What changed?" Audit Drawer (Admin)

For any bill, open side drawer:

-   bill created/edited
-   membership changes
-   rate changes
-   dispute changes
-   payment changes

### 3) Archive Integrity Banner

Archived years display:

    Archived — records are immutable.
    All totals reflect historical events.

------------------------------------------------------------------------

## Edit/Reverse Rules

### Payment Corrections

Payments are never edited in place.

To correct a payment:

-   create `PAYMENT_REVERSED` event referencing original payment event
-   create new `PAYMENT_RECORDED` event with corrected data

This preserves traceability.

------------------------------------------------------------------------

## Dispute / Review Integrity

Review requests must reference the exact bill item + year + snapshot
value at time of request:

``` ts
payload: {
  billId,
  memberId,
  disputedAmountCents,
  reason,
  attachments: [...],
  status: 'open' | 'in_review' | 'approved' | 'rejected'
}
```

Resolution emits a `REVIEW_REQUEST_RESOLVED` event.

------------------------------------------------------------------------

## Data Storage Guidance

-   Use **integer cents** for all money in payloads.
-   Store derived display values only for caching, never as authority.
-   Archived year stores:
    -   final computed balances snapshot
    -   immutable copy of the event list (or hash)

Optional integrity enhancement: - compute and store a rolling hash per
event to detect tampering.

------------------------------------------------------------------------

## Acceptance Criteria

-   All payment actions create ledger events.
-   Payment edits are represented as reversal + new record (no
    overwrite).
-   Bill edits create events with before/after values.
-   Balances are deterministically derived from ledger.
-   Admin can view audit history for bills and payments.
-   Archived year totals remain stable across code changes.
-   Share link can display payment history and dispute outcomes
    reliably.

------------------------------------------------------------------------

## Success Metrics

-   Reduced disputes driven by "where did this number come from?"
-   Increased user confidence in annual totals
-   Fewer admin corrections due to clearer history
-   Lower regression risk when adding features

------------------------------------------------------------------------

## Implementation Notes

Start with minimal viable ledger:

1.  PAYMENT_RECORDED (+ optional reversal)
2.  BILL_CREATED / BILL_UPDATED
3.  YEAR_STATUS_CHANGED / YEAR_ARCHIVED

Then incrementally extend to dispute events and membership events.

------------------------------------------------------------------------

## Why This Matters

Annual billing is fundamentally about **trust over time**.

When people return months later, the only way to maintain confidence is:

> "This is exactly what happened, and here's the record."
