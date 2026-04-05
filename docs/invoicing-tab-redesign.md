# Redesign: InvoicingTab—TipTap Rich-Text Editor with Token Pills, Tabbed Preview, and Visual Polish

**Repository:** `nathanjohnpayne/friends-and-family-billing`
**File:** `src/app/views/Manage/InvoicingTab.jsx` (primary), `src/app/shell.css` (styles)
**Related:** `src/lib/invoice.js`, `src/lib/formatting.js`

---

## Problem

The Invoicing tab suffers from three compounding UX failures:

1. **The template editor is a `contentEditable` div where tokens appear as raw `%token%` strings.** Users must memorize token syntax, and the "Insert fields" chip buttons blindly inject text at the cursor with no visual distinction from prose. There is a mismatch between chip labels (e.g., "Last Name") and the injected strings (e.g., `%member_last%`). Formatting syntax is currently plaintext, so users must mentally parse the final result instead of authoring directly in a visual editor.

2. **The live preview duplicates the entire email below the editor, making the page nearly twice as long as necessary.** The "Save Template" button sits below the preview and below the fold. There is no dirty-state indicator, no auto-save, and no sticky save action.

3. **The subject line and body editors use inconsistent token insertion, labeling, and layout.** The subject has "Insert:" with five chips; the body has "Insert fields:" with seven chips. Typography, spacing, and section hierarchy are inconsistent throughout.

## Goal

Replace the current editor with a TipTap-based WYSIWYG rich-text editor where bold appears bold, links appear as links, and tokens appear as inline pills. Add a tabbed Edit/Preview layout where the Edit tab is for WYSIWYG authoring and the Preview tab shows the final rendered email with token values resolved per member. Normalize all token names and bring visual consistency to the page.

The body editor and subject line editor share the same token vocabulary, token pill styling, and insertion patterns, but they do not need to share the same technical implementation. The body editor supports full rich text (paragraphs, bold, italic, links, lists, images, tables, token nodes). The subject line remains constrained to a single line of plain text plus inline token pills only.

---

## Decisions

These were evaluated as open questions in the initial review and are now resolved.

### Editing model: WYSIWYG, not Markdown

With TipTap, keeping raw Markdown in the editor would be the worst of both worlds—taking on a rich-text framework but still forcing users to author in plaintext syntax. The body editor is a true WYSIWYG surface where formatting renders live.

The Preview tab remains necessary because `%payment_methods%` and `%share_link%` expand into complex structured content, token substitution is member-specific, and the final email-client output needs a separate review surface.

- **Edit tab** = WYSIWYG authoring with token pills and slash commands
- **Preview tab** = final rendered email with live data resolution and email-safe layout verification

### Payment Methods: modal overlay, not route navigation

`%payment_methods%` is a structured, settings-backed content block. Its configuration belongs in Settings conceptually, but editing it should not force the user to leave Invoicing and lose context.

The `%payment_methods%` token renders as a distinct block-style node in the editor. On click or selection, it exposes a contextual "Configure" action. Clicking "Configure" opens the existing `PaymentMethodsManager` component in a modal/drawer overlay—no route change, no loss of editor state, no dirty-state interruption. The same principle applies to `%share_link%`.

### Save behavior: explicit save first, auto-save follow-up

Ship explicit save with dirty-state indicator and sticky save bar in the first release. This release is already changing the editing model, token rendering, migration behavior, and preview flow—that is enough change. Add debounced auto-save after the TipTap editor and persistence model are stable in production.

---

## Spec

### 1. Token System Normalization

Rename all tokens to match their chip labels. This is a breaking change to saved templates—add an idempotent migration in `BillingYearService` during `loadYear()`.

| Current Token | New Token | Chip Label |
|---|---|---|
| `%member_first%` | `%first_name%` | First Name |
| `%member_last%` | `%last_name%` | Last Name |
| `%member_name%` | `%full_name%` | Full Name |
| `%billing_year%` | `%billing_year%` | Billing Year |
| `%annual_total%` | `%household_total%` | Household Total |
| `%payment_methods%` | `%payment_methods%` | Payment Methods |
| `%share_link%` | `%share_link%` | Share Link |

