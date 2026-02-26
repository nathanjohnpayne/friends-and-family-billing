# Engineering Contract Spec --- Payment Methods Domain Model

**Type:** Engineering Contract / Product Specification\
**Priority:** High\
**Scope:** Payment Methods System\
**Purpose:** Prevent future implementation drift between Product Intent
and Engineering Implementation

------------------------------------------------------------------------

## Objective

Define a **canonical product contract** for the Payment Methods system
so that:

-   Product terminology matches system behavior.
-   Engineers understand domain concepts independent of UI wording.
-   Future features build on a stable model.
-   Similar misunderstandings do not recur.

This document is the **source of truth** for Payment Methods behavior.

------------------------------------------------------------------------

## Core Product Principle

    Payment Method ≠ Payment Link

A Payment Method describes **how a user can send money**, not
necessarily a URL.

Links are only one subtype.

------------------------------------------------------------------------

## Domain Definition

### Payment Method

A structured object describing instructions required for another person
to send payment.

Examples:

-   Venmo handle
-   Zelle email or phone
-   Apple Cash contact
-   PayPal link
-   Bank transfer instructions

------------------------------------------------------------------------

## Supported Method Types (v1)

  Type        Identifier Model
  ----------- -----------------------
  venmo       handle or url
  cashapp     cashtag
  paypal      url
  zelle       email and/or phone
  applecash   email or phone
  other       freeform instructions

------------------------------------------------------------------------

## Canonical Data Model

``` ts
type PaymentMethod = {
  id: string
  type: 'venmo' | 'cashapp' | 'paypal' | 'zelle' | 'applecash' | 'other'
  label: string
  enabled: boolean

  // identifiers (optional depending on type)
  handle?: string
  url?: string
  email?: string
  phone?: string

  instructions?: string

  createdAt: timestamp
  updatedAt: timestamp
}
```

------------------------------------------------------------------------

## Field Rules

  Method      Required Fields
  ----------- -----------------
  venmo       handle OR url
  cashapp     handle
  paypal      url
  zelle       email OR phone
  applecash   email OR phone
  other       instructions

Validation must occur at UI + backend.

------------------------------------------------------------------------

## Rendering Contract

### Invoice / Share Link Output

Rendering logic MUST depend on `type`, not presence of URL.

#### Example --- Zelle

    Send via Zelle to:
    email / phone

#### Example --- Apple Cash

    Send Apple Cash via Messages to:
    phone/email

#### Example --- Link-based

Clickable URL displayed.

------------------------------------------------------------------------

## UI Contract

### Add Payment Method Flow

UI must:

1.  Require selecting a method type first.

2.  Dynamically show required fields.

3.  Never require a URL unless method type needs one.

4.  Label button:

        Add Payment Method

------------------------------------------------------------------------

## Non-Goals

-   Payment processing.
-   Money storage.
-   Transaction verification.

System only provides **payment instructions**, not payment execution.

------------------------------------------------------------------------

## Backwards Compatibility

If legacy records exist:

``` ts
{ name, url }
```

Migration rule:

    type = 'other'
    instructions = url

------------------------------------------------------------------------

## Acceptance Criteria

-   Engineers reference this contract before modifying payment features.
-   UI and API align with canonical model.
-   No payment method requires irrelevant fields.
-   Invoices render correctly for non-link systems.
-   Future payment types can be added without schema redesign.

------------------------------------------------------------------------

## Ownership

-   Product owns domain definition.
-   Engineering owns implementation fidelity.
-   Changes require Product + Engineering approval.

------------------------------------------------------------------------

## Rationale

Annual billing workflows require clear payment instructions across
heterogeneous payment ecosystems. A structured domain model ensures
scalability, correctness, and user trust.
