# Ticket: Add esbuild Bundling to Enable Incremental Modularization (Preserve Classic Scripts + Existing Tests)

## Summary
Introduce **esbuild** as a minimal bundler so we can split `script.js` into ES modules under `/src/**` **without changing runtime behavior**:

- Keep **classic `<script>` tags** and **Firebase CDN globals** working.
- Bundle modules into **one output file** (single `script.js`) so:
  - HTML remains effectively unchanged
  - The existing test harness that `vm.runInContext()` a single script string continues to work
- Preserve **legacy inline `onclick` handlers** by exporting the existing ~55 callable functions to `window.*` from a single entrypoint during transition.

This is the lowest-risk path to modularization and regression reduction.

---

## Context / Current Constraints (must not regress)
- App uses classic `<script>` tags; no build tools today.
- Firebase SDK is loaded via CDN as classic scripts.
- `firebase-config.js` exposes `auth`, `db`, `storage`, `analytics` as globals (classic scripts can access; ES module scope cannot).
- There are **82 inline `onclick` handlers** calling ~**55 unique functions**; those functions must remain available on `window.*` during transition.
- Tests: **267** tests run `vm.runInContext()` against a **single `script.js` string** — will break if we move to multi-file runtime modules.

---

## Proposed Approach
**Adopt Option A:** Add esbuild and bundle ES modules into a **single classic script output**.

### Key design choices
1) **Write ES modules in `/src/**`** with `import`/`export`.
2) Bundle via esbuild into **one file**: `dist/script.js` (or directly to `script.js` if we prefer zero path changes).
3) Keep HTML as classic scripts; **no `type="module"`** required.
4) Keep Firebase via CDN; do **not** import Firebase SDK modules.
5) Add a small bridging module to access Firebase globals via `window.*`.
6) Keep legacy inline handlers working by exporting a curated API surface to `window.*` from `src/index.js`.

---

## Deliverables
- `esbuild` added to `devDependencies`.
- Build scripts in `package.json`:
  - `npm run build` → bundles `src/index.js` to `dist/script.js`
  - `npm run build:watch` (optional) → watch mode
- One entrypoint: `src/index.js`
- Firebase globals bridge module: `src/platform/firebase.js`
- Updated tests to load bundled output (single string) instead of raw `script.js` source.
- (Optional) Copy step so HTML still references `./script.js` without modification.

---

## Implementation Details

### 1) Add esbuild + build scripts
**package.json**
- Add:
  - `devDependencies: { "esbuild": "<latest>" }`
- Add scripts (example):
  - `build`: `esbuild src/index.js --bundle --format=iife --global-name=FFB --outfile=dist/script.js --sourcemap`
  - `build:watch`: same + `--watch`

**Why `format=iife`?**
- Produces a single classic-script-friendly bundle.
- Avoids ES module runtime semantics.
- Plays nicely with existing HTML and Firebase globals.

**`--global-name=FFB`**
- Optional but recommended: gives us an internal namespace (e.g., `FFB`) while still exporting legacy functions to `window.*`.

### 2) Output path strategy (choose one)
**Option 2A (recommended):** output to `dist/script.js` and update HTML to reference it.  
**Option 2B (zero HTML changes):** output to `dist/script.js` then copy to root `./script.js` in the build script.

If we want zero HTML changes now, do 2B:
- `build`: `esbuild ... --outfile=dist/script.js && cp dist/script.js script.js`

### 3) Firebase globals bridge (no SDK imports)
Create `src/platform/firebase.js`:

```js
export const firebase = {
  auth: window.auth,
  db: window.db,
  storage: window.storage,
  analytics: window.analytics,
};
```

**Precondition:** `firebase-config.js` must assign these to `window.*` (if it currently uses `const auth = ...`, update it to `window.auth = ...` etc.).

### 4) Entry point + legacy window exports
Create `src/index.js` that:
- Initializes app
- Attaches legacy callable functions used by inline `onclick` to `window.*`

Example pattern:
```js
import * as members from "./domains/members.js";
import * as bills from "./domains/bills.js";
import * as payments from "./domains/payments.js";
import { initApp } from "./ui/render.js";

initApp();

// Transitional legacy surface (keep stable)
window.addMember = members.addMember;
window.addBill = bills.addBill;
window.recordPayment = payments.recordPayment;
```

**Rule:** Export only the curated ~55 functions required for existing inline handlers (track in a list).

### 5) Tests: keep `vm.runInContext()` by reading bundled output
Update the test harness to:
- Run `npm run build` (or import the built file in setup)
- Read `dist/script.js` (or `./script.js` if copy step used)
- Continue using `vm.runInContext()` exactly as today, but with the bundle string

This preserves the single-file test execution model.

### 6) Source maps (developer QoL)
Enable `--sourcemap` so stack traces map to `/src/**` during debugging.

---

## Acceptance Criteria

### Build / Run
- [ ] `npm run build` produces **one** bundle file.
- [ ] App loads in browser with **no changes** to runtime behavior.
- [ ] Firebase access works (auth/db/storage/analytics are available where needed).
- [ ] No build step required to run in production beyond the bundling step (deployment can upload the bundled `script.js`).

### Inline handlers
- [ ] All existing inline `onclick` flows continue to work.
- [ ] The ~55 legacy functions are present on `window.*` after load.

### Tests
- [ ] All 267 tests pass using the bundled single-file output.
- [ ] No tests require module-aware execution; the harness still evaluates one string.

### Performance / Practicality
- [ ] Build time is “near-instant” (target: single-digit milliseconds typical on dev machines).
- [ ] No runtime perf regression noticeable for typical UI interactions.

---

## Out of Scope (future tickets)
- Migrating HTML to native modules (`type="module"`)
- Replacing inline `onclick` with event delegation
- Importing Firebase SDK as modules (switching off CDN globals)
- Full TS migration (if desired)

---

## Engineering Notes / Gotchas
- Ensure `firebase-config.js` uses `window.*` assignments so both classic scripts and the bundled code can access Firebase references reliably.
- Avoid importing any Firebase module packages; keep CDN script loading consistent.
- Keep the legacy window API stable; don’t rename functions until inline handlers are removed (future cleanup ticket).

---

## Task Breakdown
1) Add esbuild dependency + scripts in `package.json`
2) Create `/src/index.js` entrypoint
3) Add `/src/platform/firebase.js` to bridge globals
4) Configure bundle output + sourcemaps
5) Update tests to load bundle output via `vm.runInContext()`
6) Smoke test in browser (login, add bill/member, record payment, share link)
