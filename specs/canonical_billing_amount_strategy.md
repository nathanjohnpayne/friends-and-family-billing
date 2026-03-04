# 🧮 Canonical Billing Amount Strategy --- Prevent Rounding Drift Across Years

**Type:** Architecture / Data Integrity Feature\
**Priority:** High\
**Component:** Billing Engine / Calculations / Annual Settlement\
**Epic:** Annual Billing Experience

------------------------------------------------------------------------

## Summary

Introduce a **canonical billing amount strategy** to ensure financial
totals remain mathematically consistent across:

-   monthly ↔ annual conversions
-   multi-member splits
-   edits over time
-   archived billing years

Without a canonical model, repeated normalization and rounding
operations will introduce **rounding drift**, causing totals to diverge
from real-world charges.

This ticket establishes a single authoritative source for all monetary
calculations.

------------------------------------------------------------------------

## Problem Statement

Current and upcoming behaviors create risk:

1.  Annual amounts are derived from monthly values.
2.  Monthly values are derived from annual values.
3.  Per-member splits introduce fractional cents.
4.  Values may be recalculated repeatedly over time.

Example drift:

    $139.99/year
    → ÷12 = $11.6658...
    → rounded = $11.67/month
    → ×12 = $140.04/year

Result: totals no longer match the real charge.

Over multiple edits or years, discrepancies accumulate and reduce user
trust.

------------------------------------------------------------------------

## Core Principle

    One canonical value.
    All other values are derived views.

The system must never recalculate from already-rounded numbers.

------------------------------------------------------------------------

## Canonical Amount Rule

Each bill stores exactly ONE authoritative monetary value.

### Canonical Storage

``` ts
canonicalAmount: number
canonicalFrequency: 'annual' | 'monthly'
currency: 'USD'
```

All other amounts are computed dynamically.

------------------------------------------------------------------------

## Normalization Strategy

### If Canonical = Annual

    monthlyDerived = canonicalAnnual / 12
    displayMonthly = round(monthlyDerived, 2)

Annual total ALWAYS equals canonical amount.

------------------------------------------------------------------------

### If Canonical = Monthly

    annualDerived = canonicalMonthly * 12
    displayAnnual = round(annualDerived, 2)

------------------------------------------------------------------------

## Split Calculation Rules

Member splits must derive from canonical annual total:

    memberShare = canonicalAnnual / memberCount

Then rounded only for display.

### Adjustment Rule

If rounding creates remainder cents:

-   Assign remainder to first member deterministically.
-   Never lose or create money.

Example:

    $100 ÷ 3
    = 33.33, 33.33, 33.34

------------------------------------------------------------------------

## Data Model Update

``` ts
type Bill = {
  id: string
  canonicalAmount: number
  canonicalFrequency: 'annual' | 'monthly'
  currency: string

  // derived (not authoritative)
  derivedMonthly?: number
  derivedAnnual?: number
}
```

Derived values must NEVER be persisted as source-of-truth.

------------------------------------------------------------------------

## Editing Behavior

When admin edits:

-   Preserve canonical frequency when possible.
-   Recalculate derived values.
-   Do NOT convert derived values back into canonical.

------------------------------------------------------------------------

## Archived Year Protection

Archived billing years must store:

    canonicalAmountSnapshot
    memberSplitSnapshot

Ensures historical totals never change due to later logic updates.

------------------------------------------------------------------------

## Acceptance Criteria

-   One canonical monetary value per bill.
-   No recalculation from rounded numbers.
-   Annual totals always equal real-world charge.
-   Member splits sum exactly to canonical amount.
-   Archived years remain mathematically frozen.
-   Editing does not introduce drift.

------------------------------------------------------------------------

## Engineering Constraints

-   Use integer cents internally when possible.
-   Avoid floating-point accumulation errors.
-   Centralize calculation logic in billing engine.

Recommended:

    amountInCents: integer

------------------------------------------------------------------------

## Success Metrics

-   Zero invoice discrepancies.
-   No reconciliation corrections required.
-   Stable totals across edits and years.
-   Increased user trust in calculations.

------------------------------------------------------------------------

## Why This Matters

Financial software fails user trust when numbers change subtly over
time.

This strategy ensures:

> The number users entered is the number the system always honors.
