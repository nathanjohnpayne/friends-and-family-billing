# 🐞 Bug --- Payment Methods System Still Implemented as "Links" Instead of Structured Methods

**Type:** Bug\
**Priority:** High\
**Component:** Payment Methods / Settings / Invoices / Share Links\
**Epic:** Annual Billing Experience\
**Reported By:** Product

------------------------------------------------------------------------

## Summary

The **Payment Methods** feature was implemented as a simple list of URLs
("Payment Links"), which does **not match the updated product
specification**.

The system must support **identity-based payment methods** (Zelle, Apple
Cash) in addition to URL-based methods.

Current implementation incorrectly assumes all payment methods are
clickable links.

------------------------------------------------------------------------

## Expected Behavior (Product Spec)

Payment Methods represent **how users pay**, not just links.

Some payment systems do **not** use URLs:

  Method       Requires URL   Requires Email   Requires Phone
  ------------ -------------- ---------------- ----------------
  Venmo        ❌             ❌               ❌
  Cash App     ❌             ❌               ❌
  PayPal       ❌             ❌               ❌
  Zelle        ❌             ✅               ✅
  Apple Cash   ❌             ✅               ✅

The UI and data model must support all identifier types.

------------------------------------------------------------------------

## Actual Behavior (Current Build)

The UI still behaves as:

    Name + URL → Add Link

Observed issues:

1.  Section label updated to **Payment Methods**, but functionality
    remains "Payment Links".
2.  Cannot configure Zelle properly (no phone/email fields).
3.  Cannot configure Apple Cash properly.
4.  Forces fake URLs for non-link payment systems.
5.  Invoice/share-link rendering cannot distinguish payment types.
6.  Product terminology and system behavior are inconsistent.

------------------------------------------------------------------------

## Why This Is a Bug (Not Enhancement)

Product requirements already changed:

-   Payment Links → Payment Methods (conceptual change)
-   System must support annual billing workflows
-   Payment instructions must render correctly in invoices/share links

Current implementation violates approved product model and blocks
correct invoice generation.

------------------------------------------------------------------------

## Root Cause

Implementation reused previous schema:

``` js
{ name, url }
```

instead of required structured schema.

------------------------------------------------------------------------

## Required Fix

### 1️⃣ Update Data Model

Replace:

``` js
paymentLinks: [
  { name: string, url: string }
]
```

With:

``` js
paymentMethods: [
  {
    id: string,
    type: 'venmo' | 'cashapp' | 'paypal' | 'zelle' | 'applecash' | 'other',
    label: string,
    enabled: boolean,
    handle?: string,
    url?: string,
    email?: string,
    phone?: string,
    instructions?: string
  }
]
```

------------------------------------------------------------------------

### 2️⃣ Update UI

Replace "Add Link" row with dynamic method form.

Field rules:

  Method       Fields
  ------------ ----------------
  Venmo        handle OR url
  Cash App     cashtag
  PayPal       url
  Zelle        email + phone
  Apple Cash   email OR phone

UI must change fields based on selected method type.

------------------------------------------------------------------------

### 3️⃣ Rendering Rules (Invoices + Share Links)

Display based on method type:

**Zelle**

    Send via Zelle to:
    email / phone

**Apple Cash**

    Send Apple Cash via Messages to:
    phone/email

**Link-based** Show clickable URL.

------------------------------------------------------------------------

### 4️⃣ Rename Button

Change:

    Add Link

→

    Add Payment Method

------------------------------------------------------------------------

## Acceptance Criteria

-   Zelle and Apple Cash can be configured without URLs.
-   UI adapts fields based on payment type.
-   Existing link-based methods still work.
-   Invoices render correct instructions per method.
-   Share links display non-link payment instructions correctly.
-   No fake URLs required.

------------------------------------------------------------------------

## Severity Justification

High because:

-   Breaks core annual settlement workflow.
-   Causes incorrect payment instructions.
-   Creates user confusion.
-   Contradicts product terminology already visible in UI.

------------------------------------------------------------------------

## Notes for Engineering

This is a **domain-model correction**, not a styling change.

Conceptual model:

    Payment Method ≠ Link

Links are only one subtype.