Add an idempotent migration function that replaces old tokens with new ones in both `emailMessage` and `emailSubject` settings. Run it in the service layer during `loadYear()` rather than in the view. Persist a `_templateMigrated: true` flag as an optimization, but the migration itself must still be safe to re-run on mixed old/new templates and must never double-convert already migrated content.

**Files affected:**
- `src/lib/invoice.js`—update `buildInvoiceBody` and `buildInvoiceSubject` to resolve new token names; keep old names as aliases indefinitely for backward compatibility
- `src/app/views/Manage/InvoicingTab.jsx`—update `EMAIL_TEMPLATE_FIELDS` and `SUBJECT_TOKEN_FIELDS`
- `src/lib/BillingYearService.js`—add migration logic in `loadYear()`

### 2. Body Editor: TipTap WYSIWYG

#### Architecture

Use TipTap (`@tiptap/react`) as the body editor framework. TipTap is built on ProseMirror and provides a structured document model, extensible node/mark system, and built-in support for custom nodes (which we use for token pills and block tokens).

**Why TipTap over custom `contentEditable`:** The editor needs have grown beyond plain text + token pills. WYSIWYG formatting, images, tables, and structured block nodes like `%payment_methods%` are all on the roadmap. A custom `contentEditable` approach would require reimplementing cursor management, selection handling, undo/redo, paste normalization, and node serialization—all of which TipTap provides out of the box. The bundle cost (~80–150 KB gzipped) is justified by the reduction in custom code and the extensibility it provides.

#### Installation

```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image @tiptap/extension-table @tiptap/extension-placeholder @tiptap/suggestion
```

#### TipTap Extensions

| Extension | Purpose |
|---|---|
| `StarterKit` | Paragraphs, bold, italic, strike, lists, blockquote, code, hard break, history (undo/redo). **Configure to disable headings and any other document-style features not appropriate for email templates.** |
| `Link` | Inline links |
| `Image` | Inline/block images (future use) |
| `Table`, `TableRow`, `TableCell`, `TableHeader` | Table support (future use) |
| `Placeholder` | Ghost text when editor is empty |
| `Suggestion` (via `@tiptap/suggestion`) | Slash-command autocomplete infrastructure |
| **Custom: `TokenNode`** | Inline node for text-replacement tokens (`%first_name%`, etc.) |
| **Custom: `BlockTokenNode`** | Block node for structured tokens (`%payment_methods%`, `%share_link%`) |

#### Custom Node: `TokenNode`

An inline, non-editable node that represents a text-replacement token. Stored as a ProseMirror node with attributes; rendered as a pill `<span>`.

```js
import { Node, mergeAttributes } from '@tiptap/core';

const TokenNode = Node.create({
  name: 'token',
  group: 'inline',
  inline: true,
  atom: true,  // non-editable, cursor skips over it

  addAttributes() {
    return {
      id: { default: null },    // e.g., "first_name"
      label: { default: null }, // e.g., "First Name"
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-token]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-token': HTMLAttributes.id,
      class: 'template-editor-token',
      contenteditable: 'false',
    }), HTMLAttributes.label];
  },
});
```

#### Custom Node: `BlockTokenNode`

A block-level node for `%payment_methods%` and `%share_link%`. Renders as a visually distinct card-like element in the editor with a label, description, and a "Configure" action button.

```js
const BlockTokenNode = Node.create({
  name: 'blockToken',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      label: { default: null },
      description: { default: null },
    };
  },

  // ... parseHTML, renderHTML defined in BlockTokenNode.js
  // ... addNodeView returns React component defined in BlockTokenNodeView.jsx
});
```

The React node view renders:

```
┌─────────────────────────────────────────┐
│  ⬡ Payment Methods                     │
│  Expands into your configured payment   │
│  options.                               │
│                            [Configure]  │
└─────────────────────────────────────────┘
```

Clicking "Configure" opens `PaymentMethodsManager` in a modal overlay (see Decisions section above).

**UX copy for the modal:**
- Title: "Payment Methods"
- Subtext: "Changes here update the payment methods block used in invoice emails."

**Insertion semantics:**
- Block tokens insert as standalone blocks, not inline content.
- If inserted in the middle of a paragraph, the paragraph is split before and after the block token.
- Block tokens cannot coexist inline with surrounding sentence text.

#### Slash-Command Autocomplete

