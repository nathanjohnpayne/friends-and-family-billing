# BUG — “Generate share link” in Text Invoice modal does not work

**Product:** Friends & Family Billing  
**Area:** Annual Summary → Actions ▾ → **Text Invoice** modal  
**Priority:** P0 (blocks key workflow)  
**Type:** Bug

---

## Summary
In the **Text Invoice** modal, clicking **“generate one”** next to **Share Link** does not generate a share link or populate the message with a link. This blocks the core “text invoice” workflow.

---

## Environment
- Surface: Admin UI
- Feature: Text Invoice modal (Actions menu in Annual Summary)
- Billing year context: Annual billing (e.g., 2026)

---

## Steps to Reproduce
1. Go to **Annual Summary**.
2. For any member row, open **Actions ▾**.
3. Select **Text Invoice**.
4. In the modal, confirm **Share Link** shows: `None — generate one`.
5. Click **generate one**.

---

## Actual Result
- Nothing happens (no link created/returned).
- Share Link remains `None`.
- Message field remains without a link.
- No visible loading state, success state, or error message is shown.

---

## Expected Result
Clicking **generate one** should:
1. Create a share link for that member + billing year (if one doesn’t exist).
2. Update the modal **Share Link** row with the generated URL.
3. Insert the URL into the message template (or provide a “Copy Link” button).
4. Provide clear UI feedback (loading/success/error).

---

## Impact
- Blocks the new **Text Invoice** action when a member doesn’t already have a share link.
- Increases payment collection friction (no quick SMS/iMessage workflow).

---

## Acceptance Criteria
- [ ] “generate one” generates a valid share link for the selected member and current billing year.
- [ ] Generated link is persisted (re-opening modal shows the same link without regenerating).
- [ ] Modal updates immediately to show the new link + copy affordance.
- [ ] Message template includes the link (or “Copy Message” includes it).
- [ ] UX includes loading + error handling (no silent failure).

---

## Engineering Notes (Likely Root Causes)
- Click handler not bound (event listener not attached / missing delegation).
- Permission/Firestore rules block share-link creation from this code path.
- Function call fails silently (missing `await`, unhandled promise rejection).
- Wrong identifier passed (memberId vs email vs shareLinkId).
- Share link creation depends on another flow (Manage Share Links) and isn’t initialized here.

---

## Suggested Implementation
- Reuse the same share-link generation function used by **Share Billing Link** / **Manage Share Links**.
- After creation:
  - update modal state with `shareLinkUrl`
  - re-render Share Link row with:
    - truncated URL
    - **Copy Link** button
    - optional **Open** button
- Add telemetry/logging:
  - `text_invoice_generate_share_link_clicked`
  - `text_invoice_generate_share_link_success`
  - `text_invoice_generate_share_link_error` (+ error code/message)

---

## QA Notes
Validate for:
- member with **no** share link (creates new)
- member with **existing** share link (shows existing; optionally hide generate)
- billing year scoping (link must be year-scoped; archived years should be viewable)
