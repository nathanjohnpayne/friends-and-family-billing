# Friends & Family Billing — React Migration Plan

> **App:** https://friends-and-family-billing.web.app/
> **Current Stack:** Vanilla JS (esbuild) + Firebase
> **Target Stack:** React (Vite) + React Router + Firebase
> **Date:** March 19, 2026 (updated March 20, 2026)
> **Author:** Migration plan by Claude, commissioned by Nathan Payne

---

## Why Migrate

The app is a ~6,000-line vanilla JS monolith (`src/main.js`) that renders everything via `innerHTML` string concatenation, manages state through module-scoped variables, and handles events via 195 `window.*` inline `onclick` handlers exported via `src/index.js`. The UX mitigation spec (`specs/ffb-mitigation-plan.md`) calls for routing, modals, responsive component state, and information architecture changes — all of which strain the current approach.

**What React solves:**
- **Routing (P0.1):** React Router replaces a hand-rolled hash router
- **Component state (P1.2, P1.3):** Modals, disabled buttons, expanded panels become declarative
- **Restructuring (P2.x):** Moving UI between views is safe when components are self-contained
- **Testability:** Component-level testing replaces the current VM-context test harness
- **Maintainability:** 4,700 lines of string concatenation becomes composable components

**What React costs:**
- Upfront migration effort (Phase 0 below)
- New build tooling (Vite replaces esbuild)
- Test rewrite (React Testing Library replaces VM-context approach)
- Firebase SDK shift from CDN compat to modular npm imports

---

## Migration Strategy: Shared-Logic Strangler

Extract shared domain logic into pure ES modules first, then build the React SPA on top of those modules. **Do not** mount React beside vanilla JS DOM-by-DOM — instead, do a full SPA cutover after the React app reaches route parity.

`src/index.js` stays as the `window.*` bridge throughout migration, importing from the extracted modules instead of `main.js`. Delete it only at final cutover when no inline handlers remain.

---

## Pre-Migration: Vanilla JS Quick Wins (PRs 1–4) ✅ DONE

Shipped March 19, 2026:

| PR | Items | Description | Status |
|----|-------|-------------|--------|
| 1 | P0.4 | Fix invoice template duplication bug | ✅ |
| 2 | P0.2 | Sticky tab bar (CSS-only) | ✅ |
| 3 | P1.1 + P1.3 | Fix status contradiction + disable invoice for settled | ✅ |
| 4 | P1.2 + P1.4 | Confirmation modals + clarify frequency label | ✅ |

---

## Pre-Migration: Domain Logic Extraction — IN PROGRESS

Extract pure domain logic out of `src/main.js` into importable modules. `main.js` keeps thin wrappers that pass module-scoped state to the pure versions. Order matters (safest → riskiest):

| Priority | Module | Functions | Risk | Status |
|----------|--------|-----------|------|--------|
| 1 | `src/lib/calculations.js` | `getBillAnnualAmount`, `getBillMonthlyAmount`, `calculateAnnualSummary`, `getPaymentTotalForMember`, `getMemberPayments`, `isLinkedToAnyone`, `getParentMember`, `calculateSettlementMetrics` | Low | ✅ |
| 2 | `src/lib/validation.js` | `detectDuplicatePaymentText`, `isValidE164`, `normalizeDisputeStatus`, `generateEventId`, `generateUniquePaymentId`, `generateRawToken`, `hashToken`, `generateUniqueId`, `generateUniqueBillId`, `isArchivedYear`, `isClosedYear`, `isSettlingYear`, `isYearReadOnly`, `yearReadOnlyMessage` | Low | ✅ |
| 3 | `src/lib/formatting.js` | `PAYMENT_METHOD_LABELS`, `BILLING_YEAR_STATUSES`, `BILLING_EVENT_LABELS`, `DISPUTE_STATUS_LABELS`, `PAYMENT_METHOD_TYPES`, `PAYMENT_METHOD_ICONS`, `getPaymentMethodLabel`, `getBillingYearStatusLabel`, `getBillFrequencyLabel`, `formatAnnualSummaryCurrency`, `formatFileSize`, `escapeHtml`, `sanitizeImageSrc`, `getInitials`, `getPaymentMethodIcon`, `getPaymentMethodStripIcon`, `getPaymentMethodDetail`, `disputeStatusClass` | Low | ✅ |
| 4 | `src/lib/billing-year.js` | `setBillingYearStatus`, `closeCurrentYear`, `archiveCurrentYear`, `startNewYear` | Medium | Pending |
| 5 | `src/lib/persistence.js` | `saveData`, `loadData`, `loadBillingYearData`, `_saveChain` | High | Pending |
| 6 | `src/lib/share.js` | `generateShareLink`, `revokeShareLink`, `refreshPublicShares` | Medium | Pending |

