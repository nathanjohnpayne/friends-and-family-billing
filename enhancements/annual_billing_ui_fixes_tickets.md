
# UI Bugs & Enhancements — Readability, Density, Alignment, and Brand Assets (Annual Billing)

**Scope:** Friends & Family Billing (Admin UI + Share Link)  
**Context:** Annual billing mental model; settlement/collection workflows  
**Note:** This file contains **7 tickets**. Copy each section into Jira as needed.

---

## 1) BUG — Top Navigation / Year Bar Not Readable (Contrast + Hierarchy)

**Type:** Bug (UI/Accessibility)  
**Priority:** High  
**Area:** Header / Year selector / Status controls (“Close Year”, “Reopen”, “Start New Year”), progress bar and labels

### Problem
The header/nav region is visually low-contrast and difficult to scan:
- White text over saturated purple + translucent panel reduces legibility.
- Status chips (“Open / Settling / Closed / Archived”) are too subtle.
- Year selector and primary actions visually blend with background.

### Expected
Header must be readable at a glance and meet basic contrast needs. Primary actions must be obvious and visually distinct.

### Requirements
- Increase contrast for all header copy and controls (text + icons).
- Add a **solid header surface** (or stronger scrim) behind controls.
- Define clear button hierarchy:
  - Primary: “Start New Year” (when applicable)
  - Secondary: “Close Year”
  - Tertiary/link: “Reopen”
- Make current status (“Settling”) clearly highlighted with semantic styling (not just a faint pill).

### Acceptance Criteria
- [ ] Header text/control contrast is visibly improved (no washed-out text).
- [ ] Primary vs secondary vs tertiary buttons are unambiguous.
- [ ] Status stepper is readable and clearly indicates current state.
- [ ] No control appears disabled unless it truly is (and disabled state is clear).

---

## 2) ENHANCEMENT — Bill Cards Too Busy/Cramped (Reduce Cognitive Load)

**Type:** Enhancement (UI/Information Architecture)  
**Priority:** High  
**Area:** Bills list cards (logos, title, website, amount, frequency toggle, derived preview, split list, actions)

### Problem
Bill cards are visually dense:
- Too many elements compete (logo, title, URL, amount, toggle, derived preview, split list, 5 buttons).
- Split list consumes most of the card and pushes actions into a cramped row.
- Frequency toggle + derived preview sit uncomfortably near the primary amount, increasing clutter.

### Proposed Improvements
**A. Card Layout (two-column header + collapsible details)**
- Header row: Logo + Bill Name (left) and Amount + Frequency (right).
- Secondary row: Website (optional) and derived preview (smaller).
- “Split with” becomes collapsible:
  - Default collapsed with summary text: “Split with: 8 members” + “Edit split”.
  - Expand/collapse chevron.

**B. Button rationalization**
- Convert action buttons to a single “Actions ▾” menu OR grouped buttons:
  - Primary: “Edit” (or “Manage”)
  - Secondary: “History” (link style)
  - Destructive: “Remove” (in menu)
  - Logo actions moved to “Branding” submenu

### Acceptance Criteria
- [ ] Card header is scannable in <2 seconds (name + amount + freq).
- [ ] “Split with” list is collapsible; default view is compact.
- [ ] Actions are reduced to <=2 visible buttons + overflow menu.
- [ ] No overlapping / cramped spacing on typical laptop widths.

---

## 3) BUG — Annual Summary Table Alignment & Column Rhythm Issues

**Type:** Bug (Layout/Alignment)  
**Priority:** High  
**Area:** Annual Summary table (Monthly Total, Annual Total, Payment Received, Balance, Actions)

### Problem
The Annual Summary table does not line up cleanly:
- Column spacing feels inconsistent; totals row doesn’t visually align with column headings.
- “View calculation” links introduce multi-line height variance that breaks row rhythm.
- Action buttons align inconsistently across rows.

### Expected
A clean accounting-style table with consistent column widths, alignment, and row heights.

### Requirements
- Enforce column widths and alignment:
  - Money columns right-aligned with tabular numerals.
  - Names left-aligned.
  - Actions fixed width, right aligned.
- Standardize row height:
  - Move “View calculation” into an icon button with tooltip or secondary line with consistent height.
- Totals row uses same grid alignment and stronger visual separation (top border + bolder total).

### Acceptance Criteria
- [ ] All currency columns align vertically (digits line up).
- [ ] Rows maintain consistent height regardless of “View calculation” presence.
- [ ] Totals row aligns exactly under headers and reads like a financial total line.

---

