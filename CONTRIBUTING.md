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
2. Run `npm test` — all 267+ tests must pass before opening a PR
3. Run `npm run build` — bundle must build cleanly
4. Run all `scripts/ci/` checks locally before opening a PR
5. Open a PR against `main` with a clear title and description, or run `npm run pr:auto -- --title "Your title"` from your feature branch to create one with the repo template and enable GitHub auto-merge
6. Include a `## Self-Review` section in the PR body. The PR template and `npm run pr:auto` helper do this for you.
7. For changes to payment logic, billing calculations, or security rules: include a description of what was tested manually and why the change is correct
8. If GitHub applies the `needs-external-review` label, wait for a human reviewer to remove it before merge. Smaller changes without that label can auto-merge after the required checks pass.

## Code Style

- **JavaScript (src/):** ES modules, no globals. All functions called from inline HTML handlers must be assigned to `window.*` in `src/index.js`.
- **CSS:** Use `design-tokens.css` custom properties for all colors, spacing, and typography. Do not add hard-coded values.
- **HTML:** Keep pages in sync with the Firebase SDK loading order documented in `AGENTS.md`.
- No framework — vanilla DOM APIs only.
- Run `npm test` (which includes the secret scan) before committing. Failing the secret scan means API keys or tokens are present in tracked files.

## Testing

The test suite uses Node's built-in test runner. Run tests with:

```bash
npm test
```

This runs `npm run build` first, then executes `tests/billing.test.js`. 267 tests across 77 suites cover all critical financial logic.

**Tests must not be deleted to force a build to pass.** If a test is wrong, fix the test and the code together — never delete the test.

**When adding new behavior:**
- Add tests for any new calculation logic
- Add tests for any new payment operations
- Add tests for any security-relevant input validation

**High-risk areas requiring tests before merge:**
- `calculateAnnualSummary` — bill splitting math
- `recordPayment` / `deletePaymentEntry` — ledger operations
- `getPaymentTotalForMember` — balance derivation
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
