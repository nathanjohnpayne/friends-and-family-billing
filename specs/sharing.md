---
spec_id: sharing
---

# Sharing

Covers share link generation, token validation, the share link dialog, and the public-facing share view for family members.

## Test Coverage

- `tests/react/lib/share.test.js`
- `tests/react/components/ShareLinkDialog.test.jsx`
- `tests/react/views/ShareView.test.jsx`

## Acceptance Criteria

### Share Helpers

- `buildShareScopes` always includes `summary:read` and `paymentMethods:read`; adds `disputes:create` and/or `disputes:read` when the respective flags are true.
- `buildShareTokenDoc` includes rawToken when truthy and omits it when null (invoice flow); sets defaults for revoked (false), lastAccessedAt (null), accessCount (0).
- `buildShareUrl` constructs a URL in the format `{origin}/share.html?token={token}`.
- `computeExpiryDate` returns null for 0, null, or negative days; returns a future Date for positive days.
- `isShareTokenStale` returns true for revoked tokens, true for expired tokens, false for non-expired non-revoked tokens, false when no expiry is set, and correctly handles Firestore Timestamp-like objects with `.toDate()`.

### ShareLinkDialog Component

- Renders the "Generate & Copy Link" tab by default.
- Opens the manage tab when `initialTab="manage"`.
- Shows link expiry and scope options (e.g., "Allow member to request bill reviews") on the generate tab.
- Renders nothing when not open.
- Shows both "New Link" and "Manage Links" tab buttons.

### ShareView (Public-Facing)

- Shows "No share token provided" error when no token is in the URL.
- On publicShares cache hit: renders member name heading, year pill, and bumps access count via updateDoc.
- On cache miss with successful Cloud Function response: renders data from the response and sends the correct POST payload to `/resolveShareToken`.
- On cache miss with failed response: shows the server error message or a generic "invalid or has been removed" fallback.
- On network/unexpected error: shows "Could not connect" message.
- Bills section renders bill names, monthly amounts, annual shares, split counts, member count labels, and a TOTAL row.
- "Request Review" buttons appear when scopes include `disputes:create`; hidden when they do not.
- Dispute form validates empty messages (shows error styling), clears error on typing, calls `addDoc` with correct fields (memberId, memberName, billId, billName, message, proposedCorrection, status, createdAt, tokenHash) on submit, and shows a success message.
- Cancel button closes the dispute form overlay.
- Payment summary section shows annual total, monthly total, paid to date, balance remaining, percentage paid, outstanding balance callout when balance > 0, and settled callout when balance is 0 with payments.
- Evidence viewing: opens `window.open` directly when evidence has a downloadUrl; fetches via `/getEvidenceUrl` when no downloadUrl, showing "Loading..." while fetching.
- Dispute approval/rejection: shows Approve/Reject buttons when `userReview.state` is "requested"; clicking Approve calls updateDoc and shows "You approved this resolution."; hides buttons when state is "approved_by_user" or "rejected_by_user".
- Payment methods section renders method labels, handles, and Copy buttons; hidden when empty.
- Disputes section renders dispute details (bill name, status, message, resolution note); hidden when empty.
- Trust banner renders a "secure annual billing summary" notice.
- Shows loading message initially while data is being fetched.
