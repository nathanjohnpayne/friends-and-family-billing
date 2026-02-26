# FEATURE --- Derived Amount Preview (Annual ⇄ Monthly Conversion While Editing)

## Type

Feature / UX Enhancement / Data Integrity

## Priority

High

## Area

Bills → Bill Creation & Editing Experience

------------------------------------------------------------------------

## Summary

Admins currently must mentally convert between **monthly** and
**annual** billing amounts when entering or editing bills.\
This creates friction and introduces avoidable calculation errors.

Add a **Derived Amount Preview** that automatically shows the equivalent
billing value (Annual ⇄ Monthly) live while editing a bill.

This reinforces the system's **annual billing mental model** while
supporting monthly source pricing.

------------------------------------------------------------------------

## Problem

Even with a billing frequency toggle, users still need to calculate:

-   Annual total from a monthly price
-   Monthly equivalent from an annual price
-   Per‑person impact after conversion

Manual math introduces: - entry mistakes - rounding inconsistencies -
reduced confidence in totals

Financial interfaces should eliminate interpretation wherever possible.

------------------------------------------------------------------------

## Goal

Whenever a bill amount is entered or edited:

The system immediately displays the converted equivalent value.

User enters ONE number → system shows BOTH interpretations.

------------------------------------------------------------------------

## Expected Behavior

### Example --- Monthly Mode

Admin selects:

\[ Monthly \]

Inputs:

Monthly Amount: \$37.95

UI automatically shows:

≈ \$455.40 per year

Displayed beneath the input field in secondary styling.

------------------------------------------------------------------------

### Example --- Annual Mode

Admin selects:

\[ Annual \]

Inputs:

Annual Amount: \$120.00

UI automatically shows:

≈ \$10.00 per month

------------------------------------------------------------------------

## UX Requirements

### Placement

Derived preview appears:

-   Directly below amount input
-   Updates in real time
-   Uses subdued informational styling

Example:

Annual Amount (\$) \[ 120.00 \]

≈ \$10.00 per month

------------------------------------------------------------------------

### Formatting Rules

  Mode      Primary Label    Derived Preview
  --------- ---------------- ----------------------
  Monthly   Monthly Amount   ≈ Annual equivalent
  Annual    Annual Amount    ≈ Monthly equivalent

------------------------------------------------------------------------

### Visual Style

-   Smaller text than primary input
-   Neutral semantic color (`text-secondary`)
-   Prefixed with approximation symbol `≈`
-   No animation required

------------------------------------------------------------------------

## Calculation Rules

annual = monthly × 12\
monthly = annual ÷ 12

Rounding: - Store canonical value unchanged - Preview rounded to 2
decimals - Never overwrite entered value

------------------------------------------------------------------------

## Edge Cases

-   Empty input → preview hidden
-   Zero value → preview hidden
-   Invalid number → validation message replaces preview

------------------------------------------------------------------------

## Acceptance Criteria

-   [ ] Preview updates live while typing
-   [ ] Switching toggle recalculates preview instantly
-   [ ] Preview never modifies stored amount
-   [ ] Values formatted using currency locale
-   [ ] Works for both create + edit flows
-   [ ] No page refresh required

------------------------------------------------------------------------

## Implementation Notes

Suggested component:

`<DerivedAmountPreview
  amount={enteredAmount}
  frequency={billingFrequency}
/>`{=html}

Pseudo‑logic:

if (frequency === "monthly") { derived = amount \* 12; label = "per
year"; } else { derived = amount / 12; label = "per month"; }

------------------------------------------------------------------------

## UX Principle

Financial software should reduce cognitive load.

Users should never need a calculator to understand billing impact.

------------------------------------------------------------------------

## Success Metric

-   Bill entry completed without external calculation
-   Reduced incorrect bill entries
-   Admin understands annual impact instantly

------------------------------------------------------------------------

## Follow-On Opportunities

-   Per-person derived preview
-   Tooltip explaining rounding behavior
-   Annual total preview before saving
