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

- `buildShareScopes` always includes `summary:read`, `paymentMethods:read`, and `usageCharges:read` (#317 — a member always sees their own pending charges on their share, so the scope is on every normal link); adds `disputes:create` and/or `disputes:read` when the respective flags are true; and adds `refunds:read` when the third flag is true (#319). The 2-argument dispute call stays backwards-compatible.
- `buildPublicShareData` includes the member's `pendingCharges` (via `buildPendingChargesForShare`) in the generated `publicShares` document when the scopes carry `usageCharges:read`, so the member-facing view is reachable directly from a normally-generated link (not only via the Cloud Function self-heal on a cache miss). It accepts an optional `owedAdjustments` array for this. **Both** share-link writers do this for cache-hit consumer parity: the React path (every share-generation caller threads `owedAdjustments` — `ShareLinkService`, the ShareLink/Email/Text dialogs, and `InvoicingTab`) and the legacy `/site/` `buildPublicShareData` (which writes the same shared `publicShares` doc).
- The same `owedAdjustments` array drives the member-facing **owed** (#321): `buildPublicShareData` reduces the household's `combinedAnnualTotal` (and therefore `combinedMonthlyTotal` and `balanceRemaining`) by the sum of active `service_credit` adjustments for the primary plus linked members, floored at 0, mirroring `getHouseholdFinancials` so the public share summary agrees with the settlement board. Voided credits and the `+owed` Usage Charge direction are excluded; billed Usage Charges (#320) are not added here. **Dual-app parity:** the legacy `/site/` `buildPublicShareData` applies the identical reduction (reading its module-scoped `owedAdjustments`), since both apps write the same shared `publicShares` doc and must agree. The Cloud Function `resolveShareToken` — the cache-miss / legacy-cache / stale-refresh fallback that self-heals `publicShares` — applies the same floored `service_credit` reduction to its `paymentSummary` (via the `getServiceCreditTotalForMember` helper in `functions/billing.js`), so the React, legacy, and Cloud Function member-facing totals all agree and the self-healed doc never persists the gross total.
- `buildPendingChargesForShare` returns the token member's OWN deferred Usage Charges (per-member grain, ADR 0005 — "a linked member sees their own pending charges"; the household grain is only for the admin settlement board) as `{ charges, total, count }`: only `kind: 'usage_charge'` records with `status: 'deferred'` whose `memberId` is the token member are included; voided/billed charges and other members' charges (including linked household members) are excluded; charges are sorted by incurred date ascending and each carries a `runningTotal`; only member-safe fields (`id`, `description`, `amount`, `incurredDate`, `runningTotal`) are exposed; an unknown member or empty input yields an empty result.
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
- Pending charges section (deferred Usage Charges, #317) renders a list of the member's own deferred charges (date, description, amount, running total) with a clear NOT-YET-DUE label, only when the resolved share data carries a non-empty `pendingCharges` (which the Cloud Function returns only for the `usageCharges:read` scope); hidden when the scope is absent or there are no deferred charges.
- Trust banner renders a "secure annual billing summary" notice.
- Shows loading message initially while data is being fetched.

### Refund Notices on the Share Page (#319)

- When the token carries `refunds:read` and the resolved data includes `refundNotices`, a "Your Refunds" section renders each notice with its amount, payment method, and reason; the section is hidden when there are no notices.
- A pending notice (no `confirmation`) shows two actions: **Confirm Receipt** and **I Have Not Received It**. Clicking either POSTs `{ token, noticeId, outcome }` to `/submitRefundConfirmation` (`outcome` is `confirm` or `not_received`)—never a direct Firestore write.
- After confirming, the card shows "You confirmed you received this refund." and the action buttons are removed; after reporting non-receipt, it shows the "reported … as not received" message. A notice that already carries a `confirmation` seeds that terminal state on load (no action buttons).
- If the `/submitRefundConfirmation` POST fails, the card surfaces the server (or a generic) error message and leaves the action buttons in place so the member can retry; the error clears on the next attempt.
- **Live resolution:** because Refund Notices are dynamic (mutable confirmation state) and are NOT stored in the `publicShares` cache — and a freshly issued confirm link is minted before its notice document exists — a `refunds:read` link always resolves live via `resolveShareToken` even on a cache hit. Only dedicated refund-confirm links carry `refunds:read`, so normal share links keep using the cache.
- **Routing:** `/submitRefundConfirmation` is registered as a Hosting rewrite in `firebase.json` (before the SPA catch-all), alongside the other share Cloud Functions, so the member POST reaches the function in deployed Hosting.
- `resolveShareToken`'s `disputes:read` projection excludes `kind: 'refund_notice'` documents (mirroring `useDisputes`), so a normal review-enabled link never renders Refund Notices as empty Review Requests (ADR 0002).

### RefundNoticeService (issuance)

- `issueRefundNotice` mints a `refunds:read` share link (also granting `summary:read`) for the confirm CTA, writes a `refund_notice` doc into the `disputes` subcollection with a server `createdAt`, the snapshot fields, a null `confirmation`, the `creditAdjustmentId`, and the link's `tokenHash`, then emails the member the reason, amount, method, and confirm link.
- The notice persists even when the member has no email (no email sent), when the email send fails (best-effort), or when minting the share link fails (the notice is written without a `tokenHash` and the email goes out without the share URL). Returns the new `noticeId` and `shareUrl`.