Use TipTap's `Suggestion` utility (the same mechanism used by TipTap's mention extension) to implement slash commands.

**Trigger:** `/` typed in normal text context opens the command menu. `%` also opens token suggestions for users familiar with the legacy syntax.

**Popover content:** All available tokens and block tokens, filtered by the text typed after the trigger. Text-replacement tokens and block tokens are separated visually. Do not include formatting commands in the first release. Keep the menu focused on tokens and block tokens only.

```
┌──────────────────────────────────────┐
│  First Name          text field      │
│  Last Name           text field      │
│  Full Name           text field      │
│  Billing Year        text field      │
│  Household Total     text field      │
│  ──────────────────────────────────  │
│  Payment Methods     block           │
│  Share Link          block           │
└──────────────────────────────────────┘
```

**Keyboard navigation:** Arrow keys move the highlight, Enter/Tab inserts the highlighted item, Escape closes the popover. Clicking an item inserts it. The popover is positioned below the cursor using TipTap's `clientRect` callback from the `Suggestion` utility.

**Discoverability:** When the editor is empty and focused, the `Placeholder` extension shows: "Type your message, or press / to insert a field…"

**Keep the chip bar.** The "Insert fields" chip buttons above the editor remain as a secondary insertion mechanism. They call `editor.chain().focus().insertContent(...)` to insert the token node at the current cursor position. Normalize the label to "Insert:" for both subject and body. Once usage data shows people using the autocomplete, consider removing the chips.

#### Storage Format

**Canonical storage format: TipTap/ProseMirror JSON in Firestore (`settings.emailMessageDocument`).**

**Rationale:** JSON is the editor's native document model. Persisting HTML would require round-tripping through TipTap's HTML parser/serializer on every load/save cycle, which is lossy: attribute ordering changes, whitespace normalizes, unrecognized elements get stripped, and parser/serializer behavior can shift across TipTap or extension updates. The result is phantom dirty states, noisy diffs, and apparent mutations on no-op saves—users say "I didn't change anything" and the stored template is different anyway. Persisting JSON avoids serializer drift, preserves node attributes exactly, and produces stable dirty-state comparisons.

**Derived outputs:**
- HTML is generated from JSON for Preview rendering
- Email-safe HTML is generated from JSON for final outbound email rendering
- Plaintext fallback can be generated separately if needed (e.g., for SMS invoice variants)

**Migration from legacy format:** On first load, if `settings.emailMessage` is a legacy plain-text string, run a best-effort converter that transforms it directly into ProseMirror JSON—do not convert to persisted HTML as an intermediate format:
1. Split paragraphs on blank lines / newlines
2. Replace `%token%` patterns with token nodes using the normalized token IDs
3. Convert a narrow, explicit subset of legacy formatting only:
   - `**bold**` → strong mark
   - `[text](url)` → link mark
   - `---` on its own line → horizontal rule node
4. Persist the ProseMirror JSON document to `settings.emailMessageDocument`

This is not full Markdown support. It is a best-effort migration for the current known template patterns. The migration must be idempotent and must skip already migrated documents.

**Backward compatibility:** `buildInvoiceBody` in `invoice.js` must handle:
1. Legacy plain-text templates containing `%token%` syntax (read from `settings.emailMessage`)
2. The new TipTap JSON document format (read from `settings.emailMessageDocument`)

Preview/email rendering should resolve token nodes during document-to-HTML conversion rather than by direct HTML string replacement wherever possible.

#### Editor Toolbar

Place a minimal formatting toolbar between the chip bar and the editor. TipTap provides `editor.isActive('bold')` etc. for toggle state.

```
  B   I   Link   •   1.   ─
```

Six buttons: Bold, Italic, Link, Bullet List, Ordered List, Horizontal Rule. No headings in the toolbar—these are email templates, not documents. If headings are needed later, they can be inserted via slash command.

Style the toolbar to match the existing `.template-token-bar` aesthetic—same height, same chip-like buttons, same spacing. Active state uses `background: rgba(110, 120, 214, 0.12)`.

#### Paste Handling

- Pasted content must be sanitized to the supported schema.
- Unsupported formatting should be stripped rather than producing invalid or email-hostile markup.
- Pasting content containing recognized legacy `%token%` strings should convert those strings into token nodes.

