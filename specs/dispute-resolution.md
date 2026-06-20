---
spec_id: dispute-resolution
---

# Dispute Resolution

Covers the dispute (review request) lifecycle: loading, creating, updating, resolving, rejecting, and evidence management, plus the admin review UI and detail dialog.

## Test Coverage

- `tests/react/hooks/useDisputes.test.jsx`
- `tests/react/components/DisputeDetailDialog.test.jsx`
- `tests/react/views/ReviewsTab.test.jsx`
- `tests/react/hooks/useRefundNotices.test.jsx`
- `tests/react/views/RefundNoticesTab.test.jsx`
- `tests/react/lib/refundNotice.test.js`

## Acceptance Criteria

### useDisputes Hook

- Returns empty disputes and does not call Firestore when user or activeYear is null.
- Excludes `kind: 'charge_notice'` documents (Charge Notices, #320) from the loaded disputes. Charge Notices ride the shared `disputes` subcollection but are outbound Requests, not Review Requests, so they must never reach the "Open Reviews" KPI or the actionable review filter (ADR 0002, ADR 0005). The member contests a billed (or deferred) charge via the existing Review Request path, not by seeing the Charge Notice as one.
- Normalizes legacy dispute statuses via `normalizeDisputeStatus` (e.g., "dispute" becomes "open", "reviewed" becomes "in_review").
- Sorts disputes by `createdAt` descending, handling ISO strings, Firestore Timestamps, and missing dates (treated as epoch 0, sorted last).
- Sets error state with the error message when Firestore getDocs rejects.
- `updateDispute` calls `setDoc` with the correct Firestore document path, `merge: true`, `serverTimestamp` on `updatedAt`, and optimistically updates the local disputes array.
- `updateDispute` is a no-op when user/activeYear is unavailable.

### Evidence Management

- `uploadEvidence` rejects files with invalid types (only PDF, PNG, JPEG allowed) with an appropriate error message.
- Rejects files exceeding 20 MB with a size error.
- Rejects uploads when the dispute already has 10 evidence items.
- On success: calls `uploadBytes`, gets the download URL, updates Firestore with a new evidence entry containing name, contentType, size, downloadUrl, storagePath, and uploadedAt; optimistically updates local state.
- Gracefully handles `getDownloadURL` failure by setting downloadUrl to empty string.
- `uploadEvidence` is a no-op when the dispute ID is not found.
- `removeEvidence` deletes the file from Storage and updates Firestore with the filtered evidence array.
- Gracefully handles Storage deletion failure (still updates Firestore).
- `removeEvidence` is a no-op when evidence array is missing or index is out of bounds.
- `reload` triggers a fresh load from Firestore.
- Supports PNG and JPEG uploads in addition to PDF.

### DisputeDetailDialog Component

- Renders nothing when `open` is false or `dispute` is null.
- Shows bill name, status label, member name, message, and proposed correction for open disputes.
- Resolve without note: shows error message and does not call `onStatusChange`.
- Reject without note: shows error message and does not call `onStatusChange`.
- Resolve with note: shows confirmation dialog, then calls `onStatusChange` with "resolved" status, resolution note, resolvedAt timestamp, and closes the dialog.
- Reject with note: shows confirmation dialog, then calls `onStatusChange` with "rejected" status, resolution note, rejectedAt timestamp, and closes the dialog.
- "Mark In Review" calls `onUpdate` with "in_review" status and does NOT close the dialog.
- User review checkbox: checking calls `onUpdate` with `userReview: { state: 'requested' }`; unchecking calls with `userReview: null`.
- Evidence upload: file input triggers `onUploadEvidence` with dispute ID and file.
- Evidence remove: calls `onRemoveEvidence` with dispute ID and index.
- Terminal states (resolved/rejected): hides action buttons (Resolve, Reject, Mark In Review), shows Close button, hides Upload Evidence button, disables resolution note textarea.
- Resolved state shows share actions (Email, Text, Copy) conditioned on member contact info; Copy writes resolution and bill name to clipboard.
- User review checkbox is hidden in terminal states.
- Confirmation dialog cancel does not trigger `onStatusChange`.
- "Mark In Review" only appears for open disputes, not for in_review disputes.
- Error message clears when user starts typing in the resolution note.
- Evidence view: clicking "View" on evidence with storagePath resolves via `getDownloadURL` and opens in a new tab.
- Note error is cleared on typing.

### Email Notifications

- When a member submits a dispute from the share page, the admin receives an email with the bill name, member name, message, and a link to the Reviews tab.
- When the admin changes a dispute's status (In Review, Resolved, Rejected), the member receives an email with the new status and resolution note.
- When a member approves or rejects the admin's resolution, the admin receives an email with the decision and any rejection note.
- When a member rejects a resolution (reopening the dispute), they receive a confirmation email with their rejection note and (if available) a link to their share page.
- Automated terminal status emails write `resolutionNotificationSentAt` to the dispute. The manual Email button shows "Re-send Email" with a hint when this field is present.
- Email failures never block the primary action (dispute submission, status change, or user decision).
- The share page submits disputes and records member decisions via the `/submitDispute` and `/submitDisputeDecision` Cloud Functions (not direct Firestore writes).
- `resolveShareToken` projects the member's disputes for the share view via `projectMemberDisputes` (`functions/billing.js`), which **excludes** `kind: 'charge_notice'` documents (#320) — mirroring the client-side `useDisputes` exclusion — and normalizes legacy statuses, exposing only member-safe review fields. A Charge Notice is therefore never surfaced to the member as a Review Request; the member contests the charge by opening a Review Request instead.

### ReviewsTab View

- Renders dispute count in the header ("Review Requests (3)").
- Renders filter bar with actionable counts (open + in_review).
- Shows dispute cards with bill name, status, evidence badge (e.g., "1 file"), message excerpt, and proposed correction.
- Default filter shows only actionable disputes (open + in_review); resolved disputes are hidden.
- "All" filter shows all disputes including resolved.
- Clicking a card opens the detail dialog with a resolution note textarea.
- Shows empty state ("No review requests") when no disputes exist.
- Shows loading state ("Loading...") when loading.
- Shows error state with the error message when an error occurs.

### Refund Notices (#319)

A Refund Notice is an administrator-initiated, **outbound** Request announcing a
returned credit. It rides the same `disputes` subcollection as a distinct `kind`
(`refund_notice`, ADR 0002) and uses its own confirmation vocabulary
(`confirmed_by_member` / `not_received`)—never the Review Request's
`approved_by_user` / `rejected_by_user`. The household's `creditAdjustment` (#318)
stays the financial source of truth; the notice holds a presentational snapshot
plus the `creditAdjustmentId`.

- `refundNotice.js` helpers: `isRefundNotice` is true only when `kind === 'refund_notice'`; `buildRefundNoticeDoc` stamps the kind, a null `confirmation`, the snapshot fields, and the required `creditAdjustmentId` (throwing if absent); `isActiveNotReceived` is true only for an unresolved `not_received`; `reopenedCreditAdjustmentIds` returns the set of `creditAdjustmentId`s carried by active, unresolved `not_received` notices (the credits ADR 0003 re-opens while the year is open); `buildRefundNoticeEmail` includes the reason, amount, method, and a confirm link (falling back to "contact the account owner" when no link is available).
- `useDisputes` **excludes** `refund_notice` docs so Refund Notices never reach the Review Request UI, the Open Reviews KPI, or the actionable review filter.
- `useRefundNotices` loads **only** `refund_notice` docs, sorted by `createdAt` descending, exposes `activeNotReceivedCount` (active, unresolved `not_received` only), and a `resolveNotice(noticeId, resolution)` mutation that writes a `resolution` record (`merge: true`, `serverTimestamp`) and optimistically updates local state. It returns empty and skips Firestore when user/activeYear is unavailable, and surfaces the error message when getDocs rejects.
- **RefundNoticesTab** renders each notice with amount, member, payment method, and a confirmation badge (Sent / Confirmed / Not Received). An active `not_received` raises a follow-up banner counting the open reports and offers three resolution actions: **Re-send** (`type: 'resent'`), **Cancel** (`type: 'cancelled'`), and **Dismiss** (`type: 'dismissed'`, which requires a logged reason via prompt and is aborted if the prompt is cancelled). Confirmed and pending notices show no resolution actions; a resolved notice shows a "Resolved (type)" line. Empty, loading, and error states render. A `confirmed_by_member` response is advisory and changes no totals; an active `not_received` re-opens the household credit only while the year is open and never reopens a closed year (ADR 0003, ADR 0007).
- Issuing a refund records the authoritative `creditAdjustment` (#318) and then fires a Refund Notice keyed to that `creditAdjustmentId` as a non-blocking follow-up; a failure in the notice/email path never blocks the refund.
- **Open-year credit re-open (ADR 0003):** while the year is open, an active, unresolved `not_received` re-opens its household's credit — the dashboard "Owed to Members" KPI and the household's credit box surface the refunded amount as owed again, because the member reports the money never arrived. The Dashboard feeds `reopenedCreditAdjustmentIds(refundNotices)` into `calculateSettlementMetrics` and the Settlement Board; resolving the notice (re-send / cancel / dismiss) clears the re-open. This re-open touches only the credit axis — never `totalOutstanding`, settlement progress, or the persisted ledger (see billing-calculations spec) — and a read-only year passes no re-open set, so a `not_received` after close never reanimates a frozen year (ADR 0007). The Record-Payment refund cap is computed without the re-open, so a still-unconfirmed refund cannot be double-issued.
