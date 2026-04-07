# Contributing

## Overview

Friends & Family Billing is a production application handling real financial data for real users. Contributions must be correct, safe, and tested. Payment calculations, ledger entries, and security rules are high-risk areas — changes in these areas require extra scrutiny and must pass all automated tests.

## Branch Naming

| Type | Format | Example |
|------|--------|---------|
| New feature | `feature/<short-description>` | `feature/pdf-invoice-export` |
| Bug fix | `fix/<short-description>` | `fix/distributed-payment-rounding` |
| Maintenance | `chore/<short-description>` | `chore/update-firebase-sdk` |

## Commit Message Format

Use imperative present tense. Keep the subject line under 72 characters.

```
Add billing frequency toggle to bill card
Fix payment reversal not emitting event
Update Firestore security rules for dispute evidence
```

For changes to financial logic, payment calculations, or security rules, add a body explaining the change in detail.

## Pull Request Process

1. Branch from `main`
2. Run `npm test` — all ~920 tests (632 React + 288 legacy) must pass before opening a PR
3. Run `npm run build` — Vite build must complete cleanly
4. Run all `scripts/ci/` checks locally before opening a PR
5. Open a PR against `main` with a clear title and description, or run `npm run pr:auto -- --title "Your title"` from your feature branch to create one with the repo template and enable GitHub auto-merge
6. Include a `## Self-Review` section in the PR body. The PR template and `npm run pr:auto` helper do this for you.
7. For changes to payment logic, billing calculations, or security rules: include a description of what was tested manually and why the change is correct
8. If GitHub applies the `needs-external-review` label, wait for a human reviewer to remove it before merge. Smaller changes without that label can auto-merge after the required checks pass.

## Code Style

- **React (src/app/):** Functional components with hooks. Views are lazy-loaded via `React.lazy()`.
- **Business logic (src/lib/):** Pure JavaScript modules with no React dependency. All billing mutations go through `BillingYearService`.
- **CSS:** Use `design-tokens.css` custom properties for all colors, spacing, and typography. Component styles live in `src/app/shell.css`. Do not add hard-coded values.
- Run `npm test` (which includes the secret scan) before committing. Failing the secret scan means API keys or tokens are present in tracked files.

## Testing

The test suite uses **Vitest** with **React Testing Library**. Run tests with:

```bash
npm test
```

This runs the React test suite (632 tests) and legacy test suite (288 tests) in `tests/` plus a tracked-file secret scan. Playwright E2E tests are available separately via `npm run test:e2e`.

**Tests must not be deleted to force a build to pass.** If a test is wrong, fix the test and the code together—never delete the test.

**When adding new behavior:**
- Add tests for any new calculation logic
- Add tests for any new payment operations
- Add tests for any security-relevant input validation
- Add component tests for new React views/components

**High-risk areas requiring tests before merge:**
- `calculateAnnualSummary` (src/lib/calculations.js) — bill splitting math
- `recordPayment` / `reversePayment` (src/lib/BillingYearService.js) — ledger operations
- `getPaymentTotalForMember` (src/lib/calculations.js) — balance derivation
- Any new Cloud Functions logic

## Agent Contributions

AI agent contributions must follow `AGENTS.md`. All agent-proposed changes require human review before merge. Agents must not:
- Autonomously merge PRs
- Run `npm run pr:auto` or enable auto-merge unless the repo owner explicitly asks for it
- Modify Firestore security rules without explicit instruction
- Change payment calculation logic without explicit instruction
- Commit `firebase-config.local.js` or any credentials

## Questions

Open an issue on GitHub or contact the repo owner directly.
