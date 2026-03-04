# UI Bugs & Enhancements — Payment Methods + Annual Summary Actions + Bill Cards (Annual Billing)

**Product:** Friends & Family Billing  
**Theme:** Reduce visual noise, improve discoverability, and reinforce annual-billing clarity.  
**Scope:** Admin UI (Payment Methods, Annual Summary, Bills cards) + downstream Share Link/invoice flows.

---

## 1) BUG/ENHANCEMENT — Payment Methods Page Looks Messy (Layout, Hierarchy, Density)

**Type:** Bug + Enhancement (UI/IA)  
**Priority:** High  
**Area:** Admin → Payment Methods

### Problem
The Payment Methods list is hard to scan and feels inconsistent:
- Icon tiles look “floating” and unaligned relative to text.
- Controls on the right (enabled toggle, edit, delete) have weak hierarchy and inconsistent spacing.
- Mixed data density: some methods show long URLs, others show phone/email; alignment breaks across rows.
- Repeated row height and padding are inconsistent, increasing perceived clutter.

### Goals
- Make the list **scannable** and **uniform** regardless of method type (link vs phone vs email).
- Make the “Enabled” state obvious and reduce right-side control noise.
- Preserve annual-billing trust: this is the payment surface users rely on.

### Proposed UX Updates
**A. Standardize row grid**
- Left: **Logo** (32px) + Name (bold) + secondary identifier
- Middle: identifier value (URL/phone/email) truncated with ellipsis when long
- Right: compact control cluster (Enable, Edit, Delete)

**B. Control hierarchy**
- Replace pencil + red X with:
  - `Edit` (icon button)
  - `Remove` (in overflow menu OR confirmation modal)
- Keep `Enabled` as the primary control; visually separate it from destructive actions.

**C. Value presentation**
- For URLs: show domain + ellipsis, with:
  - `Open` (external link icon)
  - `Copy` (copy icon)
- For phone/email: show as **chips** with a dedicated `Copy` button.

**D. Spacing + alignment**
- Consistent row padding (e.g., 12–16px)
- Vertically align logo, titles, and values to a baseline grid
- Increase whitespace between rows or add subtle row separators (not both)

### Acceptance Criteria
- [ ] All payment method rows align cleanly on a shared grid.
- [ ] URL rows do not wrap awkwardly; long values truncate with ellipsis.
- [ ] Every method supports a consistent “Copy” affordance for its primary identifier.
- [ ] Edit/remove controls no longer visually compete with the Enabled toggle.
- [ ] Row height remains consistent for all methods.

---

## 2) BUG/ENHANCEMENT — “Add Payment Method” Dropdown Should Be Sorted by Popularity

**Type:** Enhancement (UX)  
**Priority:** Medium  
**Area:** Admin → Payment Methods → Add Payment Method dropdown

### Problem
The dropdown order is not optimized for the most common choices, creating unnecessary friction.

### Expected
Sort options by typical popularity/usage to reduce time-to-add.

### Proposed Ordering
Suggested default ordering (top → bottom):
1. Venmo
2. Zelle
3. Cash App
4. PayPal
5. Apple Cash
6. Other

*(If you later instrument usage, replace static ordering with “most-used by this account” ordering.)*

### Acceptance Criteria
- [ ] Dropdown order matches the popularity ordering above.
- [ ] The current selection remains stable (no unexpected jumps after adding a method).
- [ ] “Other” is always last.

---

## 3) ENHANCEMENT — Annual Summary Actions Menu Needs “Text Invoice” Option (Auto-Filled CTA + Link)

**Type:** Enhancement (Workflow)  
**Priority:** High  
**Area:** Annual Summary → Actions menu per member

### Problem
Admin can email invoices and share billing links, but SMS/iMessage is often the fastest way to get payment.  
There is no action that generates a ready-to-send text with:
- share link
- short, polite annual-billing CTA
- amount due (optional)

### Proposed Solution
Add `Text Invoice` to the Actions menu that opens a modal (or copies to clipboard) containing a pre-filled message.

**Menu placement**
- Actions ▾
  - Record Annual Payment
  - Email Invoice
  - **Text Invoice** (new)
  - Share Billing Link
  - Manage Share Links