## 4) ENHANCEMENT — Add Official Payment Service Logos (SVG/EPS Source + Export)

**Type:** Enhancement (Brand Assets / UI)  
**Priority:** Medium  
**Area:** Payment Methods configuration + Share Link payment cards

### Problem
Payment methods are text-heavy and lack recognizable brand marks. This reduces trust and scannability.

### Expected
Payment methods display official service marks in a consistent icon system.

### Requirements
- Create an internal **payment icon set**:
  - Prefer vector sources (SVG). If EPS sources are used, convert to SVG for web.
  - Services: Venmo, Cash App, PayPal, Apple Cash, Zelle (+ placeholder for “Other”).
- Normalize icon sizing (e.g., 24px/32px), consistent padding, and monochrome fallback.

### Acceptance Criteria
- [ ] Payment method rows show the correct logo consistently.
- [ ] Icons render crisply on retina displays.
- [ ] Fallback icon exists when logo unavailable.

---

## 5) ENHANCEMENT — Annual Billing Summary Should Use User Photos + Company Logos

**Type:** Enhancement (Visual Identity / Trust)  
**Priority:** Medium  
**Area:** Annual Summary (admin) + Share Link tables

### Problem
The Annual Summary is highly tabular and lacks identity cues:
- Users are listed without avatar context (or inconsistent).
- Bills have logos on cards, but summary lacks bill/company visual anchors.

### Expected
Use avatars and bill logos to increase clarity and reduce errors (“Who is this row?” “Which bill is this?”).

### Requirements
- Member rows show avatar + name (standardize everywhere).
- Bill/company rows show bill logo next to bill name (where bill list is shown).
- Define fallback rules:
  - Avatar fallback: initials in circle.
  - Bill logo fallback: generic “receipt” icon or initials tile.

### Acceptance Criteria
- [ ] All member rows include avatar/initial badge consistently.
- [ ] Bills displayed in summaries include company/logo mark.
- [ ] Layout remains aligned and does not increase row height unpredictably.

---

## 6) ENHANCEMENT — Payment Service Logos Should Appear on Summary (Admin + Share Link)

**Type:** Enhancement (UI/Comprehension)  
**Priority:** Medium  
**Area:** Annual Summary + Share Link “Submit Payment” section + (optional) invoice PDF

### Problem
Users see payment methods later, and they are not visually connected to the summary totals. This weakens the “how do I pay?” call-to-action.

### Expected
Show payment method icons near totals and/or in a small “Accepted payment methods” strip.

### Requirements
- Add a compact “Pay via:” row with icons (Venmo/Cash App/PayPal/Apple Cash/Zelle).
- On Share Link, place this strip near the payment CTA header.
- On Admin Annual Summary, show the strip near “Generate Annual Invoice” or in the header of the summary card.

### Acceptance Criteria
- [ ] Payment method icons appear on summary surfaces without clutter.
- [ ] Icons match configured enabled methods (respect toggles).
- [ ] Clicking an icon (where applicable) scrolls/jumps to the payment section (Share Link only).

---

## 7) BUG/ENHANCEMENT — Payment Area Still Too Cramped on Annual Billing Summary (Share Link)

**Type:** Bug + Enhancement (Layout/Usability)  
**Priority:** High  
**Area:** Share Link payment section (“Submit Payment” + method cards + copy buttons)

### Problem
The “Submit Payment” area is cramped:
- Cards are tight with minimal whitespace.
- Long URLs wrap awkwardly; copy buttons compete for space.
- Apple Cash / Zelle instructions are text-heavy and not easily scannable.

### Expected
A clean, breathable payment section optimized for quick action.

### Requirements
- Increase spacing and card padding; enforce consistent card heights where possible.
- Improve layout for long text:
  - Truncate URLs with ellipsis + “Copy link” / “Open” controls.
  - For phone/email: show as chips with dedicated copy buttons.
- Strengthen hierarchy:
  - Card title + logo
  - Primary action: Copy (or Open for link-based)
  - Secondary details below (instructions)
- Responsive behavior:
  - 2–3 column grid desktop, 1 column mobile with full-width buttons.

### Acceptance Criteria
- [ ] Payment section is readable without horizontal scanning.
- [ ] Copy actions are large and consistent across methods.
- [ ] Long values (URL/email/phone) never break layout.
- [ ] Mobile layout is single column with adequate tap targets.

---

## Rollup Notes (Optional Epic-Level Guidance)
If you want to track this as a single epic: **“Annual Billing UI Readability & Trust Pass”**, the above tickets can be children under it. The north star is: **scannable, accounting-clean, brand-trustworthy annual settlement UX**.