---

## Phase 0: Scaffold & Infrastructure

**Goal:** Set up the React project alongside the existing code, establish patterns, and migrate Firebase integration.

### 0.1 Initialize Vite + React

- `npm create vite@latest` with React + **JSX** (not TypeScript — add TS later via incremental `.jsx` → `.jsx` rename)
- Vite outputs to `dist/`; Firebase Hosting stays `"public": "."` until final cutover
- Set up path aliases (`@/components`, `@/hooks`, `@/lib`)
- Add ESLint + Prettier config for React

### 0.2 Dual Build Coexistence

- `npm run build` → runs both `build:legacy` (esbuild → `script.js`) and `build:react` (Vite → `dist/`)
- `npm test` → runs both `test:legacy` (VM context against `script.js`) and `test:react` (Vitest)
- Legacy VM-context tests retire module-by-module: each test retires when the React component that replaces its corresponding `render*()` function passes its own RTL tests
- At cutover: delete `build:legacy`, `test:legacy`, `script.js`, switch `firebase.json` to `"public": "dist"`

### 0.3 Firebase SDK Migration

- Install `firebase` npm package (modular v10+)
- Create `src/lib/firebase.js` — initialize app with `initializeApp(config)`, export `auth`, `db`, `storage`, `analytics`
- Config bridge: legacy path uses CDN `<script>` tags → `window.*`; React path uses `import { initializeApp } from 'firebase/app'` with config from `.env.local`
- Keep `firebase-config.local.js` as source of truth during coexistence
- At cutover: remove CDN scripts, remove `firebase-config.js`, move config to `.env.local` (gitignored)

### 0.4 Auth Context & Login Page

- Create `AuthProvider` context wrapping the app
- `useAuth()` hook returns `{ user, loading, signOut }`
- Port `login.html` / `auth.js` (~170 lines) to a React `/login` route in this phase — React owns auth context, so it should own the login page
- During coexistence: both `login.html` and React `/login` work; `firebase.json` rewrites control which serves

### 0.5 Data Layer

- Split into 4 focused services (not a single `BillingRepository`):
  - `initFirebase()` — one-time Firebase app + auth listener init
  - `BillingYearService` — load year list, switch active year, create/archive
  - `SaveQueue` — serializes Firestore writes (generic middleware)
  - `ShareSyncService` — post-save hook that denormalizes to `publicShares`
- **Critical:** `SaveQueue` must own canonical state, not React. Mutations go through the service → update internal state → trigger save → notify React via `useSyncExternalStore`. This preserves the current invariant: state is always stable when `saveData()` runs.
- React reads from the services via context + `useSyncExternalStore`

### 0.6 Build & Deploy

- Update `package.json` scripts: `dev`, `build`, `build:legacy`, `build:react`, `preview`
- `stamp-version.js` writes to both repo root (legacy) and `dist/` (Vite)
- Verify `op-firebase-deploy` works with the legacy build path during coexistence

**Acceptance criteria:**
- `npm run dev` serves the React app with hot reload
- `npm run build` produces both legacy and React bundles
- `npm test` passes both legacy (287+ tests) and React test suites
- Auth works (sign in, sign out, Google Sign-In)
- Data loads from Firestore into React state

---

## Phase 1: Shell & Navigation (includes P0.1)

**Goal:** Build the app shell with React Router, replacing the single-page scroll.

### Components

- `AppShell` — persistent nav bar + `<Outlet />`
- `NavBar` — brand, Dashboard link, Manage link, user indicator, logout
- `DashboardView` — hero, status, annual summary
- `ManageView` — tabbed layout with sub-routes
- `SettingsView` — billing controls (P2.7)

### Routes

```
/                    → redirect to /dashboard
/dashboard           → DashboardView
/manage              → redirect to /manage/members
/manage/members      → ManageView > MembersTab
/manage/bills        → ManageView > BillsTab
/manage/invoicing    → ManageView > InvoicingTab
/manage/reviews      → ManageView > ReviewsTab
/settings            → SettingsView
```

### Migration steps

1. Build `AppShell` + `NavBar` + route config
2. Port `DashboardView` — extract `renderDashboardStatus()` + `updateSummary()` into React components
3. Port `ManageView` — extract tab bar + panel switching into React Router nested routes
4. Port `SettingsView` — extract `renderBillingYearSelector()` into a React component
5. Remove the vanilla JS tab switching and section visibility logic
6. Remove the old utility bar and hero markup from `index.html`

**Acceptance criteria:**
- `/manage/bills` loads the Bills tab directly
- Browser back/forward works between all views
- Deep links work
- Dashboard and Manage are separate views, no scrolling between them

---