### 3. Subject Line Editor

The subject line uses a constrained single-line editor with token pill support. It may be implemented as either:
- a constrained TipTap instance, or
- a lighter token-aware single-line input

The user-facing behavior must be identical either way.

- **Allowed content:** plain text + inline token pills only
- **No rich formatting:** No bold, italic, links, lists, images, tables, or block tokens
- **Single line:** Suppress Enter and strip pasted line breaks
- **Appearance:** Styled to look like the existing `.composer-input` field—same height, border, padding, focus ring—but with token pill rendering inside

The subject line shares the same token vocabulary and slash-command autocomplete as the body editor, but with a filtered token list (exclude `%payment_methods%` and `%share_link%`).

Create this as a `<SubjectEditor />` component with a stable single-line tokenized editing contract.

### 4. Tabbed Edit/Preview Layout

Replace the current stacked editor-then-preview layout with a tabbed view.

#### Tab Bar

Two tabs: **Edit** and **Preview**.

```jsx
<div className="template-tab-bar">
  <button className={`template-tab ${tab === 'edit' ? 'active' : ''}`}
    onClick={() => setTab('edit')}>Edit</button>
  <button className={`template-tab ${tab === 'preview' ? 'active' : ''}`}
    onClick={() => setTab('preview')}>Preview</button>
</div>
```

#### Edit Tab

Contains:
1. Subject line editor (`<SubjectEditor />`)
2. Insert chip bar (label: "Insert:")
3. Formatting toolbar (B, I, Link, •, 1., ─)
4. Body editor (TipTap WYSIWYG)
5. Sticky save bar at the bottom

Remove the instructional paragraph ("Customize the message included in email invoices…"). Replace with a one-line hint below the section heading: "Use / to insert billing fields. Formatting is applied as you type."

#### Preview Tab

The Preview tab's role changes with TipTap. It is no longer the only place to see formatted output—the Edit tab is now WYSIWYG. The Preview tab's distinct purposes are:

1. **Token resolution:** Show the email with all tokens replaced by actual member data
2. **Block token expansion:** Show `%payment_methods%` and `%share_link%` expanded into their full rendered form
3. **Member selector:** Cycle through members to see how the email looks for each recipient
4. **Email-safe verification:** Show the output in an email-like rendering context

Contents:
1. **Metadata bar** (compact grid): To, Subject, Link
2. **Member selector dropdown:** Default to first member
3. **Rendered email body:** Fully resolved content in the `invoice-preview-message` container
4. **"Send test email" button:** In the metadata bar area

Remove the standalone "LIVE PREVIEW" label—the tab structure makes it self-evident.

**State preservation requirements:**
- Switching between Edit and Preview must preserve unsaved editor state.
- Current member selection in Preview should persist while the user remains on the page.
- Opening and closing modal overlays from block tokens must not reset the editor or preview state.

#### Tab Styles

```css
.template-tab-bar {
  display: flex;
  gap: var(--space-1, 4px);
  margin-bottom: var(--space-3, 12px);
}

.template-tab {
  padding: var(--space-1, 4px) var(--space-3, 16px);
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 999px;
  background: var(--color-surface, #ffffff);
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-secondary, #5B6475);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.template-tab.active {
  background: var(--color-primary, #6E78D6);
  color: var(--color-text-inverse, #ffffff);
  border-color: var(--color-primary, #6E78D6);
}
```

### 5. Save Behavior

#### Dirty-State Indicator + Sticky Save

- Track dirty state by comparing normalized JSON documents, not exported HTML strings. This is critical—comparing serialized HTML would reintroduce the exact round-trip instability that JSON storage avoids.
- Show a small "Unsaved changes" label next to the tab bar when dirty.
- "Save Template" button in a sticky bar at the bottom of the Edit tab. `position: sticky; bottom: 0;` with a subtle top border and `backdrop-filter: blur(8px)`.
- On save, flash "Saved ✓" for 1.5 seconds.

#### Auto-Save (Phase 2—Follow-Up PR)

Add debounced auto-save (2-second delay) once the TipTap editor and persistence model are stable in production. Show "Saving…" / "Saved" status inline. Keep the manual save button as a fallback.

### 6. Typography and Spacing Normalization

