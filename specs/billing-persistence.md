---
spec_id: billing-persistence
---

# Billing Persistence

Covers data serialization, normalization, initial data construction, and save queue ordering for the billing-year document. The React SPA is the sole reader and writer of that document, so its `buildSavePayload` allowlist is the canonical schema (ADR 0008).

## Test Coverage

- `tests/react/lib/persistence.test.js`
- `tests/react/lib/SaveQueue.test.js`

## Acceptance Criteria

### Save Payload Construction

- `buildSavePayload` includes all top-level fields: label, status, closedAt, archivedAt, familyMembers, bills, payments, creditAdjustments, owedAdjustments, billingEvents, and settings.
- `closedAt` (#326) is threaded from `currentBillingYear.closedAt` and defaults to null. It is written by the status-transition merge path (`setYearStatus('closed')` via a `setDoc` merge), so it must be in the allowlist or the next full-document save (`setDoc` without merge) silently erases it—the same reasoning that keeps `archivedAt`, `creditAdjustments`, and `owedAdjustments` in the payload. With the React SPA as the sole writer the allowlist *is* the schema (ADR 0008), so a closed year's document round-trips losslessly through load → save.
- `creditAdjustments` (refunds + carried-forward credits, #316) is preserved verbatim and defaults to an empty array when omitted. Because `save()` writes with `setDoc` and no merge, an omitted field is erased from the document; preserving `creditAdjustments` keeps the load → save round-trip lossless.
- The reversal-after-refund warning (#331) is display/confirmation only and persists nothing of its own: `reversePayment` is unchanged (it still appends a negative reversal entry and marks the original `reversed`, never a physical delete), and the household's `type: 'refund'` `creditAdjustments[]` record is left in place — append-only, never auto-clawed-back by a reversal. A reversed-then-refunded household therefore round-trips with both the reversal ledger entry and the intact refund adjustment.
- `owedAdjustments` (Usage Charges, #317 — signed owed-modifiers) is preserved verbatim and defaults to an empty array when omitted, for the same reason: a full-document save would otherwise erase it.
- QR codes are stripped from payment methods in the payload and replaced with a `hasQrCode: true` flag; the original settings object is not mutated.

### Year Data Normalization

- `normalizeYearData` applies defaults to members missing fields (empty string for email/phone/avatar, 0 for paymentReceived, empty array for linkedMembers).
- Bills missing fields get defaults (empty string for logo/website, empty array for members, "monthly" for billingFrequency).
- The year object receives fallback values for id, label, "open" status, and null `archivedAt`/`closedAt`; a present `closedAt` is loaded through so the closed-year document round-trips.
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

### Cloud Function Helpers (refund confirmation, #319)

The pure helpers backing the `submitRefundConfirmation` Cloud Function (exported via `functions/index.js` `_testHelpers`):

- `REFUND_NOTICE_KIND` equals `'refund_notice'`, matching the client substrate discriminator.
- `validateRefundConfirmationInput` accepts only a non-empty string `noticeId` plus an `outcome` of `confirm` or `not_received`; it rejects a missing/non-string id, a missing outcome, and any other outcome value (so a member can never write the Review Request vocabulary or an arbitrary field).
- `filterMemberRefundNotices` returns only `refund_notice` docs whose `memberId` matches the token member (ADR 0005 per-member scope—no household expansion), excludes Review Requests (kind-less docs), returns an empty array when the member has none, and projects only presentational fields (notably never leaking `tokenHash`).
