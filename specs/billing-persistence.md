---
spec_id: billing-persistence
---

# Billing Persistence

Covers data serialization, normalization, initial data construction, save queue ordering, and legacy script.js billing operations persisted via Firestore.

## Test Coverage

- `tests/react/lib/persistence.test.js`
- `tests/react/lib/SaveQueue.test.js`
- `tests/billing.test.js`

## Acceptance Criteria

### Save Payload Construction

- `buildSavePayload` includes all top-level fields: label, status, familyMembers, bills, payments, billingEvents, and settings.
- QR codes are stripped from payment methods in the payload and replaced with a `hasQrCode: true` flag; the original settings object is not mutated.

### Year Data Normalization

- `normalizeYearData` applies defaults to members missing fields (empty string for email/phone/avatar, 0 for paymentReceived, empty array for linkedMembers).
- Bills missing fields get defaults (empty string for logo/website, empty array for members, "monthly" for billingFrequency).
- The year object receives fallback values for id, label ("open" status, null archivedAt).
- Missing payments and billingEvents arrays are initialized as empty arrays.

### Initial Year Data

- `buildInitialYearData` creates a year with the given label, "open" status, empty familyMembers, bills, and payments arrays, and the provided settings object.

### SaveQueue

- Writes execute in strict FIFO order, even when earlier writes are slower.
- Subscribers are notified with `save:start` and `save:success` events on successful writes.
- Failed writes emit `save:error` and do not block subsequent writes in the queue.
- The `saving` property accurately reflects whether a write is in progress.
- Unsubscribing stops further notifications.

### Legacy Script Billing Operations

- `escapeHtml` returns empty string for falsy input and escapes all HTML special characters (`<`, `>`, `"`, `&`, `'`).
- `calculateAnnualSummary` (legacy) splits bills evenly among assigned members, excludes unassigned members, accumulates across multiple bills, and handles bills with no assigned members.
- `recordPayment` (legacy) appends payment entries to the ledger, tracks via `getPaymentTotalForMember`, and rejects non-positive amounts.
