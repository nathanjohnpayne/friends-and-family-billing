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

- `buildSavePayload` includes all top-level fields: label, status, familyMembers, bills, payments, creditAdjustments, owedAdjustments, billingEvents, and settings.
- `creditAdjustments` (refunds + carried-forward credits, #316) is preserved verbatim and defaults to an empty array when omitted. Because `save()` writes with `setDoc` and no merge, an omitted field is erased from the document; preserving `creditAdjustments` keeps the load → save round-trip lossless.
- The reversal-after-refund warning (#331) is display/confirmation only and persists nothing of its own: `reversePayment` is unchanged (it still appends a negative reversal entry and marks the original `reversed`, never a physical delete), and the household's `type: 'refund'` `creditAdjustments[]` record is left in place — append-only, never auto-clawed-back by a reversal. A reversed-then-refunded household therefore round-trips with both the reversal ledger entry and the intact refund adjustment.
- `owedAdjustments` (Usage Charges, #317 — signed owed-modifiers) is preserved verbatim and defaults to an empty array when omitted, for the same reason: a full-document save would otherwise erase it.
- QR codes are stripped from payment methods in the payload and replaced with a `hasQrCode: true` flag; the original settings object is not mutated.

### Year Data Normalization

- `normalizeYearData` applies defaults to members missing fields (empty string for email/phone/avatar, 0 for paymentReceived, empty array for linkedMembers).
- Bills missing fields get defaults (empty string for logo/website, empty array for members, "monthly" for billingFrequency).
- The year object receives fallback values for id, label ("open" status, null archivedAt).
- Missing payments, creditAdjustments, owedAdjustments, and billingEvents arrays are initialized as empty arrays; a present `creditAdjustments` or `owedAdjustments` array is loaded through to state.

### Initial Year Data

- `buildInitialYearData` creates a year with the given label, "open" status, empty familyMembers, bills, payments, creditAdjustments, and owedAdjustments arrays, and the provided settings object.

### SaveQueue

- Writes execute in strict FIFO order, even when earlier writes are slower.
- Subscribers are notified with `save:start` and `save:success` events on successful writes.
- Failed writes emit `save:error` and do not block subsequent writes in the queue.
- The `saving` property accurately reflects whether a write is in progress.
- Unsubscribing stops further notifications.
- **Rollover writes are atomic and queue-serialized (#330 P1).** `BillingYearService.createYear` does not write the new-year seed and the prior-year carry marking as two independent `setDoc` calls. It builds both payloads, then commits them as a single Firestore `writeBatch` **inside** `this._saveQueue.enqueue(...)`. The queue placement serializes the rollover **behind** any pending full-document save of the prior/active year (so a queued pre-carry save lands first and the carry-marked full-document write then supersedes it, never the reverse — no lost `carry_forward` records or `deferred`→`carried_forward` status transitions). The batch makes the two writes atomic: if the prior-year write fails, the new-year doc is never created, so a retry of the same label cannot collide with a half-written rollover (which would otherwise throw duplicate while the old year still held the undisposed credit/charge). Because the SaveQueue swallows write errors (it only notifies `save:error` listeners), `createYear` captures any `batch.commit()` failure inside the enqueued function and re-throws it after the enqueue settles, so the failure rejects `createYear` and the subsequent `_loadYearsList()` + `switchYear()` are skipped rather than switching into a non-existent year.

### Legacy Script Billing Operations

- `escapeHtml` returns empty string for falsy input and escapes all HTML special characters (`<`, `>`, `"`, `&`, `'`).
- `calculateAnnualSummary` (legacy) splits bills evenly among assigned members, excludes unassigned members, accumulates across multiple bills, and handles bills with no assigned members.
- `recordPayment` (legacy) appends payment entries to the ledger, tracks via `getPaymentTotalForMember`, and rejects non-positive amounts.
- The legacy `/site/` app and the React app share the same billing-year documents, so both must round-trip `creditAdjustments` losslessly (consumer parity). Legacy `loadBillingYearData` loads `normalized.creditAdjustments` into state and `saveData` passes it to `buildSavePayload`; because the legacy save also writes with a full-document `set()`, omitting it would erase existing disposition records.
- The same consumer-parity rule applies to `owedAdjustments` (Usage Charges, #317): legacy `loadBillingYearData` loads `normalized.owedAdjustments` into state (and resets it to `[]` on the missing-year branch), `saveData` passes it to `buildSavePayload`, and the `_set`/`_get` accessors round-trip it; omitting it from the full-document `set()` would erase existing usage charges.
- **Carry-forward parity (#322).** The legacy `startNewYear` mirrors the React `createYear` carry-forward seam: it computes the prior year's carry summary (`buildCarryForwardSummary`), seeds the new year doc with `carry_opening` opening-balance records (via `buildNewYearData`), and — when anything carried — marks the prior year append-only (`applyCarryForwardToPriorYear`). The new-year seed and the prior-year marking are committed **atomically in a single compat `db.batch()`** (#330 P1, dual-app parity): a prior-year write failure can never leave the new year seeded while the old year still holds the undisposed credit/charge (which would make a retry of the same label throw duplicate). The legacy app has no save queue, so the React queue-serialization concern does not apply to it; only the atomicity (batch) guarantee does. The `activeBillingYear` pointer update is a separate `set(..., { merge: true })` after the batch commits. Because the new-year `carry_opening` records live in `owedAdjustments[]`, they round-trip through the legacy save payload for free (a full-document `set()` would otherwise drop them), keeping the shared billing-year document consistent across both apps. The legacy `closeCurrentYear` confirmation likewise states the carry-forward amount and member count via the optional `carry` argument to `buildCloseYearMessage`.

### Cloud Function Helpers (refund confirmation, #319)

The pure helpers backing the `submitRefundConfirmation` Cloud Function (exported via `functions/index.js` `_testHelpers`):

- `REFUND_NOTICE_KIND` equals `'refund_notice'`, matching the client substrate discriminator.
- `validateRefundConfirmationInput` accepts only a non-empty string `noticeId` plus an `outcome` of `confirm` or `not_received`; it rejects a missing/non-string id, a missing outcome, and any other outcome value (so a member can never write the Review Request vocabulary or an arbitrary field).
- `filterMemberRefundNotices` returns only `refund_notice` docs whose `memberId` matches the token member (ADR 0005 per-member scope—no household expansion), excludes Review Requests (kind-less docs), returns an empty array when the member has none, and projects only presentational fields (notably never leaking `tokenHash`).
