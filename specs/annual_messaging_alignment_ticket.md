# Annual Billing Messaging Alignment Across Application

**Type:** UX / Product Consistency\
**Priority:** High\
**Component:** Global UI / Copy / Information Architecture\
**Epic:** Annual Billing Experience

------------------------------------------------------------------------

## Summary

Align all product messaging, labels, and contextual copy across the
application to consistently reinforce that the system is designed for
**annual billing coordination**.

The application currently mixes generic subscription-management language
with annual billing workflows. This creates subtle cognitive friction
and weakens the user's mental model of the product.

This ticket introduces a unified **Annual Billing Narrative** across
login, dashboard, invoices, share links, payments, and review workflows.

------------------------------------------------------------------------

## Background

Users primarily interact with the system:

-   once or twice per year
-   when annual bills are generated
-   when reviewing shared billing summaries
-   when making annual payments

Because engagement is infrequent, users rely heavily on contextual cues
to understand:

-   why they are here
-   what action is expected
-   whether this is legitimate and secure

The UI must continuously reinforce:

> "You are reviewing and settling annual shared bills."

------------------------------------------------------------------------

## Problem Statement

Current experience issues:

1.  Messaging varies between screens (generic vs annual context).
2.  Dashboard feels like ongoing subscription management rather than
    yearly reconciliation.
3.  Actions such as "Generate Invoice" lack annual framing.
4.  Share links and payments do not consistently reference annual
    summaries.
5.  Users arriving from invoices may feel disoriented after login.

------------------------------------------------------------------------

## UX Goals

-   Reinforce annual workflow everywhere.
-   Reduce confusion for infrequent users.
-   Improve trust and legitimacy perception.
-   Improve invoice → login → payment completion.
-   Create a cohesive product narrative.

------------------------------------------------------------------------

## Annual Messaging Principles

All copy should reflect:

-   Annual review
-   Annual totals
-   Year-based organization
-   Settlement of shared expenses

Avoid implying continuous billing management.

------------------------------------------------------------------------

## Proposed Changes

------------------------------------------------------------------------

### 1️⃣ Global Header Messaging

Update subtitle across authenticated pages.

#### Current

    Split bills effortlessly with the people who matter most

#### Replace With

    Review and settle shared bills for the current billing year.

------------------------------------------------------------------------

### 2️⃣ Dashboard Context Banner

Add persistent contextual indicator:

    Billing Year: 2026 (Open)
    Review annual totals and record payments below.

Displayed beneath page header.

------------------------------------------------------------------------

### 3️⃣ Annual Summary Section Copy

Rename and clarify intent.

#### Update helper text:

    Each member’s total responsibility for this billing year.

Add explanatory tooltip:

    Annual totals are calculated from shared monthly bills across the year.

------------------------------------------------------------------------

### 4️⃣ Invoice Language Alignment

Ensure generated invoices consistently use:

-   "Annual Billing Summary"
-   "Annual Amount Due"
-   "Billing Year"

Remove ambiguous phrases like: - "payment summary" - "subscription
total"

------------------------------------------------------------------------

### 5️⃣ Share Link Messaging

Top of share link page:

    You are viewing your annual shared billing summary for {YEAR}.

Add contextual action cue:

    Please review your balance and submit payment using the methods below.

------------------------------------------------------------------------

### 6️⃣ Payment Flow Messaging

Record Payment modal header:

#### Replace:

    Record Payment

#### With:

    Record Annual Payment

Add context line:

    Payments apply toward this billing year's balance.

------------------------------------------------------------------------

### 7️⃣ Review Requests Language

Update section description:

    Bill items flagged during annual review.

Empty state:

    No review requests yet.
    Members can flag items while reviewing their annual billing summary.

------------------------------------------------------------------------

### 8️⃣ Login Page Alignment

Ensure login messaging references annual purpose:

    Access your annual billing summary securely.

Supports infrequent-user recognition.

------------------------------------------------------------------------

### 9️⃣ Email Templates

Introduce tokens:

    %billing_year%
    %annual_total%

Default email message example:

    Your annual billing summary for %billing_year% is ready.

------------------------------------------------------------------------

## Acceptance Criteria

-   All primary screens reference annual billing context.
-   Terminology consistent across UI, emails, and share links.
-   Dashboard clearly communicates billing-year scope.
-   Payment and invoice flows reference annual totals.
-   No remaining generic subscription-management language.

------------------------------------------------------------------------

## Success Metrics

-   Reduced user clarification questions.
-   Faster payment completion after login.
-   Improved comprehension for first-time invite recipients.
-   Lower support friction during annual billing cycles.

------------------------------------------------------------------------

## Design Priority

High --- messaging consistency must precede expanded workflows
(disputes, archived years, attachments) to maintain a coherent mental
model.
