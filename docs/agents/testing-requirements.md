# Testing Requirements

The test suite uses **Vitest** with **React Testing Library**. Run with:

```bash
npm test
```

This runs the React test suite (`tests/react/`) plus a tracked-file secret scan (`scripts/check-no-public-secrets.mjs`). Failing the secret scan means API keys or tokens are present in tracked files—fix before committing.

## Coverage

Generate a coverage report with:

```bash
npm run test:coverage
```

Coverage output lands in `coverage/react/` (text summary printed to terminal, plus HTML and LCOV reports). Coverage is **report-only**—CI does not enforce thresholds yet. The `all: true` setting ensures zero-covered files appear in the report rather than being silently omitted.

## Test count

**~632 React tests** (37 test files) covering services, hooks, components, and views. **288 legacy tests** via Node's native test runner. **Playwright E2E tests** in `tests/e2e/`.

```bash
npm run test:e2e       # Playwright end-to-end tests (builds first, serves at :4174)
```

## Mocking policy

- **Firebase SDK modules** (`firebase/firestore`, `firebase/storage`, `firebase/auth`) are mocked at the module boundary via `vi.mock()` in test setup. This is the correct layer for unit tests.
- **App-level hooks** (`useBillingData`, `useDisputes`, etc.) should NOT be mocked in integration-style tests. Instead, render with the real hook backed by a mocked `BillingYearService` singleton. Use `tests/react/helpers/renderWithBillingData.js` — see its module docstring for the required `vi.mock()` calls that the consuming test file must include (Firebase SDK, `firebase/auth`, and `BillingYearService`).
- Hook-level mocking (`vi.mock('../../hooks/useBillingData')`) is acceptable for isolated component unit tests where the hook behavior is not under test.
- Components using `useToast()` require a `<ToastProvider>` wrapper in tests.
- Service tests use direct method calls on `BillingYearService` instances.

## Interaction testing

- Use `@testing-library/user-event` for interaction-heavy tests (clicks, typing, tab navigation).
- Reserve `fireEvent` only for low-level events like file inputs and Escape key handling.

## Assertion style

- Prefer accessible queries: `getByRole`, `getByLabelText`, `getByText` over CSS selectors.
- Avoid `document.querySelector` / `querySelectorAll` and `.className` assertions—these couple tests to implementation details.
- No snapshot expansion. New tests should be behavior-first and accessible-query-first.

**Tests must not be deleted to force a build to pass.**

**When adding new behavior, tests are required for:**
- Any new calculation logic (billing math, settlement metrics)
- Any new payment operations (new ledger entry types, new distribution logic)
- Any security-relevant input validation (phone format, image source, URL validation)
- New Cloud Functions logic (add to `_testHelpers` exports)
- New React components (Vitest + React Testing Library)

## Follow-up items

Tracked hardening work from the test-gap-mitigation PR:

1. **Centralize test mocks** — move distributed `vi.mock()` calls for Firebase SDK, `firebase/auth`, and `BillingYearService` into a shared `tests/react/testSetup.js` (or extend the existing `setup.js`) so consuming test files don't each duplicate the same mock boilerplate. This reduces mock drift when dependencies change.
2. **Fail-fast on missing mocks** — add runtime assertions in `renderWithBillingData` that detect when required modules aren't mocked, producing a clear error instead of misleading test failures.
3. **Coverage thresholds** — after baseline stabilizes, set CI-enforced coverage thresholds in `vite.config.js` to prevent regression. Capture baseline from the first clean CI run.
4. **ShareView race condition coverage** — the `updateDoc` call in the approval flow is not tested for concurrent/race scenarios. Add a test that verifies correct behavior when `updateDoc` rejects after the button click.
5. **Cloud Functions test suite** — add `functions/tests/` with `node:test` runner covering token validation, revoked/expired links, dispute rate limiting, evidence URL authorization, and CORS rejection (Wave 4 from the mitigation plan).
6. **Convert one existing view suite to shared harness** — migrate `DashboardView.test.jsx` from hook-level mocking to the `renderWithBillingData` integration pattern as proof of concept.
