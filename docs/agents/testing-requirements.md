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

**~490 React tests** covering services, hooks, components, and views.

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
