# Annual Settlement UX --- Payment Completion & Social Accountability

**Type:** UX / Behavioral Product Design\
**Priority:** High\
**Component:** Payments / Annual Settlement Flow\
**Epic:** Annual Billing Experience

------------------------------------------------------------------------

## Summary

Design and implement an **Annual Settlement Experience** that improves
payment completion rates while maintaining a friendly, social,
non-transactional tone appropriate for friends & family billing.

Unlike commercial invoicing systems, this product relies on **social
accountability** rather than enforcement. The UX should gently guide
members toward completing payments through clarity, visibility, and
progress signaling.

This ticket introduces settlement-focused UI patterns that help users
understand:

-   what remains unpaid
-   how close the group is to completion
-   what action they personally need to take

------------------------------------------------------------------------

## Background

Annual billing differs from recurring payments:

-   Users pay once per year.
-   Social relationships influence behavior more than automation.
-   Visibility and progress drive action.
-   Completion satisfaction matters psychologically.

Current UI records payments correctly but lacks a **settlement
narrative**.

------------------------------------------------------------------------

## Problem Statement

Observed risks:

1.  Payment completion lacks urgency signals.
2.  Users cannot easily see collective progress.
3.  Paid users receive no completion reinforcement.
4.  Outstanding balances are informational but not motivational.
5.  Admin lacks tools to gently nudge completion.

------------------------------------------------------------------------

## UX Goals

-   Increase payment completion rate.
-   Reduce follow-up messaging by admins.
-   Reinforce fairness and shared responsibility.
-   Create positive completion feedback.
-   Maintain non-commercial tone.

------------------------------------------------------------------------

## Proposed Improvements

------------------------------------------------------------------------

### 1️⃣ Settlement Progress Indicator (Global)

Add a progress bar visible on dashboard and share links.

Example:

    2026 Settlement Progress
    ██████████░░░░░░ 62% Complete
    5 of 8 members settled

Behavior: - Updates automatically based on balances. - Visible to admin
and members.

------------------------------------------------------------------------

### 2️⃣ Member Payment Status Badges

Add status indicator per member:

  Status    Badge
  --------- ----------------
  Paid      ✅ Settled
  Partial   🟡 Partial
  Unpaid    ⏳ Outstanding

Displayed in: - Annual Summary - Share Link - Admin dashboard

------------------------------------------------------------------------

### 3️⃣ Personal Action Callout (Share Link)

Top banner:

    You still have an outstanding balance for 2026.
    Amount Remaining: $187.32

When settled:

    ✅ You're all settled for 2026. Thank you!

Creates closure reinforcement.

------------------------------------------------------------------------

### 4️⃣ Group Completion Messaging

When majority paid:

    Almost done — only 2 members remaining.

When complete:

    🎉 Everyone is settled for 2026!

Triggers celebration moment.

------------------------------------------------------------------------

### 5️⃣ Gentle Reminder UX (Admin)

Add admin helper indicator:

    3 members still outstanding.
    Send reminder?

Future extension: - reminder email shortcut - share link resend

No automated spam --- admin remains in control.

------------------------------------------------------------------------

### 6️⃣ Payment Confirmation Feedback

After recording payment:

    Payment recorded successfully.

    Settlement Progress: 75% Complete

Immediate feedback strengthens momentum.

------------------------------------------------------------------------

### 7️⃣ Settlement Completion State

When all balances = 0:

Display banner:

    ✅ Annual settlement complete.
    All shared bills for 2026 have been resolved.

Locks emotional closure before archival.

------------------------------------------------------------------------

## Behavioral Design Principles

-   Encourage, not pressure.
-   Celebrate completion.
-   Emphasize fairness.
-   Maintain friendly tone.
-   Avoid corporate invoice language.

------------------------------------------------------------------------

## Data Dependencies

Requires:

    member.balance
    billingYear.status
    payment ledger totals

Derived metrics:

    settledMembersCount
    totalMembersCount
    settlementPercentage

------------------------------------------------------------------------

## Acceptance Criteria

-   Settlement progress visible globally.
-   Member status badges displayed consistently.
-   Share link shows personalized settlement state.
-   Completion banner appears automatically at zero balance.
-   Admin sees outstanding count indicator.
-   Payment confirmation reinforces progress.

------------------------------------------------------------------------

## Success Metrics

-   Faster average time-to-payment.
-   Reduced manual reminders.
-   Increased payment completion rate.
-   Improved user satisfaction during settlement period.

------------------------------------------------------------------------

## Design Priority

High --- transforms billing from a tracking tool into a
completion-oriented annual workflow.