## Phase 2: Core Components (includes P0.3, P2.1–P2.6)

**Goal:** Port the main UI components to React, applying the UX mitigation fixes as part of the port.

### Settlement Board (Dashboard)

- `SettlementBoard` — filter bar + household card list + totals footer
- `HouseholdCard` — collapsible card with amounts, actions, detail panel
- `HouseholdDetail` — calculation breakdown, linked members, share link actions
- Apply P0.3 mobile fixes as responsive CSS during the port
- Apply P2.3 (promote Details expansion) — use a styled `<button>` + expand/collapse all
- Apply P2.4 (consolidate share links) — single surface in overflow menu

### Members Tab

- `MembersList` — grid of member cards + add member composer
- `MemberCard` — avatar (clickable for photo), name, email, phone, linked pills, actions
- Apply P2.1 (reduce button clutter) — photo management via avatar click + three-dot menu only
- Apply P2.6 (empty states) — guided empty state with CTA

### Bills Tab

- `BillsList` — grid of bill cards + add bill composer
- `BillCard` — logo, name, amount, cadence summary, split info, More menu
- Apply P2.2 (reduce density) — hide URL, consolidate cadence, merge split info
- Apply P2.5 (reconcile More menu) — Edit Split in menu, reordered items
- Apply P2.6 (empty states) — guided empty state with CTA

### Invoicing Tab

- `InvoicingSettings` — template editor, token chips, live preview, payment methods
- Template duplication fix (P0.4) already shipped in pre-migration PR 1

### Review Requests Tab

- `DisputesList` — filter bar + dispute cards
- `DisputeDetail` — detail dialog with evidence, actions, resolution

### Shared Components

- `ConfirmationDialog` — reusable modal (replaces P1.2 vanilla implementation)
- `ActionMenu` — dropdown menu for three-dot menus
- `EmptyState` — reusable empty state with title, description, CTA
- `StatusBadge` — semantic-colored badges (applies P3.2)
- `Toast` — notification toasts

**Acceptance criteria:**
- All tabs render correctly with data from Firestore
- Mobile responsive at 375px (P0.3)
- Member cards show ≤2 surface actions (P2.1)
- Bill cards show ≤8 elements (P2.2)
- Empty states have CTAs (P2.6)

---

## Phase 3: Dialogs & Interactions

**Goal:** Port all dialog/modal interactions to React.

### Dialogs to port

- `AddPaymentDialog` — record payment with distribution preview
- `EmailInvoiceDialog` — compose and send email invoice
- `TextInvoiceDialog` — compose and send text invoice
- `ShareLinkDialog` — generate share link with options
- `ManageShareLinksDialog` — view/revoke share links
- `PaymentHistoryDialog` — view payment ledger
- `BillAuditHistoryDialog` — view bill change history
- `LinkHouseholdDialog` — manage linked members
- `EvidenceModal` — view dispute evidence

### Migration steps

1. Create a `DialogProvider` context with `useDialog()` hook
2. Port each dialog as a React component
3. Replace all `ensureDialogContainer()` + `innerHTML` patterns
4. Replace remaining `confirm()` / `prompt()` / `alert()` calls with styled dialogs

**Acceptance criteria:**
- All dialogs open/close correctly
- No native `confirm()`, `prompt()`, or `alert()` calls remain
- Dialogs are accessible (focus trap, escape to close, aria attributes)

---

## Phase 4: Polish & Cleanup (includes P3.x)

**Goal:** Final cleanup, visual polish, and removal of all vanilla JS code.

### 4.1 Visual Polish

- Apply P3.1 (bill visual weight) — tier-based left-border already exists, enhance
- Apply P3.2 (color palette) — use semantic color tokens consistently for status badges
- Apply P3.3 (share link member view) — audit and polish the share link landing page

### 4.2 Port Public Share Page

- Port `share.html` (standalone page with inline Firestore reads) to a React `/share` route
- This goes last because it's the simplest page, has no auth dependency, and is the lowest-traffic route
- During coexistence: `share.html` stays working; `firebase.json` rewrites control which serves
- At cutover: remove `share.html`, add backward-compatible redirect for old URLs

### 4.3 Remove Vanilla JS

- Delete `src/main.js` (the monolith)
- Delete `src/index.js` (the window export bridge)
- Delete `src/platform/firebase.js` (the CDN bridge)
- Remove all `window.*` function assignments
- Remove all inline `onclick` handlers from any remaining HTML
- Remove esbuild from devDependencies

### 4.4 Test Migration

- Replace `tests/billing.test.js` VM-context approach with:
  - Unit tests for extracted lib modules (Vitest — these can start immediately since lib/ is already extracted)
  - Component tests with React Testing Library
  - Integration tests for data flows
