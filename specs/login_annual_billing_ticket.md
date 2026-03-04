# Login Experience Optimization --- Annual Billing Context

**Type:** UX Improvement / Product Enhancement\
**Priority:** High\
**Component:** Authentication / Onboarding\
**Epic:** Billing Experience Refinement

------------------------------------------------------------------------

## Summary

Refine the login experience to better reflect the product's **annual
billing coordination purpose**.\
The current login screen is visually polished but communicates a generic
SaaS login rather than an **annual billing management tool** where users
typically:

-   log in infrequently (once or twice per year)
-   arrive via invoice or share links
-   need immediate reassurance about billing context and trust

This ticket aligns authentication UX with real user behavior in an
annual billing workflow.

------------------------------------------------------------------------

## Problem Statement

Annual billing systems differ from daily-use apps:

-   Users forget credentials between billing cycles.
-   Most sessions originate from invoices or shared billing links.
-   Trust and context matter more than speed.
-   Users need confirmation they are accessing the *correct billing
    workspace*.

Current issues:

1.  Login messaging is generic and not billing-contextual.
2.  Authentication options compete equally, increasing decision
    friction.
3.  No reassurance about financial data safety.
4.  No contextual entry point for invited users reviewing annual bills.
5.  Screen does not reinforce the yearly workflow mental model.

------------------------------------------------------------------------

## UX Goals

-   Reduce friction for infrequent annual users.
-   Reinforce billing trust and legitimacy.
-   Make authentication feel tied to annual billing events.
-   Support future share-link and invite flows.
-   Improve conversion from invoice → login → payment.

------------------------------------------------------------------------

## Proposed Improvements

------------------------------------------------------------------------

### 1️⃣ Reframe Page Messaging Around Annual Billing

#### Current Subtitle

    Split bills effortlessly with the people who matter most

#### Replace With

    Review and manage your annual shared bills securely.

Reason: - Clarifies purpose immediately. - Matches user intent when
arriving from invoices.

------------------------------------------------------------------------

### 2️⃣ Establish Google Sign‑In as Primary Action

Annual users prefer lowest-friction login.

#### Change Hierarchy

    Continue with Google   ← Primary

    or sign in with email
    ---------------------
    Email
    Password
    Sign In

Move account creation to secondary text link:

    New here? Create an account

Benefits: - Faster yearly re-entry. - Reduced password reset events.

------------------------------------------------------------------------

### 3️⃣ Add Annual Billing Context Banner

Add contextual helper text above authentication:

    Access your annual billing summary and payment details.

Future-ready for: - invoice deep links - share links - dispute review
flows

------------------------------------------------------------------------

### 4️⃣ Introduce Trust & Security Messaging

Billing apps require reassurance.

Add muted footer text:

    Secure authentication powered by Google & Firebase.
    Your billing information is private and encrypted.

Expected outcome: - Increased login confidence. - Reduced abandonment.

------------------------------------------------------------------------

### 5️⃣ Prepare for Invite-Based Entry (Future Compatibility)

Reserve space for contextual messaging:

Example future state:

    Nathan shared an annual billing summary with you.
    Sign in to review your balance.

Implementation: - Add optional message container above auth buttons.

------------------------------------------------------------------------

### 6️⃣ Improve Infrequent-User Recovery

Annual users commonly forget passwords.

Add: - "Forgot password?" link under password field. - Inline error
guidance:

    This account may have been created using Google Sign‑In.

------------------------------------------------------------------------

### 7️⃣ Visual Hierarchy Adjustments

-   Reduce logo size slightly (\~10--15%).
-   Increase headline prominence.
-   Ensure primary action visually dominates.

Goal: Action clarity \> branding emphasis.

------------------------------------------------------------------------

## Acceptance Criteria

-   Login copy reflects annual billing use case.
-   Google sign-in visually primary.
-   Email login clearly secondary.
-   Trust messaging added.
-   Invite/context banner supported.
-   Password recovery visible.
-   Layout supports future share-link entry states.

------------------------------------------------------------------------

## Success Metrics

-   Increased login completion rate from invoice links.
-   Reduced password reset requests.
-   Faster time-to-payment after login.
-   Reduced user confusion during annual billing cycles.

------------------------------------------------------------------------

## Design Priority

High --- authentication must align with annual billing behavior before
share links, disputes, and archived-year workflows launch.
