# Epic / Refactor Plan: Incremental Modularization of `script.js` to Improve Agent Output Quality + Reduce Regressions

**Product:** Friends & Family Billing  
**Repo Area:** Frontend (current monolith: `script.js`)  
**Type:** Engineering Epic (tech debt / maintainability)  
**Priority:** High (unblocks faster, safer feature delivery)  
**Approach:** Incremental modularization (no rewrite)

---

## Hypothesis (and why it’s correct)
Splitting `script.js` into domain-owned modules will **materially improve AI-agent output quality** and **reduce regressions**.

### Why agent output improves
AI agents (and humans) perform better when:
- The file is **smaller** and **single-purpose** (reduced context-window waste; fewer unrelated symbols).
- Domain boundaries are explicit (lower chance of editing the wrong logic path).
- Side effects are isolated (agents can safely modify pure modules without fear of hidden coupling).
- Tests exist near the module (agents can run/maintain targeted verification).

In a single monolithic script, agents frequently:
- Misunderstand implicit invariants (state shape, init ordering, hidden globals).
- Introduce regressions by modifying shared helpers used across unrelated UI areas.
- Duplicate logic because it’s hard to discover existing implementations.

**Conclusion:** Incremental modularization is the highest ROI tactic for “agent reliability per LOC changed.”

### Why incremental (not rewrite) reduces regressions
- Preserves shipping velocity by keeping behavior intact.
- Keeps current UI wiring (including inline `onclick`) working during transition.
- Enables “move + test + lock” steps: every extraction is validated before the next.

---

## Design Principles / Constraints
1. **Split by domain ownership**:
   - `billing-years`, `members`, `bills`, `payments`, `share-links`, `disputes`, `rendering`, `utils`
2. **Single central state** (one source of truth).
3. **Single persistence layer** (`saveData` + load) to prevent race conditions and state divergence.
4. **Extract pure helpers first** (lowest risk, easiest to unit test).
5. **Extract side-effect-heavy domains last** (share-links, disputes, payments).
6. **Transition-friendly exports**:
   - Export selected functions to `window.*` to preserve existing inline `onclick` usage.
7. **Tests per module** as it is extracted.
8. **Module size target:** ~200–500 lines; one responsibility each.

---

## Target Architecture

### Directory structure (proposed)
```
/src
  /state
    state.js              # central state container + selectors
    persistence.js        # load/save (single gateway)
  /domains
    billingYears.js
    members.js
    bills.js
    payments.js
    shareLinks.js
    disputes.js
  /ui
    render.js             # top-level rendering orchestration
    components.js         # reusable UI render helpers (optional)
    events.js             # event wiring (optional)
  /utils
    money.js
    dates.js
    ids.js
    dom.js
    validation.js
  index.js                # bootstraps app, exports for legacy onclick
/tests
  money.test.js
  bills.test.js
  ...
```

### Central state (single source of truth)
- `state` module owns one canonical object (e.g., `appState`).
- Domain modules read/update state only via exported functions/selectors.
- Rendering reads via selectors, not raw globals.

### Persistence gateway (single write path)
- `persistence.save(state)` is the only allowed persistence write.
- Domain modules do not call storage APIs directly; they call `persistence.requestSave()` (or similar).

This avoids:
- race conditions (multiple domains writing concurrently),
- partial writes,
- divergent save implementations.

---

## Migration Strategy (Incremental)

### Phase 0 — Baseline safety net (before moving code)
**Goal:** refactor without “silent breakage.”

**Tasks**
- Add a minimal test runner (Jest or Vitest) with one example test.
- Add a “golden” fixture of sample data used by tests.
- Add linting/formatting (recommended).

**Acceptance**
- [ ] `npm test` runs locally (and in CI if present).
- [ ] At least 1 test passes in the baseline.

---

### Phase 1 — Extract pure utilities first (lowest risk)
**Goal:** isolate calculations/helpers; lock them with unit tests.

**Move candidates**
- Money formatting, rounding, allocation math, totals calculations.
- Date/year helpers (billing-year labels, status computation).
- ID generation, validation helpers.

**Outputs**
- `/src/utils/money.js`, `/src/utils/dates.js`, etc.
- Unit tests for each.

**Acceptance**
- [ ] No behavior change in UI.
- [ ] Every extracted util has tests.
- [ ] `script.js` delegates to imported util functions.

---

### Phase 2 — Central state + persistence wrapper (low/medium risk)
**Goal:** consolidate state reads/writes and persistence calls.

**Tasks**
- Create `state.js` with:
  - `getState()` / `setState(updater)`
  - selectors: `selectMembers()`, `selectBills()`, `selectYear()` etc.
