# Payments & Billing Improvements --- Jira Tickets

------------------------------------------------------------------------

## 🎫 Ticket 1 --- Add Cash App to Payment Received Menu

**Type:** Feature\
**Priority:** Medium\
**Component:** Billing / Annual Summary\
**Epic:** Payments & Billing Improvements

### Description

Extend the **Payment Received** workflow to support tracking the payment
**method** in addition to the payment amount. Add **Cash App** as a
selectable payment method.

Currently, payments are recorded only as a numeric amount
(`paymentReceived`). This change introduces a payment method selector so
payments can be categorized (Zelle, Apple Cash, Cash App, etc.).

### User Story

As an admin,\
I want to record how a payment was received,\
so I can track which services members used to pay.

### Requirements

-   Add a payment method dropdown next to the Payment Received amount
    input.
-   Include Cash App as a selectable option.
-   Persist the selected method per member.
-   Maintain backward compatibility with existing payment data.

### Data Model Changes

Add fields to each member:

    paymentMethod: string | null
    paymentMethodDetail?: string

Allowed values:

    zelle
    venmo
    paypal
    cashapp
    applecash
    other

### UI Changes

Annual Summary table:

Current:

    [ Payment Amount Input ]

New:

    [ Amount Input ] [ Method Dropdown ]

Dropdown options: - Zelle - Apple Cash - Cash App ✅ - Venmo - PayPal -
Other

### Acceptance Criteria

-   Admin can select "Cash App" as payment method.
-   Selected method persists after reload.
-   Existing members without method remain functional.
-   Updating payment amount does not reset method.
-   Method updates immediately save to Firestore.

### Tasks

-   [ ] Add `paymentMethod` field to member object.
-   [ ] Update summary table renderer.
-   [ ] Create `updatePaymentMethod(memberId, method)` handler.
-   [ ] Persist changes via existing save flow.
-   [ ] QA regression for payment totals.

------------------------------------------------------------------------

## 🎫 Ticket 2 --- Expand Payment Links into Flexible Payment Methods Configuration

**Type:** Feature\
**Priority:** High\
**Component:** Settings / Payments\
**Epic:** Payments & Billing Improvements

### Description

Replace the current single "payment link" concept with a flexible
**Payment Methods configuration system** supporting both clickable links
and contact-based payments.

Zelle and Apple Cash do not rely on URLs; they use email addresses or
phone numbers. The system must support multiple field types.

### User Story

As an admin,\
I want to configure multiple payment methods with different field
types,\
so members receive accurate payment instructions regardless of platform.

### Requirements

Support multiple payment methods with customizable fields:

#### Zelle

-   Email
-   Phone number
-   Non-clickable instructions

#### Apple Cash

-   Email or phone
-   Instructions for Messages/Wallet usage

#### Cash App / Venmo / PayPal

-   Handle or username
-   Optional clickable URL

### Data Model

    settings.paymentMethods: [
      {
        id: string,
        type: string,
        label: string,
        enabled: boolean,
        email?: string,
        phone?: string,
        handle?: string,
        url?: string,
        instructions?: string
      }
    ]

### UI Requirements

New **Payment Methods** settings section:

Admin can: - Add payment method - Enable/disable method - Edit
method-specific fields - Reorder methods (optional future enhancement)

Field visibility rules:

  Method       Fields
  ------------ ----------------------
  Zelle        email, phone
  Apple Cash   email, phone
  Cash App     handle, url
  Other        label + instructions

### Acceptance Criteria

-   Admin can configure multiple payment methods.
-   Zelle and Apple Cash work without URLs.
-   Settings persist correctly.
-   Disabled methods do not appear in invoices/share links.
-   Existing email settings remain unaffected.

### Tasks

-   [ ] Create `paymentMethods[]` schema.
-   [ ] Build settings UI section.
-   [ ] Add conditional field rendering.
-   [ ] Update save/load logic.
-   [ ] Validate phone/email formatting.
-   [ ] Migration: initialize empty array if missing.

------------------------------------------------------------------------

## 🎫 Ticket 3 --- Display Payment Instructions in Invoice & Share Link

**Type:** Feature\
**Priority:** High\
**Component:** Invoice / Share Link\
**Epic:** Payments & Billing Improvements

### Description

Update generated invoices and Share Link pages to display structured
payment instructions based on configured Payment Methods.

Instructions must correctly represent platforms that do not use
clickable links (Zelle, Apple Cash).

### User Story

As a member,\
I want clear instructions for how to pay using my preferred method,\
so I can complete payment without confusion.

### Requirements

Invoices and Share Links must include a **Payment Options** section
generated dynamically from enabled payment methods.

Rendering rules:

#### Zelle

Display:

    Send via Zelle to:
    email OR phone

#### Apple Cash

Display:

    Send Apple Cash via Messages or Wallet to:
    phone/email

#### Cash App / Venmo / PayPal

Display clickable link if URL exists.

### Example Output

    PAYMENT OPTIONS

    Zelle:
    Send to nathan@email.com or +14155551212

    Apple Cash:
    Send via Messages to +14155551212

    Cash App:
    https://cash.app/nathan

### Acceptance Criteria

-   Invoice includes payment options section.
-   Only enabled methods appear.
-   Zelle and Apple Cash render without URLs.
-   Links open correctly where applicable.
-   Formatting works in email body and Share Link UI.

### Tasks

-   [ ] Create payment options formatter utility.
-   [ ] Inject payment section into invoice generation.
-   [ ] Render payment methods on Share Link page.
-   [ ] Add copy-to-clipboard buttons for phone/email.
-   [ ] QA email formatting across mail clients.
