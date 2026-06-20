---
spec_id: sharing
---

# Sharing

Covers share link generation, token validation, the share link dialog, and the public-facing share view for family members.

## Test Coverage

- `tests/react/lib/share.test.js`
- `tests/react/components/ShareLinkDialog.test.jsx`
- `tests/react/views/ShareView.test.jsx`
- `tests/react/lib/RefundNoticeService.test.js`

## Acceptance Criteria

### Share Helpers

- `buildShareScopes` always includes `summary:read` and `paymentMethods:read`; adds `disputes:create` and/or `disputes:read` when the respective flags are true; adds `refunds:read` when the third flag is true (#319). The 2-argument dispute call stays backwards-compatible.
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

### Refund Notices on the Share Page (#319)

- When the token carries `refunds:read` and the resolved data includes `refundNotices`, a "Your Refunds" section renders each notice with its amount, payment method, and reason; the section is hidden when there are no notices.
- A pending notice (no `confirmation`) shows two actions: **Confirm Receipt** and **I Have Not Received It**. Clicking either POSTs `{ token, noticeId, outcome }` to `/submitRefundConfirmation` (`outcome` is `confirm` or `not_received`)—never a direct Firestore write.
- After confirming, the card shows "You confirmed you received this refund." and the action buttons are removed; after reporting non-receipt, it shows the "reported … as not received" message. A notice that already carries a `confirmation` seeds that terminal state on load (no action buttons).

### RefundNoticeService (issuance)

- `issueRefundNotice` mints a `refunds:read` share link (also granting `summary:read`) for the confirm CTA, writes a `refund_notice` doc into the `disputes` subcollection with a server `createdAt`, the snapshot fields, a null `confirmation`, the `creditAdjustmentId`, and the link's `tokenHash`, then emails the member the reason, amount, method, and confirm link.
- The notice persists even when the member has no email (no email sent), when the email send fails (best-effort), or when minting the share link fails (the notice is written without a `tokenHash` and the email goes out without the share URL). Returns the new `noticeId` and `shareUrl`.
