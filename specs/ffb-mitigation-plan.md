# Friends & Family Billing — Design & UX Mitigation Plan

> **App:** https://friends-and-family-billing.web.app/
> **Stack:** React + Firebase (hosted on Firebase Hosting)
> **Date:** March 17, 2026
> **Author:** Design review by Claude, commissioned by Nathan Payne

---

## How to Use This Document

This is a prioritized mitigation plan organized into tiers. Each item includes the problem, the fix, and acceptance criteria. Work through the tiers in order—P0 issues block usability, P1 issues cause confusion, P2 issues are polish.

---

## P0 — Critical: Blocks Core Usability

### 0.1 Convert the Single-Page Scroll to Routed Views

**Problem:** The entire app—Settlement Workspace hero, Billing Controls, Annual Summary with expandable household rows, summary footer, AND the four-tab admin section (Members, Bills, Invoicing, Review Requests)—is one continuous scrolling page. On desktop this is ~5,000px tall. On mobile it exceeds 10,000px. Users must scroll past the entire dashboard to reach the admin tabs, which are the most frequently used part of the app.

**Fix:**
- Introduce a top-level navigation with two primary views: **Dashboard** (Settlement Workspace + Annual Summary) and **Manage** (the four-tab admin section).
- Use React Router (or your current routing solution) so each view has its own URL path (e.g., `/dashboard`, `/manage/members`, `/manage/bills`, `/manage/invoicing`, `/manage/review-requests`).
- The Dashboard view should contain: the Settlement Workspace hero, Billing Controls, settlement progress, Annual Summary (households list, summary footer).
- The Manage view should contain: the four-tab section (Members, Bills, Invoicing, Review Requests) as its own full-page layout.
- Add a persistent top nav bar with the app name, the two primary view links, the signed-in user indicator, and Logout.

**Acceptance criteria:**
- Navigating to `/manage/bills` loads the Bills tab directly without scrolling past the dashboard.
- Browser back/forward navigation works between views and tabs.
- Deep links to specific tabs work (e.g., sharing `/manage/invoicing` opens the Invoicing tab).

---

### 0.2 Make the Tab Bar Sticky

**Problem:** The Members/Bills/Invoicing/Review Requests tab bar scrolls with the page. When a user is deep in the Bills list, they must scroll up to find the tabs again to switch sections.

**Fix:**
- Apply `position: sticky; top: 0; z-index: 10;` (or the appropriate offset if a top nav exists) to the tab bar container.
- Add a subtle bottom border or shadow to visually separate the sticky tabs from scrolling content below.

**Acceptance criteria:**
- The tab bar remains visible at the top of the viewport when scrolling within any tab's content.
- Tab switching is always one click away regardless of scroll position.

---

### 0.3 Fix Mobile Responsiveness

**Problem:** The app is a desktop layout that wraps on mobile. Specific failures:
- Household cards stack Annual/Paid/Balance as three full-width rows (~70px each), making each card nearly viewport-height.
- The three-dot overflow menu clips off-screen, truncating "Text Invo…", "Genera…", "Manag…".
- Filter pills in the Annual Summary overflow off-screen (e.g., "Linked Groups" disappears).
- Bill cards are ~400px tall on mobile, showing all 12 data points vertically.

