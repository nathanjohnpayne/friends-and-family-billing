# Testing Requirements

The test suite uses **Vitest** with **React Testing Library**. Run with:

```bash
npm test
```

This runs the React test suite (`tests/react/`) plus a tracked-file secret scan (`scripts/check-no-public-secrets.mjs`). Failing the secret scan means API keys or tokens are present in tracked files—fix before committing.

**~400 React tests** covering services, hooks, components, and views.

**Test patterns:**
- Firebase is mocked via `vi.mock()` in test setup
- `useBillingData` is mocked for component tests
- Components using `useToast()` require a `<ToastProvider>` wrapper in tests
- Service tests use direct method calls on `BillingYearService` instances

**Tests must not be deleted to force a build to pass.**

**When adding new behavior, tests are required for:**
- Any new calculation logic (billing math, settlement metrics)
- Any new payment operations (new ledger entry types, new distribution logic)
- Any security-relevant input validation (phone format, image source, URL validation)
- New Cloud Functions logic (add to `_testHelpers` exports)
- New React components (Vitest + React Testing Library)

