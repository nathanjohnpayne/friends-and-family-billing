# UX Improvements for Billing Admin Interface --- Jira Ticket

**Type:** UX Improvement / Product Enhancement\
**Priority:** High\
**Component:** Billing UI / Payments / Admin Dashboard\
**Epic:** Billing Experience Refinement

------------------------------------------------------------------------

## Summary

Improve usability, clarity, and workflow efficiency across the Billing
Admin Interface, focusing on:

-   Payment recording workflow
-   Payment methods & links clarity
-   Annual Summary scanability
-   Information hierarchy
-   Error prevention and mental model alignment

Current UI is functional but exhibits workflow ambiguity, mixed mental
models, and discoverability issues that will scale poorly as billing
years, disputes, and payment workflows expand.

------------------------------------------------------------------------

## Problem Statement

Observed issues across screens:

1.  Payment concepts are fragmented:

    -   "Payment Received"
    -   "Record Payment"
    -   "Payment Links"
    -   Email payment instructions

    These appear related but are visually and conceptually disconnected.

2.  Payment methods UI does not reflect real-world payment behavior:

    -   Zelle / Apple Cash are identity-based, not link-based.
    -   UI implies all payments are URLs.

3.  Annual Summary table is dense and action-heavy without hierarchy.

4.  Record Payment modal lacks confirmation clarity and context.

5.  System state (billing year, completion, balance health) is not
    visually communicated.

------------------------------------------------------------------------

## UX Goals

-   Reduce cognitive load during billing operations
-   Make payment workflows self-explanatory
-   Improve scanability for frequent admin use
-   Prevent accidental data mistakes
-   Prepare UI for disputes + share-link workflows

------------------------------------------------------------------------

## Proposed Improvements

### 1️⃣ Annual Summary --- Improve Action Hierarchy

#### Current Issues

-   Email + Share + payment icon compete equally.
-   Payment interaction is unclear.
-   Balance column visually disconnected from payment action.

#### Changes

**Convert row actions into grouped action menu**

Replace:

    Email Invoice | Share | Clipboard Icon

With:

    [ Actions ▾ ]
      • Email Invoice
      • Share Billing Link
      • Record Payment

**Why** - Reduces visual noise. - Prevents accidental clicks. - Scales
when disputes/actions increase.

------------------------------------------------------------------------

**Add payment status indicator**

Add badge:

    ● Paid
    ● Partially Paid
    ● Outstanding

Color-coded next to balance.

------------------------------------------------------------------------

**Make balance visually primary**

-   Bold typography
-   Slight background tint when non-zero.

------------------------------------------------------------------------

### 2️⃣ Record Payment Modal --- Improve Clarity & Safety

#### Observed Issues

-   Payment type dropdown hierarchy unclear.
-   No confirmation summary.
-   Distribution logic unclear.

#### Improvements

**Add payment summary preview**

    You are recording:

    $543.86 via Cash App

    Distribution:
    • John Payne — $276.12
    • Gigi Payne — $267.74

Prevents mistakes.

------------------------------------------------------------------------

**Reorder modal fields**

Recommended order:

1.  Payment Amount\
2.  Payment Method\
3.  Distribution toggle\
4.  Preview summary\
5.  Notes

------------------------------------------------------------------------

**Add method icons**

Dropdown should show:

-   💵 Cash
-   🏦 Bank Transfer
-   📱 Zelle
-   🍎 Apple Cash
-   🟩 Cash App
-   🅿 PayPal

Improves scan speed.

------------------------------------------------------------------------

### 3️⃣ Rename "Payment Links" → "Payment Methods"

#### Problem

"Payment Links" conflicts with reality of Zelle & Apple Cash.

#### Rename Section

    Payment Links

➡️

    Payment Methods

Subtitle:

> Configure how members can pay you.

------------------------------------------------------------------------

**Method Card Layout**

    Zelle
    Send to: nathan@email.com • +1 (202) 253-7070

    Apple Cash
    Send via Messages to: +1 (202) 253-7070

    Cash App
    $NathanPayne
    [Open Link]

------------------------------------------------------------------------

### 4️⃣ Email Settings --- Reduce Duplication

Payment instructions currently exist in freeform text AND payment links.

#### Improvement

Add token:

    %payment_methods%

Auto-inserts formatted payment instructions.

Removes manual maintenance.

------------------------------------------------------------------------

### 5️⃣ Family Members Panel --- Improve Information Density

#### Issues

-   Icons unclear (camera vs link).
-   Phone absence appears like an error.

#### Improvements

-   Replace "No phone" with:

        Phone not provided

-   Add hover tooltips to icons.

-   Align avatar + actions into fixed grid.

------------------------------------------------------------------------

### 6️⃣ Global State Awareness (High Impact)

Add persistent header indicators:

    Billing Year: 2026 (Open)
    Outstanding Balance: $1,243.22
    Members Paid: 6 / 8

Converts UI into operational dashboard.

------------------------------------------------------------------------

### 7️⃣ Review Requests Section --- Empty State Upgrade

Current:

> No review requests yet.

Improve:

    No review requests yet.

    Members can flag bill items from their share links.
    You'll review and approve them here.

Adds onboarding clarity.

------------------------------------------------------------------------

## Acceptance Criteria

-   Actions consolidated into contextual menus.
-   Record Payment modal includes confirmation preview.
-   Payment Links renamed to Payment Methods.
-   Zelle/Apple Cash supported without URLs.
-   Email template supports `%payment_methods%`.
-   Balance and payment state visually emphasized.
-   Empty states provide instructional guidance.

------------------------------------------------------------------------

## Success Metrics

-   Reduced admin clicks to record payment
-   Reduced payment entry errors
-   Increased share link payment completion rate
-   Reduced clarification messages from members

------------------------------------------------------------------------

## Design Priority

High --- foundational before disputes + archived years scale complexity.
