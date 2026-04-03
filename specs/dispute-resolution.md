---
spec_id: dispute-resolution
---

# Dispute Resolution

Covers the dispute (review request) lifecycle: loading, creating, updating, resolving, rejecting, and evidence management, plus the admin review UI and detail dialog.

## Test Coverage

- `tests/react/hooks/useDisputes.test.jsx`
- `tests/react/components/DisputeDetailDialog.test.jsx`
- `tests/react/views/ReviewsTab.test.jsx`

## Acceptance Criteria

### useDisputes Hook

- Returns empty disputes and does not call Firestore when user or activeYear is null.
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
