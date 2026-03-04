# Billing Year Mental Model --- System Design & UX Alignment

**Type:** Product Architecture / UX System\
**Priority:** High\
**Component:** Billing Year Lifecycle\
**Epic:** Annual Billing Experience

------------------------------------------------------------------------

## Summary

Define and implement a consistent **Billing Year Mental Model** across
the application to establish a clear lifecycle for annual billing
workflows.

The product operates around annual reconciliation, but system states are
not yet fully formalized in UI or behavior. This ticket introduces
explicit lifecycle stages so users always understand:

-   where they are in the billing process
-   what actions are expected
-   whether billing is complete

This becomes the foundational model connecting dashboards, invoices,
payments, share links, disputes, and archives.

------------------------------------------------------------------------

## Background

The system is fundamentally **year-based**, not subscription-based.

Typical user journey:

1.  Bills accumulate throughout a year.
2.  Admin generates annual totals.
3.  Members review balances.
4.  Payments are collected.
5.  Disputes resolved.
6.  Year closes and archives.
7.  New billing year begins.

Currently, these stages exist implicitly but are not visible or enforced
consistently.

------------------------------------------------------------------------

## Problem Statement

Without a defined lifecycle:

-   Users cannot easily tell if billing is finished.
-   Admin workflows lack closure signals.
-   Payments feel transactional instead of goal-oriented.
-   Archived years risk behavioral inconsistencies.
-   Future features (disputes, reminders, reporting) lack shared state
    logic.

------------------------------------------------------------------------

## UX Goals

-   Make annual billing progress visible.
-   Provide psychological completion signals.
-   Reduce admin uncertainty.
-   Align all workflows around a shared lifecycle.
-   Enable predictable future feature expansion.

------------------------------------------------------------------------

## Billing Year Lifecycle (Proposed States)

### 1️⃣ Open

Bills are editable and totals evolve.

**Characteristics** - Bills can be added/edited. - Members adjustable. -
Payments allowed. - Disputes allowed.

UI Badge:

    Open

Color: neutral / primary.

------------------------------------------------------------------------

### 2️⃣ Settling

Invoices issued and payments being collected.

Triggered when: - First invoice generated OR - Admin marks year as
settling.

**Characteristics** - Bills locked (optional soft lock). - Payments
active. - Share links emphasized. - Review requests expected.

UI Badge:

    Settling

Color: warning / attention.

------------------------------------------------------------------------

### 3️⃣ Closed

All balances resolved.

Triggered when: - All balances = \$0 OR admin closes manually.

**Characteristics** - Payments disabled. - Disputes locked. - Year
marked complete.

UI Badge:

    Closed

Color: success (green).

------------------------------------------------------------------------

### 4️⃣ Archived

Historical reference only.

Triggered via:

    Archive Year

**Characteristics** - Fully read-only. - Hidden from primary
workflows. - Accessible via year selector.

UI Badge:

    Archived

Color: muted.

------------------------------------------------------------------------

## UI Implementation

------------------------------------------------------------------------

### Global Header Indicator

Display everywhere:

    Billing Year: 2026 — Settling

Includes colored status badge.

------------------------------------------------------------------------

### Dashboard Progress Indicator

Add lifecycle progress bar:

    Open → Settling → Closed → Archived

Current stage highlighted.

------------------------------------------------------------------------

### Annual Summary Behavior

  State      Behavior
  ---------- ------------------------
  Open       Editable totals
  Settling   Highlight balances
  Closed     Show completion banner
  Archived   Read-only view

------------------------------------------------------------------------

### Completion Banner (Closed State)

Display:

    ✅ All balances settled for 2026.
    This billing year is complete.

Creates psychological closure.

------------------------------------------------------------------------

### Archive Confirmation Modal

    Archive 2026 Billing Year?

    This will make all records read-only.
    You can still view historical data later.

------------------------------------------------------------------------

## Data Model Changes

Add to billing year document:

    status: 'open' | 'settling' | 'closed' | 'archived'
    statusUpdatedAt: timestamp

Optional:

    closedAt
    archivedAt

------------------------------------------------------------------------

## Automation Rules (Optional v1.1)

-   Auto-suggest **Closed** when balances reach zero.
-   Notify admin: "Ready to close billing year."

------------------------------------------------------------------------

## Acceptance Criteria

-   Billing year status visible globally.
-   Lifecycle states implemented consistently.
-   UI behavior changes based on state.
-   Archive makes year read-only.
-   Closed state shows completion confirmation.
-   Share links respect lifecycle restrictions.

------------------------------------------------------------------------

## Success Metrics

-   Reduced admin uncertainty about billing completion.
-   Faster end-of-year settlement.
-   Increased perception of system organization.
-   Fewer accidental edits to completed years.

------------------------------------------------------------------------

## Design Priority

Critical --- establishes foundational product mental model enabling
disputes, reminders, reporting, and multi-year scaling.
