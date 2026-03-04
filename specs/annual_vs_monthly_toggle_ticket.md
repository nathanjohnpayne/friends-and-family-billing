# 🧾 Feature --- Annual vs Monthly Billing Toggle (Remove Manual Admin Math)

**Type:** Feature\
**Priority:** High\
**Component:** Bills Creation / Billing Engine\
**Epic:** Annual Billing Experience

------------------------------------------------------------------------

## Summary

Add a billing frequency toggle allowing admins to enter bills as either
**Monthly** or **Annual** amounts.

Currently, admins must manually convert annual costs into monthly values
before entering bills, which introduces friction, calculation errors,
and breaks the product's annual billing mental model.

The system should perform normalization automatically.

------------------------------------------------------------------------

## Problem Statement

The product is designed around **annual settlement**, yet bill entry
assumes monthly pricing.

Example today:

-   Disney+ annual plan = \$139.99/year

-   Admin must calculate:

        139.99 ÷ 12 = 11.67

-   Then enter `$11.67` manually.

Problems:

1.  Forces unnecessary math.
2.  Introduces rounding inconsistencies.
3.  Causes trust issues when totals don't match receipts.
4.  Conflicts with annual billing positioning.
5.  Slows bill entry.

Admins should enter bills exactly as charged.

------------------------------------------------------------------------

## Expected Behavior

Admins choose billing frequency when creating a bill:

    Bill Name
    Amount
    Billing Frequency:
    (•) Monthly
    ( ) Annual

System automatically normalizes values internally.

------------------------------------------------------------------------

## Proposed UI Changes

### Add Billing Frequency Toggle

Placed under **Amount (\$)** field.

Replace:

    Monthly Amount ($)

With:

    Amount ($)
    [ Monthly | Annual ]

Default: **Monthly** (backwards compatibility).

------------------------------------------------------------------------

### Input Behavior

  Selected Mode   Admin Enters    System Stores
  --------------- --------------- ------------------------------------
  Monthly         monthly price   monthlyNormalized
  Annual          annual price    annualNormalized + derived monthly

------------------------------------------------------------------------

## Data Model Update

Add field to bill object:

``` ts
billingFrequency: 'monthly' | 'annual'
```

Store canonical values:

``` ts
{
  amountEntered: number,
  billingFrequency: 'monthly' | 'annual',
  monthlyAmountNormalized: number,
  annualAmountNormalized: number
}
```

------------------------------------------------------------------------

## Calculation Rules

### Monthly Bill

    annual = monthly × 12

### Annual Bill

    monthly = annual ÷ 12

Normalization happens automatically.

------------------------------------------------------------------------

## Display Rules

### Admin UI

Show value exactly as entered.

Example:

    Apple One — $99/year

### Annual Summary

Uses normalized annual totals.

### Monthly breakdown (if shown)

Uses normalized monthly value.

------------------------------------------------------------------------

## Editing Behavior

When editing:

-   Toggle reflects original frequency.
-   Original entered amount preserved.
-   Switching frequency recalculates values.

Example:

    $120 Annual → toggle Monthly
    Result: $10/month

------------------------------------------------------------------------

## Acceptance Criteria

-   Admin can select Monthly or Annual billing.
-   No manual math required.
-   Annual totals calculate correctly.
-   Existing bills default to Monthly.
-   Editing preserves original intent.
-   Annual invoices reflect accurate totals.
-   Rounding handled consistently (2 decimal precision).

------------------------------------------------------------------------

## Edge Cases

### Rounding

Use canonical annual value for calculations.

Example:

    $139.99/year
    monthlyNormalized = round(139.99 / 12, 2)

Annual total must always equal entered value.

------------------------------------------------------------------------

## Why This Matters

This change aligns bill entry with the product's core principle:

> Users manage annual obligations --- not monthly subscriptions.

It reduces admin friction and increases trust in totals.

------------------------------------------------------------------------

## Success Metrics

-   Faster bill creation time.
-   Reduced admin corrections.
-   Fewer rounding discrepancies.
-   Improved invoice accuracy perception.

------------------------------------------------------------------------

## Engineering Notes

This is a **domain-model improvement**, not just UI.

The toggle affects:

-   bill schema
-   calculations
-   invoice generation
-   summaries
-   future reporting

Normalization must occur at the model layer, not UI only.
