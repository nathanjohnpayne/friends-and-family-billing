# BUG --- Bills Section Does Not Correctly Reflect Annual vs Monthly Billing Mode

## Type

Bug / UX Consistency / Data Model Presentation

## Priority

High

## Area

Bills → Bill Creation + Bill Cards

------------------------------------------------------------------------

## Summary

The Bills section was partially updated to support **Annual vs Monthly
billing**, but implementation is incomplete and inconsistent across:

-   Bill creation form
-   Bill card display
-   Amount labeling
-   Toggle usability and clarity

This creates a mismatch between entered data and displayed billing
semantics, forcing admins to interpret or mentally convert values.

The system is **annual-first**, therefore all UI must clearly
communicate whether values represent **Annual** or **Monthly** amounts
at all times.

------------------------------------------------------------------------

## Current Problems (Observed)

### 1. Form Label Does Not Update

The bill entry form still shows:

Monthly Amount (\$)

even when the bill is configured or displayed as Annual.

Result: - Admin must do manual math - Creates risk of incorrect totals -
Violates annual billing mental model

------------------------------------------------------------------------

### 2. Card Toggle Exists but Is Weak + Ambiguous

On bill cards:

\$300.00/mo\
Mo Yr

Issues: - Toggle is visually tiny - Not clearly interactive - Low
contrast - Reads like metadata instead of a control - Active state
unclear

Users cannot confidently tell: - whether bill is monthly or annual -
whether clicking changes display or underlying data

------------------------------------------------------------------------

### 3. Amount Text Does Not Adapt Semantically

Display always formats like:

\$300.00/mo

Expected: - Must dynamically update based on billing frequency - Must
not require interpretation

------------------------------------------------------------------------

### 4. Form + Card Are Out of Sync

Creation UI → Monthly terminology\
Card UI → Mixed terminology\
System Model → Annual billing year

These must be aligned.

------------------------------------------------------------------------

## Expected Behavior

### A. Billing Frequency Toggle (Source of Truth)

Each bill includes:

billing_frequency: - monthly - annual

This drives: - labels - calculations - formatting - summaries

------------------------------------------------------------------------

### B. Dynamic Form Labels

When toggle = Monthly:

Monthly Amount (\$)\
Charged every month

When toggle = Annual:

Annual Amount (\$)\
Charged once per year

Label updates immediately when toggle changes.

------------------------------------------------------------------------

### C. Card Display Updates

#### Monthly Bill

\$300.00 / month\
\$37.50 per person monthly

#### Annual Bill

\$3,600.00 / year\
\$450.00 per person annually

No abbreviations like "Mo Yr".

------------------------------------------------------------------------

### D. Improved Toggle Component

Replace current micro-toggle with segmented control:

\[ Monthly \] \[ Annual \]

Requirements: - Minimum 36px height - Clear active state - Filled
background for selected option - Accessible contrast - Click target ≥
44px - Label always visible

Locations: - Bill creation form - Bill card header

------------------------------------------------------------------------

### E. Visual Hierarchy

Billing frequency must be visible BEFORE amount interpretation.

Preferred:

T‑Mobile --- Annual Bill\
\$3,600.00 / year

Not:

\$300.00/mo Mo Yr

------------------------------------------------------------------------

## Acceptance Criteria

-   [ ] Billing frequency stored per bill
-   [ ] Form label updates dynamically
-   [ ] Amount suffix updates (/month or /year)
-   [ ] Per-person math recalculates correctly
-   [ ] Toggle redesigned for clarity + accessibility
-   [ ] No "Mo / Yr" abbreviations remain
-   [ ] Annual-first mental model preserved
-   [ ] Existing bills migrate without value change

------------------------------------------------------------------------

## Migration Rules

If bill predates feature:

billing_frequency = monthly (default)

No recalculation of stored values.

------------------------------------------------------------------------

## UX Principle

Users should never need to ask:

"Is this monthly or annual?"

The UI must answer that instantly.

------------------------------------------------------------------------

## Implementation Notes

Suggested component:

`<FrequencyToggle
  value="monthly | annual"
  onChange={updateBillingFrequency}
/>`{=html}

Derived display:

displayAmount = frequency === "annual" ? annualAmount : monthlyAmount

------------------------------------------------------------------------

## Success Metric

Admin can: - Add a bill - Choose frequency - Enter amount once -
Immediately understand totals without math

Time-to-understand billing card \< 2 seconds.