### Text Invoice UX
Modal options:
- Recipient name (read-only display)
- Amount due (auto; optional include toggle)
- Share link (read-only with copy)
- Message preview (editable)
- Buttons:
  - `Copy Message`
  - `Copy Link`
  - (Optional) `Open Messages` (if supported via `sms:` link)

### Default Message Template (Annual Billing)
**Short (default):**
> Hey {FirstName} — your annual shared bills for {BillingYear} are ready. Your total is {AnnualTotal}. You can review and pay here: {ShareLink}. Thanks!

**Even shorter (for reminders):**
> {FirstName}, your {BillingYear} annual bill total is {AnnualTotal}. Pay/review: {ShareLink}

### Acceptance Criteria
- [ ] “Text Invoice” appears in the Actions menu for each member.
- [ ] Clicking it provides a copyable message and the share link.
- [ ] Template includes BillingYear + ShareLink; includes AnnualTotal when available.
- [ ] Admin can edit the message before copying.
- [ ] Works on desktop; does not require native SMS integration to be useful.

---

## 4) BUG — Apple Cash Logo Inconsistent; Should Be Reversed (White Mark on Dark Tile)

**Type:** Bug (Brand Consistency)  
**Priority:** Medium  
**Area:** Payment method icons in Payment Methods list + summary “Pay via” strip + payment cards

### Problem
The Apple logo renders inconsistently relative to the rest of the icon set. It appears unreversed (dark mark on light) and breaks the visual system.

### Expected
Apple logo should match the system:
- Dark tile background
- White mark (reversed) for consistency and legibility

### Requirements
- Use `applecash.svg` with the Apple mark as **white** (`#FFFFFF`) on the standard dark tile background.
- Ensure Apple Cash icon sizing matches other payment icons (same padding + optical size).
- Confirm consistent rendering across:
  - Payment Methods list
  - Annual Summary “Pay via” strip
  - Share Link payment section cards

### Acceptance Criteria
- [ ] Apple mark is reversed (white) everywhere it appears.
- [ ] No mismatched tile backgrounds or inconsistent padding.
- [ ] Icons appear visually consistent as a set.

---

## 5) ENHANCEMENT — Bill Cards Need Critique + Improvements (Scanability, Clutter, Action Hygiene)

**Type:** Enhancement (UI/IA)  
**Priority:** High  
**Area:** Bills list cards

### Problems Observed
- The card header is crowded: name, URL, amount, frequency toggle, and derived preview fight for attention.
- Frequency toggle sits too close to the primary amount, increasing perceived complexity.
- “Split with” checkboxes are the heaviest part of the card and dominate the layout.
- Too many buttons: View History + Actions + Remove Bill + Edit Website (and prior logo actions), increasing noise.
- Derived amount preview is helpful, but currently reads like an extra “line item” rather than supporting info.

### Proposed Improvements
**A. Restructure into “Header + Details”**
- **Header** (always visible):
  - Left: Logo + Bill name
  - Right: Primary amount + `/month` or `/year`
  - Frequency toggle aligned under amount (not overlapping it)
  - Derived preview in smaller, muted text

- **Details** (collapsible):
  - Split membership editor (checkbox grid)
  - Secondary actions

**B. Replace checkbox wall with compact summary**
- Default view shows:
  - “Split with: {N} members” + `Edit split`
- Clicking `Edit split` expands membership grid.

**C. Action hygiene**
- Reduce visible actions to:
  - `Actions ▾` (Edit website, Remove bill, Branding)
  - `View history` as a secondary link button (or inside Actions for maximum minimalism)

**D. Typography + spacing**
- Use tabular numerals for amounts.
- Increase line height and spacing between URL and per-person text.
- Ensure URL truncates and does not wrap into awkward columns.

### Acceptance Criteria
- [ ] Card is scannable primarily by: Logo, Bill Name, Amount, Frequency.
- [ ] Split membership grid is hidden by default and expandable.
- [ ] Actions are consolidated into <=2 visible controls.
- [ ] Derived preview uses secondary styling and does not compete with the main amount.
- [ ] No card content overlaps or looks cramped at common viewport widths.

---

## Rollup Recommendation (Optional)
Track these as an Epic: **“Payment & Billing UI Cleanup (Annual Billing Trust Pass)”** with the 5 items above as child tickets.