- Legacy VM-context tests retire module-by-module: each test retires when the React component that replaces its corresponding `render*()` function passes its own RTL tests
- Maintain CI `check_spec_test_alignment` compliance

### 4.5 Playwright Smoke Suite

- Runs against `firebase emulators:exec` with seed data (no production Firestore dependency)
- CI gate on `main` branch, runs after `npm test` (emulators are single-tenant)
- Initial scope (4 tests): login redirect, bill CRUD, share page load, 375px mobile viewport

### 4.6 Documentation Updates

- Update `AGENTS.md` project structure section
- Update `.ai_context.md` key entry points and tech stack
- Update `DEPLOYMENT.md` if build process changed

**Acceptance criteria:**
- No vanilla JS rendering code remains
- All 287+ existing test cases have React equivalents
- `npm run build` produces a clean bundle
- `npm test` passes all tests
- Deploy to production succeeds via `op-firebase-deploy`

---

## File Impact Summary

### Extracted modules (already shipped)

```
src/lib/
├── calculations.js           # Pure math: annual summaries, settlement metrics, payment totals
├── validation.js             # Predicates, ID generators, year status checks
└── formatting.js             # Constants, labels, string transforms, escaping
```

### New files (React)

```
src/
├── App.jsx                    # Root component with router
├── lib/
│   ├── firebase.js            # Modular Firebase init (reads config from .env.local)
│   ├── BillingYearService.js  # Load/switch/create/archive years
│   ├── SaveQueue.js           # Serialized Firestore write queue
│   ├── ShareSyncService.js    # Post-save publicShares denormalization
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useBillingYear.js
│   │   ├── useBillingData.js
│   │   └── useDialog.js
├── components/
│   ├── AppShell.jsx
│   ├── NavBar.jsx
│   ├── ConfirmationDialog.jsx
│   ├── ActionMenu.jsx
│   ├── EmptyState.jsx
│   ├── StatusBadge.jsx
│   └── Toast.jsx
├── views/
│   ├── Dashboard/
│   │   ├── DashboardView.jsx
│   │   ├── SettlementBoard.jsx
│   │   ├── HouseholdCard.jsx
│   │   └── HouseholdDetail.jsx
│   ├── Manage/
│   │   ├── ManageView.jsx
│   │   ├── MembersTab.jsx
│   │   ├── MemberCard.jsx
│   │   ├── BillsTab.jsx
│   │   ├── BillCard.jsx
│   │   ├── InvoicingTab.jsx
│   │   └── ReviewsTab.jsx
│   └── Settings/
│       └── SettingsView.jsx
└── dialogs/
    ├── DialogProvider.jsx
    ├── AddPaymentDialog.jsx
    ├── EmailInvoiceDialog.jsx
    ├── ShareLinkDialog.jsx
    └── ...
```

### Files to delete (after migration complete)

- `src/main.js` — the monolith
- `src/index.js` — the window export bridge
- `src/platform/firebase.js` — the CDN compat bridge

### Files to modify

- `index.html` — replace inline handlers with React mount point
- `package.json` — add react, react-dom, react-router-dom, vite; remove esbuild
- `firebase.json` — update public directory if Vite output differs
- `styles.css` — keep and import from React (or migrate to CSS modules incrementally)

---

## Risk Mitigation

1. **Regression risk:** Port one view at a time. Keep the vanilla JS code working for unported sections.
2. **Data layer:** Extract pure calculation functions (`calculateAnnualSummary`, `calculateSettlementMetrics`, etc.) into a shared `calculations.ts` first — these can be tested independently and shared during the transition.
3. **Deploy safety:** Test each phase in production behind the same URL. Firebase Hosting rollback is instant if something breaks.
4. **Test coverage:** Write React component tests as each component is ported, before deleting the vanilla JS equivalent.

---

## Implementation Order

| Phase | Effort | Depends On | Ships | Status |
|-------|--------|------------|-------|--------|
| Pre-migration (PRs 1–4) | S–M | Nothing | UX fixes in vanilla JS | ✅ Done |
| Domain extraction (P1–3) | S | PRs 1–4 | Pure lib modules | ✅ Done |
| Domain extraction (P4–6) | M | P1–3 | Year lifecycle, persistence, shares | Pending |
| Phase 0: Scaffold | M | Extraction done | React app boots with auth + data | Pending |
| Phase 1: Shell & Nav | M | Phase 0 | Routing works, two views | Pending |
| Phase 2: Core Components | L | Phase 1 | All tabs ported, P0.3/P2.x applied | Pending |
| Phase 3: Dialogs | M | Phase 2 | All modals ported | Pending |
| Phase 4: Cleanup | M | Phase 3 | Vanilla JS fully removed, Playwright CI | Pending |
