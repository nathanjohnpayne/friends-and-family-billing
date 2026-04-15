# Repository Rules

## Structure Invariants

The following files must always exist at the repository root and must never be deleted or moved:

- `README.md`
- `AGENTS.md`
- `DEPLOYMENT.md`
- `CONTRIBUTING.md`
- `.ai_context.md`

The following directories must always exist:

- `rules/` — contains this file and other binding constraints
- `plans/` — execution and rollout plans
- `specs/` — feature specifications and acceptance criteria
- `tests/` — automated test suite (Vitest + React Testing Library)
- `functions/` — Cloud Functions v2 source
- `src/` — React application source (built by Vite)
- `scripts/ci/` — CI enforcement scripts
- `docs/` — extended documentation

The following tool config directories must contain only configuration — no instruction prose:

- `.claude/` — Claude Code permissions config only
- `.cursor/` — Cursor configuration and `.mdc` rule files only

**Intentionally absent directories (documented deviations from the standard):**

- `dist/` — Build output goes to `app/` (Firebase Hosting public directory). No separate dist/ directory.

## Forbidden Patterns

- **Never push directly to `main`.** All changes must go through a pull request—even single-line fixes, documentation updates, and deploy config changes. The only exception is if the human explicitly authorizes a direct push in chat as a break-glass override.
- **Never edit the `app/` output directory directly.** It is a build artifact produced by Vite from `src/`. Always edit source in `src/` and run `npm run build` to regenerate.
- **Never commit `.env.local`.** It contains the real Firebase web config as `VITE_FIREBASE_*` variables and is gitignored.
- **Never commit credentials.** API keys, service account JSON, ADC credentials, Firebase web config, and tokens must never appear in tracked files. The `npm test` script includes a secret scan that will fail on detected credentials.
- **Never delete tests to force a build to pass.** If a test is failing, fix the underlying issue. Test deletion is forbidden.
- **No instruction files in tool folders.** `.claude/` and `.cursor/` must not contain plain `.md` or `.txt` instruction files. Cursor `.mdc` rule files are permitted.
- **No duplicate documentation.** If a concept is documented in `AGENTS.md` or a canonical root file, it must not be redefined in a conflicting location.
- **No new top-level directories** without explicit justification documented in `AGENTS.md` or a `plans/` entry.
- **Do not introduce `__/firebase/init.js`.** Production config is owned by `.env.local`; Hosting auto-init can resurrect deleted keys.

## High-Risk Modification Zones

Changes to the following areas require explicit human review before any merge. AI agents must flag these changes and must not auto-apply them:

- **`src/lib/calculations.js` — Payment calculations:** `calculateAnnualSummary()`, `getPaymentTotalForMember()`, `calculateSettlementMetrics()`
- **`src/lib/BillingYearService.js` — Payment mutations:** `recordPayment()`, `reversePayment()`. The payments array is append-only. Never physically delete entries — always use reversals.
- **`firestore.rules`** — Data access security
- **`storage.rules`** — Storage access security
- **`functions/index.js`** — Cloud Functions auth and token validation
- **`functions/billing.js`** — Shared billing utilities used by Cloud Functions

## CI Enforcement

The following checks are implemented in `scripts/ci/` and must pass before any commit is merged:

1. `check_required_root_files` — Verifies README.md, AGENTS.md, DEPLOYMENT.md, CONTRIBUTING.md, and .ai_context.md all exist at repository root
2. `check_no_tool_folder_instructions` — Verifies .claude/ and .cursor/ contain no plain .md or .txt instruction files
3. `check_no_forbidden_top_level_dirs` — Verifies no forbidden top-level directories exist (e.g., tool-instructions/, ai-rules/, agent-config/)
4. `check_dist_not_modified` — Verifies app/ build output files were not directly modified (exits cleanly if app/ does not exist)
5. `check_spec_test_alignment` — Verifies every file in specs/ has a corresponding test file in tests/react/ (advisory; skips if specs/ is empty)
6. `check_duplicate_docs` — Verifies no documentation topic is duplicated between root files and tool folders
7. `check_review_policy_exists` — Verifies .github/review-policy.yml and REVIEW_POLICY.md both exist
8. `check_codex_scripts` — Verifies `scripts/codex-review-request.sh` and `scripts/codex-review-check.sh` exist and are executable. Required for Phase 4a automated external review.

Additionally, `npm test` includes a secret scan (`scripts/check-no-public-secrets.mjs`) that must pass on every commit.