**Fix:**
- **Household cards (Annual Summary):** On mobile, show Annual/Paid/Balance as a compact inline row (e.g., three columns within a single row, or a condensed `$1,069.76 annual · $0.00 due` single-line format). Reserve the expanded three-row layout for the Details expansion.
- **Three-dot menu:** Ensure the dropdown is positioned with `right: 0` or uses a portal so it doesn't clip the viewport. Test at 375px width.
- **Filter pills:** Make the filter bar horizontally scrollable (`overflow-x: auto; white-space: nowrap;`) or collapse into a single dropdown on screens below 480px.
- **Bill cards:** On mobile, collapse the billing cadence info (BILLED MONTHLY badge + Convert button + Annual equivalent line) into a single line or hide behind a tap-to-expand. Remove the URL entirely on mobile (it's not tappable or useful at that size).

**Acceptance criteria:**
- At 375px width, no horizontal overflow occurs on any screen.
- All dropdown menus are fully visible and tappable on mobile.
- A single bill card fits within one viewport height on mobile.
- A household card (collapsed) fits within ~120px height on mobile.

---

### 0.4 Fix the Invoice Template Duplication Bug

**Problem:** The Invoicing tab's email template textarea contains BOTH the `%payment_methods%` variable AND a hardcoded payment list below it (e.g., "Apple Cash: 202.253.7070 / Venmo: @nathanpayne …"). The live preview renders both—the variable-expanded formatted block AND the hardcoded shorthand list—meaning every sent invoice shows payment methods twice.

**Fix:**
- Remove the hardcoded payment method text from the template textarea. The `%payment_methods%` variable should be the sole source for payment info.
- Validate on save that the template doesn't contain both `%payment_methods%` and literal payment method text.
- If the hardcoded list was intended as a fallback or a different format, make it a separate template variable (e.g., `%payment_methods_short%`) that the user can optionally insert.

**Acceptance criteria:**
- The live preview shows payment methods exactly once.
- Saving and previewing the default template produces a clean, non-duplicated invoice.

---

## P1 — High: Causes Confusion or Erodes Trust

### 1.1 Resolve the "Settling" vs. "100% Settled" Status Contradiction

**Problem:** The status card says "Settling," the progress bar says "100% settled," and the message says "Everyone is settled for 2026. Close the year when you are ready." Three different signals. "Settling" implies an ongoing process; "100% settled" says it's done.

**Fix:**
- Add a new status state: when all households are settled but the year isn't closed, show status as **"Ready to Close"** (not "Settling").
- The lifecycle stepper should highlight "Settling" as completed and show a visual indicator pointing toward "Closed" as the next step.
- The progress bar message is fine ("Everyone is settled…Close the year when you are ready")—just make the status card match.

**Acceptance criteria:**
- When 100% of households are settled, the STATUS card reads "Ready to Close" (or "Settlement Complete"), not "Settling."
- The lifecycle stepper visually indicates progress toward the next state.

---

### 1.2 Protect Billing Controls Behind Confirmation Modals

**Problem:** "Close Year," "Back to Open," and "Start New Year" are high-consequence, potentially irreversible actions displayed as casual buttons in the hero section on every page load. "Back to Open" could undo settlement work. No confirmation dialogs are visible.

**Fix:**
- Each of these three buttons must trigger a confirmation modal before executing.
- The modal should state what will happen in plain language (e.g., "This will reopen the 2026 billing year. All settlement statuses will be reset to Outstanding. This cannot be undone. Are you sure?").
- Use a destructive button style (red) for the confirm action in the modal.
- Consider moving Billing Controls out of the hero and into a Settings or Admin section accessible from the top nav, since these are once-a-year actions.

**Acceptance criteria:**
- Clicking "Close Year," "Back to Open," or "Start New Year" opens a modal requiring explicit confirmation.
- No billing year state change occurs without the user clicking a confirm button inside the modal.

---

### 1.3 Disable "Email Invoice" for Settled / Zero-Balance Households

**Problem:** Every household row shows an "Email Invoice" button regardless of balance. Emailing an invoice to someone who owes $0.00 is confusing at best, alarming at worst.

**Fix:**
- When a household's balance is $0.00 and status is "Settled," disable the "Email Invoice" button (gray it out) or hide it entirely.
- If you keep it visible but disabled, add a tooltip: "No balance due — nothing to invoice."
- Optionally, replace it with a "Send Receipt" or "Send Summary" action for settled members who want a record.

**Acceptance criteria:**
- No "Email Invoice" button is clickable for households with a $0.00 balance.
- Users can still access payment history and share links for settled households.

---

### 1.4 Clarify "Convert to Annual/Monthly Billing" Label

**Problem:** The "Convert to annual billing" button on bill cards implies it will change the actual subscription billing (e.g., call T-Mobile and switch the plan). If it only recalculates the display math, the label is misleading.

**Fix:**
- If the button is a view toggle: rename to **"Show as annual"** / **"Show as monthly"** to make clear it's a display change, not a billing change.
- If the button actually changes how the bill is tracked in the system: keep "Convert" but add a confirmation dialog explaining what changes.

**Acceptance criteria:**
- Users understand from the label alone whether clicking changes real billing or just the display math.

---

### 1.5 Remove Redundant "Supported Fields" Reference Text on Invoicing Tab

**Problem:** The Invoicing template editor shows three representations of the same information: the clickable insert-field chips (Billing Year, Annual Total, Payment Methods), the "Supported fields: %billing_year%, %annual_total%, %total%, and %payment_methods%" reference line, and the raw tokens in the template body.

**Fix:**
- Remove the "Supported fields: …" reference line entirely. The chips are the interface; the raw tokens in the textarea are the result. The middle layer is redundant.
- If you want to keep a reference, put it in a collapsible "Help" or "?" tooltip, not inline.

**Acceptance criteria:**
- The insert-field chips and the template textarea are the only two visible representations of template variables.

---

### 1.6 Fix the Invoice Preview Formatting

**Problem:** The live preview renders with ASCII horizontal rules (rows of `=` characters) and plaintext formatting. This looks like a terminal dump from 1995, not a modern email.

**Fix:**
- If invoices are sent as HTML email: render the preview as formatted HTML with proper styling (horizontal rules as `<hr>`, payment methods in a clean list or table).
- If invoices must be plaintext: use cleaner separators (e.g., a single line of dashes `---`, or just whitespace and bold section headers) instead of 80-character equal-sign bars.
- Add a "Preview as Email" toggle that shows approximately what the recipient will see in their inbox.

**Acceptance criteria:**
- The live preview looks professional and matches the actual email output format.
- No ASCII-art separators in the default template.

---

## P2 — Medium: Friction, Information Architecture, Polish

### 2.1 Reduce Button Clutter on Member Cards

**Problem:** Members with photos show four buttons (Change Photo, Remove Photo, Link Household, Delete). Members without photos show three (Add Photo, Link Household, Delete). The right side of every card is a wall of buttons that overpowers the member info.

**Fix:**
- Move photo management into the avatar: clicking the avatar opens a popover with "Change Photo" / "Remove Photo" / "Add Photo" options.
- Keep only **Link Household** and **Delete** as card-level actions.
- Move Delete into a contextual menu (three-dot) or at minimum style it as a text link rather than a red button, to reduce its visual prominence.

**Acceptance criteria:**
- Each member card shows at most two action buttons on the card surface.
- Photo management is accessible by clicking the avatar.

---

### 2.2 Reduce Information Density on Bill Cards

**Problem:** Each bill card shows 12 distinct pieces of information/interaction: logo, name, URL, per-person cost, member count, "Split with N members," "Edit split," billing cadence badge, convert button, annual/monthly equivalent, History button, More dropdown.

**Fix:**
- Remove the URL from the default card view. Move it into the "More" menu under "Edit Website" (which already exists there—so the URL is accessible but not always shown).
- Consolidate the billing cadence display: show EITHER the badge + convert button OR the equivalent line, not both. Suggested: show "BILLED MONTHLY · $3,600/yr equivalent" as a single line, with the convert action in the More menu.
- Consider combining "Split with 8 members" and "$37.50 per person monthly (8 members)" since they convey the same information. Show just the per-person cost line.

**Acceptance criteria:**
- Each bill card shows no more than 8 distinct elements.
- The URL is not visible on the card surface.
- Billing frequency and equivalent cost are communicated in a single line.

---

### 2.3 Promote the Details Expansion in Annual Summary

**Problem:** The expanded household view showing "PRIMARY MEMBER CALCULATION" with formula breakdowns and linked member sub-rows is the best transparency feature in the app, but it's hidden behind a tiny "Details ▼" link.

**Fix:**
- Make the Details expansion more visually prominent: use a button-styled element or a clearly labeled expandable section header instead of a small text link.
- Consider defaulting to expanded for households with linked members, since the household-level total alone doesn't tell the full story.
- Add a "Show all details" / "Collapse all" toggle at the top of the household list for bulk expand/collapse.

**Acceptance criteria:**
- The Details control is visually distinguishable from surrounding text (not a tiny link).
- Users can expand/collapse all household details with a single action.

---

### 2.4 Consolidate Share Link Surfaces

**Problem:** Share links are accessible from two places with different labels: "New Share Link" / "Manage Share Links" in the expanded Details row, and "Generate Share Link" / "Manage Share Links" in the three-dot overflow menu. Same feature, two surfaces, inconsistent naming.

**Fix:**
- Pick one surface for share link management. Recommendation: keep it in the three-dot menu (since it's an action, not informational detail).
- Remove the share link text links from the expanded Details panel, or if keeping both, use identical labels.
- Rename to a single consistent term: either "Share Link" or "Billing Link" everywhere.

**Acceptance criteria:**
- Share link creation/management uses the same label in every location.
- Ideally, share link actions exist in only one surface per household row.

---

### 2.5 Reconcile "More" Menu Contents for Bills

**Problem:** The "More" dropdown on bill cards contains: Edit Website, Upload Logo, Remove Logo, Remove Bill. "Remove Bill" (destructive, important) is at the same level as "Upload Logo" (cosmetic, rare). Meanwhile, "Edit split" is a text link on the card itself, not in the More menu.

**Fix:**
- Move "Edit split" into the More menu.
- Reorder the More menu by usage frequency: Edit Split, Edit Website, Upload Logo, Remove Logo, then a separator, then Remove Bill (styled red/destructive).
- "Remove Bill" should trigger a confirmation modal.

**Acceptance criteria:**
- The More menu is ordered by frequency/importance.
- "Remove Bill" requires confirmation.
- "Edit split" is in the More menu, not a standalone text link on the card.

---

### 2.6 Add Empty / Onboarding States

**Problem:** A brand new user sees a purple hero dashboard with $0.00 outstanding, 0/0 settled, and no guidance on what to do first. There's no onboarding flow or indication of the setup order (add members → add bills → configure payment methods → send invoices).

**Fix:**
- Add an onboarding checklist or empty-state guidance that appears when key data is missing:
  - **Members tab empty:** "Start by adding the friends and family who share your bills. → + Add Member"
  - **Bills tab empty:** "Add the subscriptions and bills you split with your group. → + Add Bill"
  - **Invoicing with no payment methods:** "Set up at least one payment method so members know how to pay you. → Add Payment Method"
- On the Dashboard, if no members or bills exist, replace the stats cards with a "Get started" card pointing to the Manage section.

**Acceptance criteria:**
- A new user with zero members sees clear guidance on what to do first.
- Empty states include a direct CTA to the relevant action.

---

### 2.7 Move Billing Controls to a Settings/Admin Section

**Problem:** "Close Year," "Back to Open," and "Start New Year" are once-a-year actions displayed prominently in the hero on every page load. On mobile, they dominate the first viewport.

**Fix:**
- Create a **Settings** or **Admin** section accessible from the top nav (gear icon or "Settings" link).
- Move Billing Controls (year switching, lifecycle actions) into that section.
- On the Dashboard hero, replace the Billing Controls panel with a simple status indicator showing the active year and its state (e.g., "2026 · Settling"). Add a "Manage →" link to the Settings section for users who need to change the year.

**Acceptance criteria:**
- The dashboard hero no longer contains buttons that can change billing year state.
- Billing year management is accessible from a dedicated Settings/Admin view.
- The active year and state are still visible on the dashboard as a read-only indicator.

---

## P3 — Low: Visual Polish & Future Considerations

### 3.1 Add Visual Weight Differentiation to Bill Cards

**Problem:** T-Mobile at $300/month and Disney+ at $10/month have identical card styling. Users scanning for "where is most of my money going" get no visual help.

**Fix:**
- Add a subtle left-border color scale or background tint based on cost tier (e.g., a thicker/darker accent border for higher-cost bills).
- Alternatively, sort bills by cost descending by default, so the most expensive are always at the top.
- Or add a small summary bar at the top of the Bills section showing total monthly spend and a mini bar chart of relative bill sizes.

---

### 3.2 Expand the Color Palette Beyond Purple

**Problem:** One shade of purple handles active states, primary buttons, badges, links, and the hero gradient. Nothing has visual emphasis because everything looks the same.

**Fix:**
- Introduce semantic colors: green for success/settled states, amber for warnings/pending, red for destructive actions, blue for informational links.
- Reserve the purple/indigo for primary CTAs and the active nav state.
- Use these colors consistently for status badges (SETTLED = green, OUTSTANDING = amber, etc.).

---

### 3.3 Consider a "What Do I Owe?" Member-Facing View

**Problem:** Share links exist but the member-facing experience isn't clear from the admin side. If members are accessing their billing summary via share links, that view deserves design attention as a first-class experience.

**Fix:**
- Audit the share link landing page for clarity and mobile usability.
- Ensure it shows: what the member owes, how the amount was calculated (the formula breakdowns from Details), and clear payment CTAs for each configured method.
- This view should feel polished because it's the one external people actually see.

---

## Implementation Order Recommendation

1. **P0.4** — Fix the invoice template bug (quick win, data integrity issue)
2. **P0.2** — Sticky tab bar (quick CSS fix, immediate usability gain)
3. **P1.1** — Fix the Settling/Settled status contradiction (logic fix, trust issue)
4. **P1.2** — Add confirmation modals to Billing Controls (safety net)
5. **P0.1** — Convert to routed views (largest effort, biggest impact)
6. **P0.3** — Mobile responsiveness pass (do alongside or after routing refactor)
7. **P1.3–P1.6** — Remaining P1 items (label fixes, redundancy cleanup, preview formatting)
8. **P2.x** — Information architecture and polish items
9. **P3.x** — Visual differentiation and palette work