| Element | Current | Target |
|---|---|---|
| Section headings ("Email Template") | Inconsistent size/weight | `1rem / 600` weight, `var(--color-text)` |
| Field labels ("Subject Line", "Email Message") | `.payment-field-group label` (0.82rem) | `0.82rem / 500`, `var(--color-text-secondary)` |
| Helper text | Mixed sizes, inline `style` overrides | `0.78rem / 400`, `var(--color-text-secondary)` |
| Section spacing | Varies between 12px and 40px+ | `24px` between form groups within a section |
| Top-level section spacing | No clear rhythm | `40px` between major sections |

Remove all inline `style` attributes in `InvoicingTab.jsx` (three current instances). Replace with CSS classes.

### 7. Preview Metadata Consolidation

Consolidate the current three separate `.invoice-preview-meta` divs into a single compact grid:

```css
.invoice-preview-meta-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 0.78rem;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border-light, #f0f0f0);
}

.invoice-preview-meta-grid .invoice-preview-meta-label {
  color: var(--color-text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.7rem;
  align-self: center;
}
```

### 8. Share Link in Preview

Simplify:

- No share link exists → "Generate share link" button (secondary style)
- Share link exists → truncated URL + "Copy" button + "Manage links" text link opening `ShareLinkDialog`
- Remove the `ActionMenu` for share link options

---

## File-Level Changes

### New Files

| File | Purpose |
|---|---|
| `src/app/components/TemplateEditor.jsx` | TipTap body editor with custom nodes, slash-command autocomplete, formatting toolbar |
| `src/app/components/SubjectEditor.jsx` | Constrained single-line token editor |
| `src/app/components/TokenNode.js` | TipTap custom inline node extension for text-replacement tokens |
| `src/app/components/BlockTokenNode.js` | TipTap custom block node extension for `%payment_methods%` and `%share_link%` |
| `src/app/components/BlockTokenNodeView.jsx` | React node view for block token rendering and modal triggers |
| `src/app/components/SlashCommandMenu.jsx` | Autocomplete popover component built on `@tiptap/suggestion` |
| `src/app/components/TemplateEditor.css` | Styles for editor, toolbar, autocomplete, block token cards, subject-line variant |

### Modified Files

