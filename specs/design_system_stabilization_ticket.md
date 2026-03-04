# Design System Stabilization --- Jira Ticket

**Type:** UX / Frontend Architecture\
**Priority:** High\
**Component:** Design System / UI Foundation\
**Epic:** Billing Experience Refinement

------------------------------------------------------------------------

## Summary

Establish a lightweight **Design System Foundation** to prevent UI drift
as the Friends & Family Billing application expands (billing years,
disputes, share links, payment workflows, attachments, etc.).

The current interface is visually consistent but implemented via ad‑hoc
styling patterns. As features scale, this will lead to:

-   inconsistent spacing and alignment
-   conflicting button meanings
-   duplicated UI logic
-   increased regression risk
-   slower feature development

This ticket introduces semantic UI standards, reusable components, and
layout tokens to stabilize the product's visual and interaction model.

------------------------------------------------------------------------

## Problem Statement

Observed risks:

1.  **Spacing inconsistency**
    -   Cards, sections, and controls use slightly different
        padding/margins.
    -   Vertical rhythm varies between panels.
2.  **Button hierarchy ambiguity**
    -   Multiple primary-looking buttons compete for attention.
    -   Destructive actions visually similar to neutral actions.
3.  **Color semantics not standardized**
    -   Green sometimes = success, sometimes = action.
    -   Blue used for both navigation and confirmation.
4.  **Component duplication**
    -   Member cards, bill cards, and settings panels share patterns but
        are independently implemented.
5.  **Scaling risk** Upcoming features (disputes, archived years,
    attachments) will multiply UI states without shared primitives.

------------------------------------------------------------------------

## Goals

-   Create consistent visual hierarchy.
-   Define semantic meaning for colors and actions.
-   Introduce reusable UI components.
-   Reduce CSS duplication.
-   Enable predictable feature expansion.

------------------------------------------------------------------------

## Design System Scope (v1 --- Lightweight)

This is NOT a full enterprise design system.\
Goal: **stabilize**, not over-engineer.

Deliverables:

-   spacing scale
-   typography rules
-   button hierarchy
-   semantic color tokens
-   reusable layout components

------------------------------------------------------------------------

## Proposed Standards

------------------------------------------------------------------------

### 1️⃣ Spacing System

Introduce an 8‑pt spacing scale.

  Token     Value
  --------- -------
  space-1   4px
  space-2   8px
  space-3   16px
  space-4   24px
  space-5   32px
  space-6   48px

Rules: - Card padding = `space-4` - Section spacing = `space-5` -
Element gaps = `space-2` or `space-3` only

No arbitrary pixel values allowed.

------------------------------------------------------------------------

### 2️⃣ Typography Hierarchy

Define semantic text roles:

  Role         Usage
  ------------ ------------------------
  heading-xl   Page titles
  heading-lg   Section titles
  heading-md   Card titles
  body         Default text
  body-muted   Metadata / helper text
  label        Inputs
  numeric      Currency totals

Rules: - Totals use numeric style. - Metadata always muted. - Only one
heading-xl per page.

------------------------------------------------------------------------

### 3️⃣ Button Hierarchy (Critical)

Define semantic button classes.

#### Primary

Used once per section.

Examples: - Generate Invoice - Save Payment

Style: - Filled brand color.

------------------------------------------------------------------------

#### Secondary

Supporting actions.

Examples: - Share - Email Invoice - Edit Website

Style: - Outline or soft background.

------------------------------------------------------------------------

#### Tertiary

Low emphasis.

Examples: - Cancel - View Details

Style: - Text-only.

------------------------------------------------------------------------

#### Destructive

Irreversible actions.

Examples: - Remove Bill - Delete Member

Style: - Red background ONLY for destructive actions.

------------------------------------------------------------------------

### Acceptance Rule

A container may contain: - max **1 primary button**.

------------------------------------------------------------------------

### 4️⃣ Semantic Color Tokens

Replace raw colors with meaning-based tokens.

  Token           Meaning
  --------------- ------------------
  color-success   Paid / completed
  color-warning   Needs attention
  color-danger    Destructive
  color-primary   Main action
  color-muted     Secondary info
  color-surface   Card background
  color-border    Dividers

Never reference raw hex values in components.

------------------------------------------------------------------------

### 5️⃣ Reusable Components

Create shared components:

#### Core Components

-   `<Card>`
-   `<SectionHeader>`
-   `<ActionMenu>`
-   `<StatusBadge>`
-   `<EmptyState>`
-   `<FormRow>`
-   `<Modal>`

#### Billing-Specific Components

-   `<MemberRow>`
-   `<BillCard>`
-   `<PaymentMethodCard>`
-   `<BalanceDisplay>`

All new UI must use these components.

------------------------------------------------------------------------

### 6️⃣ Layout Grid Rules

Two-column dashboard layout becomes standard:

-   Left: Entities (Members)
-   Right: Configuration (Bills / Settings)

Rules: - Max content width defined. - Cards align to shared grid
baseline. - No independent column padding.

------------------------------------------------------------------------

### 7️⃣ State Design Standards

Every feature must support:

-   Default
-   Hover
-   Focus
-   Disabled
-   Loading
-   Empty state
-   Error state

Document once → reused everywhere.

------------------------------------------------------------------------

## Acceptance Criteria

-   Spacing tokens implemented and used globally.
-   Button hierarchy applied across existing screens.
-   Semantic color variables replace raw colors.
-   At least 5 shared components created and adopted.
-   Annual Summary and Settings panels migrated to shared components.
-   No new inline styling introduced.

------------------------------------------------------------------------

## Technical Tasks

-   [ ] Create `design-tokens.css`
-   [ ] Refactor colors into CSS variables.
-   [ ] Implement spacing utility classes.
-   [ ] Create reusable Card component.
-   [ ] Create StatusBadge component.
-   [ ] Replace duplicate panel markup.
-   [ ] Audit buttons and assign hierarchy.
-   [ ] Remove hardcoded spacing values.

------------------------------------------------------------------------

## Success Metrics

-   Reduced CSS duplication.
-   Faster feature UI implementation.
-   Fewer layout regressions.
-   Consistent interaction patterns across new features.

------------------------------------------------------------------------

## Design Priority

High --- must precede dispute workflows, share-link expansion, and
billing-year complexity to prevent long-term UI entropy.