- Create `persistence.js`:
  - `load()`
  - `save(state)`
  - optional `queueSave()` (debounce) to reduce repeated writes

**Acceptance**
- [ ] Only `persistence.js` touches storage.
- [ ] Only `state.js` owns the canonical state object.
- [ ] Existing flows still work (create/edit/remove, year switching, etc.)

---

### Phase 3 — Extract rendering (medium risk)
**Goal:** isolate UI rendering orchestration.

**Tasks**
- Create `ui/render.js` responsible for:
  - `renderApp(state)`
  - `renderMembers(...)`, `renderBills(...)`, `renderAnnualSummary(...)`, etc.
- Keep DOM query selectors centralized.
- Keep a stable “render contract” so domain modules don’t manipulate DOM directly.

**Acceptance**
- [ ] Rendering can be invoked deterministically from state changes.
- [ ] No domain module directly writes to DOM (except tracked transitional exceptions).

---

### Phase 4 — Extract domain modules (medium → high risk)
Move one domain at a time, with tests, preserving behavior via `window` exports.

#### 4.1 Members
- CRUD, linking, phone/email validation.
- Tests: add/remove member, link/unlink, phone normalization.

#### 4.2 Bills
- CRUD bills, splits, annual/monthly toggle behavior, derived amounts.
- Tests: split calculations, canonical amount strategy invariants, fixture regression.

#### 4.3 Billing Years
- open/settling/closed/archived lifecycle, archive/start-new-year data retention.
- Tests: archive produces snapshot, new year starts clean but preserves history.

#### 4.4 Payments (side-effect heavy)
- record payments, distribute across linked members.
- Tests: allocation and rounding; “one save per action” semantics.

#### 4.5 Share Links (side-effect heavy)
- create/manage share links; ensure year scoping.
- Tests: uniqueness + member/year scoping + access restrictions.

#### 4.6 Disputes (side-effect heavy)
- request review, attach evidence, resolve/reject.
- Tests: state transitions + evidence metadata.

**Acceptance per domain**
- [ ] 200–500 LOC, single responsibility.
- [ ] Unit tests exist and pass.
- [ ] UI behavior unchanged.
- [ ] Inline `onclick` continues working via `window.*` exports.

---

## Transitional Compatibility: `window` exports
During migration, keep inline handlers working by exporting stable APIs from `src/index.js`:

Examples:
- `window.addMember = members.addMember`
- `window.addBill = bills.addBill`
- `window.recordPayment = payments.recordPayment`
- `window.generateShareLink = shareLinks.generateShareLink`

**Rule:** export a curated surface only; don’t leak internals.

**Acceptance**
- [ ] No inline `onclick` breaks during modularization.
- [ ] Each export has a single owning module.

---

## Testing Strategy (required)
### Minimum bar
- Utils: unit tests
- Domains: unit tests + fixture-driven scenario tests
- Rendering: lightweight tests or snapshots where practical

### Fixture approach
Create `fixtures/baseState.json` representing a realistic dataset (members, bills, splits, payments, years). Use it to validate:
- annual totals consistency
- balances
- settlement states
- share link year scoping

**Acceptance**
- [ ] Every extracted module has tests.
- [ ] 1–2 “scenario tests” validate core invariants on the fixture.

---

## Key Invariants to Protect (regression killers)
- **Money integrity**: totals/rounding unchanged.
- **Single persistence write path**: no double saves, no partial overwrites.
- **Year scoping**: archived years immutable; current-year edits don’t back-propagate.
- **Split logic**: per-person shares consistent with canonical strategy.
- **Share link security model**: link only shows that member’s view for that year.

---

## Deliverables
- Modularized codebase with domains + utils extracted.
- Central state + persistence gateway.
- Tests per module + fixture scenario tests.
- Legacy-compatible `window.*` exports until inline handlers are removed (future cleanup).

---

## Definition of Done
- [ ] `script.js` reduced to a thin bootstrap (or replaced by `src/index.js`).
- [ ] No module > 500 LOC unless explicitly justified.
- [ ] Tests cover extracted modules and run reliably.
- [ ] Core flows validated manually:
  - add/edit members (incl phone)
  - add/edit bills (annual/monthly)
  - record payments
  - generate/use share links
  - archive/start new billing year
  - disputes/reviews (if implemented)
- [ ] Repo docs explain module boundaries + state/persistence contract.

---

## Sequencing Recommendation (practical)
1) Utils (money/dates/ids) + tests  
2) Central state + persistence wrapper  
3) Rendering extraction  
4) Members + Bills + Billing Years  
5) Payments + Share Links + Disputes  
6) Follow-up ticket: replace inline `onclick` with event delegation; remove `window.*` exports