| File | Changes |
|---|---|
| `src/app/views/Manage/InvoicingTab.jsx` | Replace `contentEditable` + chip bars with `<TemplateEditor />` and `<SubjectEditor />`; add tabbed layout; remove stacked preview; consolidate preview metadata; remove inline styles; add member selector; add block token modal triggers for `PaymentMethodsManager` and `ShareLinkDialog`; remove `buildEditorHTML()`, `extractTemplateValue()`, and `placeCaretAtEnd()` helper functions |
| `src/app/shell.css` | Add tab bar, toolbar, sticky save bar, block token, and preview grid styles; remove legacy `.template-editor-textarea` |
| `src/lib/invoice.js` | Handle both legacy plain-text templates and TipTap document rendering; add new token name aliases; resolve token nodes during document-to-email rendering |
| `src/lib/BillingYearService.js` | One-time idempotent migration: plain-text → TipTap document, old token names → new names |
| `package.json` | Add: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image`, `@tiptap/extension-table`, `@tiptap/extension-placeholder`, `@tiptap/suggestion` |

### Unchanged Files

- `src/app/components/EmailInvoiceDialog.jsx`—uses `invoice.js`; no changes as long as the lib handles both formats
- `src/app/components/TextInvoiceDialog.jsx`—same
- `src/app/components/PaymentMethodsManager.jsx`—reused as-is in the modal overlay
- `src/app/views/Settings/SettingsView.jsx`—no changes
- `src/app/views/Manage/ManageView.jsx`—no changes
- `src/app/components/AppShell.jsx`—no changes

---

## Implementation Order

### Phase 1: Token Normalization + Dependencies

1. Install TipTap packages. Verify Vite builds correctly.
2. Add new token names as aliases in `invoice.js`. Both old and new resolve to the same value.
3. Update `EMAIL_TEMPLATE_FIELDS` and `SUBJECT_TOKEN_FIELDS` to use new token names.
4. Add idempotent migration function with `_templateMigrated` flag.

### Phase 2: TipTap Body Editor

1. Create `TokenNode.js`. Test insert, pill rendering, document serialization round-trip.
2. Create `BlockTokenNode.js` + `BlockTokenNodeView.jsx`. Test "Configure" action opening `PaymentMethodsManager` modal.
3. Create `TemplateEditor.jsx` with StarterKit (headings disabled) + Link + custom extensions + Placeholder.
4. Create `SlashCommandMenu.jsx` using `@tiptap/suggestion`.
5. Add formatting toolbar (B, I, Link, •, 1., ─).
6. Write legacy plain-text → TipTap document migration converter.
7. Update `buildInvoiceBody` to handle TipTap document rendering and token resolution.
8. Wire `TemplateEditor` into `InvoicingTab`, replacing the `contentEditable` div and chip bars.
9. Add paste sanitization and legacy `%token%` → token-node conversion.

### Phase 3: Subject Line Editor

1. Create `SubjectEditor.jsx` with constrained single-line token behavior.
2. Wire into `InvoicingTab`, replacing the `<input>` + chip bar.
3. Verify autocomplete works in single-line mode with filtered token list.
4. Verify pasted line breaks are stripped and tokens remain atomic.

### Phase 4: Tabbed Layout + Preview Consolidation

1. Add tab bar. Swap between Edit and Preview views.
2. Compact preview metadata grid.
3. Member selector dropdown in Preview tab.
4. Sticky save bar with dirty-state indicator.
5. Replace instructional paragraph with one-line hint.
6. Verify tab switching preserves unsaved state.

### Phase 5: Visual Polish

1. Remove all inline `style` attributes from `InvoicingTab.jsx`.
2. Normalize typography and spacing per section 6.
3. Simplify share link display per section 8.
4. Test mobile viewport—editor, toolbar, autocomplete, tabs.

---

## Acceptance Criteria

- [ ] Body editor is a TipTap WYSIWYG editor—bold appears bold, links appear as links, lists render as lists
- [ ] Tokens render as non-editable inline pills in both subject line and body editor
- [ ] Pill labels match chip labels (e.g., "Full Name" not `%member_name%`)
- [ ] `%payment_methods%` and `%share_link%` render as visually distinct block-level cards, not inline pills
- [ ] Block tokens insert as standalone blocks and cannot remain inline inside text paragraphs
- [ ] Clicking "Configure" on `%payment_methods%` opens `PaymentMethodsManager` in a modal overlay without navigation
- [ ] Opening and closing the Payment Methods modal preserves editor content and selection state
- [ ] Typing `/` or `%` opens an autocomplete popover listing available tokens
- [ ] Autocomplete filters as the user types after the trigger character
- [ ] Arrow keys, Enter, Tab, and Escape work in the autocomplete popover
- [ ] Empty editor shows placeholder: "Type your message, or press / to insert a field…"
- [ ] Chip bar buttons still work as a secondary insertion mechanism
- [ ] Formatting toolbar provides Bold, Italic, Link, Bullet List, Ordered List, Horizontal Rule
- [ ] Subject line editor is single-line with token pills only—no rich formatting, no block tokens
- [ ] Subject line cannot accept line breaks via keyboard or paste
- [ ] Deleting a token pill removes it atomically without corrupting adjacent text
- [ ] Tab bar switches between Edit and Preview without page scroll or state loss
- [ ] Preview tab shows fully rendered email with resolved tokens for a selectable member
- [ ] Preview tab shows `%payment_methods%` expanded into the actual payment method list
- [ ] Current Preview member selection persists while the user remains on the page
- [ ] "Send test email" is accessible from the Preview tab
- [ ] "Save Template" button is sticky at the bottom of the Edit view
- [ ] "Unsaved changes" indicator appears when template has been modified
- [ ] Legacy plain-text templates with old token syntax auto-migrate to TipTap document format on first load
- [ ] Legacy migration is idempotent and does not re-convert already migrated content
- [ ] Legacy token names still resolve in `invoice.js` for un-migrated data
- [ ] Body template is persisted as TipTap JSON in Firestore (`settings.emailMessageDocument`)
- [ ] `buildInvoiceBody` handles both legacy plain-text and new TipTap document templates
- [ ] Pasted content is sanitized to the supported schema; unsupported formatting is stripped
- [ ] No inline `style` attributes remain in `InvoicingTab.jsx`
