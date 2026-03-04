# Ticket: Messaging + Email Invoice Composer Parity (Open Messages Deep-Link, Link/CTA Options, Platform Handling)

## Summary
Improve outbound invoice flows so **Text Invoice** and **Email Invoice** both support a consistent “preview + compose” experience:

1) **Text Invoice → Open Messages** should pre-populate the OS message composer with **(message text + share link + recipient phone if available)** using platform-appropriate URI logic.

2) **Email Invoice** should open an **Email Invoice Preview** modal (like Text Invoice) and let the admin choose between:
- **Text-only invoice**
- **Link + short CTA**
- **Text + link**
- **Full invoice text** (current long breakdown) *(optional, behind an “Advanced” toggle if needed)*

This prevents “copy/paste drift,” reduces user error, and matches the annual-billing mental model (share link is the primary artifact; long-form invoice is secondary).

---

## Problem / Current Behavior

### A) Text Invoice → Open Messages is incomplete / inconsistent
“Open Messages” does not reliably inject:
- the composed text,
- the share link (if present),
- the recipient phone number (if present).

Because the SMS URI scheme differs by platform, behavior varies across iOS/Android/desktop.

### B) Email Invoice bypasses preview and always generates a long-form invoice
`sendIndividualInvoice()` builds a long plain-text invoice and immediately navigates to a `mailto:` URL. fileciteturn12file4L29-L35

No way to select a lighter-weight message (link+CTA) or sanity check the content before launching the mail client.

---

## Goals
- **One mental model**: Share link is the canonical annual billing summary. Text/email are delivery channels.
- **Parity**: Text and email workflows share the same preview UI and option set.
- **Platform reliability**: “Open Messages” works on iOS Safari/Chrome, Android Chrome, and desktop (with graceful fallback).

Non-goals:
- Sending SMS/email directly from the web app (no Twilio/SMTP in this ticket).

---

## UX Requirements

### 1) Text Invoice Modal: “Open Messages” behavior
When admin clicks **Open Messages**:
- If `member.phone` exists → open message composer addressed to that number and prefill body with:
  - message text
  - blank line
  - share link (if exists)
- If no phone exists → open composer without recipient but with body prefilled with message text + share link.
- If no share link exists → still open composer with text; show warning in modal UI (same “None — generate one” pattern).

**Default message format**
```
Hey {FirstName} — your annual shared bills for {Year} are ready.
Total: ${AnnualTotal}.

View & pay here: {ShareLink}
```
Variant behavior:
- **Text-only**: omit link section
- **Link + CTA**: one-line CTA + link

### 2) Text Invoice: add “Variants” selector
Add a small option group (radio):
- **Text only**
- **Text + link** (default if link exists)
- **Link + short CTA** (compact)

Selection updates the preview textarea live and controls both **Copy Message** and **Open Messages** output.

### 3) Email Invoice Preview (new modal)
When admin clicks **Email Invoice**, open a modal mirroring Text Invoice:
- Summary block (Recipient, Annual Total, Balance, Share Link)
- **Subject** input (prefilled)
- **Body** textarea preview
- Variant selector (same variants as Text)
- Buttons:
  - **Copy Email**
  - **Open Mail App** (launch `mailto:` with subject/body)
  - **Close**

Default variant: **Link + short CTA** (best fit for annual-billing context).

---

## Platform-Specific Implementation Requirements (Open Messages)

### URL schemes & edge cases
Implement helper:
- `buildSmsDeepLink({ phone?: string, body: string }) => string | null`

Rules (practical):
- **iOS**: `sms:${phone}&body=${encodeURIComponent(body)}`
  - If no phone: `sms:&body=...`
- **Android**: `sms:${phone}?body=${encodeURIComponent(body)}`
  - If no phone: `sms:?body=...`
- **Desktop**: attempt `sms:`; if blocked/unhandled, fall back to:
  - copy-to-clipboard + toast “Copied. Paste into Messages.”

Detection (acceptable):
- iOS: `/iPhone|iPad|iPod/`
- Android: `/Android/`
- else: desktop fallback

Success criteria:
- iOS/Android open composer with prefilled body (and recipient when available) in most cases.
- Desktop never dead-ends (Copy Message remains sufficient).

---

## Engineering Notes / Code Touchpoints

### Current Email Invoice implementation (refactor)
- `sendIndividualInvoice(memberId)` constructs `mailto:` and navigates immediately. fileciteturn12file4L29-L35

Refactor:
1) Extract generators:
   - `buildInvoiceText({ memberId, variant })`
   - `buildInvoiceSubject({ year, member })`
2) Replace immediate navigation with:
   - `openEmailInvoiceDialog(memberId)`
3) “Open Mail App” button generates the `mailto:` URL from current selection.

### Existing dialog styling can be reused
`styles.css` already contains dialog styles (`.dialog-overlay`, `.dialog`, `.text-invoice-summary`, etc.). fileciteturn12file7L1-L127  
Reuse for email preview to keep design consistent.

### Member data
Email is required (current validation exists). fileciteturn12file0L32-L35  
Phone is optional; when absent, launch without recipient and include link+text.

---

## Acceptance Criteria

### Text Invoice → Open Messages
- [ ] With phone: opens composer addressed to phone and prefilled body matches selected variant.
- [ ] Without phone: opens composer with body populated (no recipient).
- [ ] If link missing: UI indicates missing link; Open Messages uses text-only body or omits link safely.
- [ ] iOS and Android use correct URI formats; desktop has graceful fallback.

### Text Invoice Variants
- [ ] Admin can choose text-only / text+link / link+CTA.
- [ ] Preview updates immediately and matches what is copied/launched.

### Email Invoice Preview
- [ ] Clicking Email Invoice opens preview modal (no immediate `mailto:` jump).
- [ ] Variant selection updates subject/body preview.
- [ ] “Open Mail App” launches with subject/body matching the preview.
- [ ] Optional “Full invoice text” variant reproduces current long breakdown.

### Regression
- [ ] No change to annual totals math; only composition/UX flow changes.
- [ ] Existing annual invoice generation remains functional. fileciteturn12file5L18-L21

---

## Priority
**P1** — core workflow reliability (admin invoicing) and cross-platform correctness.

---

## Tasks
1) Add SMS deep-link helpers (`buildSmsDeepLink`, `openSmsComposer` w/ fallback).
2) Update Text Invoice modal:
   - variant selector + live preview
   - Open Messages uses deep link w/ phone if available
3) Add Email Invoice preview modal:
   - subject/body preview, variant selector
   - Open Mail App button builds `mailto:`
4) Refactor `sendIndividualInvoice()` to use modal and extracted generators.
5) QA: iOS Safari/Chrome, Android Chrome, desktop Chrome/Safari (fallback).

