---
spec_id: authentication
---

# Authentication

Covers the Firebase authentication context provider and route guards for authenticated/unauthenticated access.

## Test Coverage

- `tests/react/contexts/AuthContext.test.jsx`
- `tests/react/routes.test.jsx`

## Acceptance Criteria

### AuthProvider Context

- Renders without error and exposes loading state via `useAuth`.
- Provides the user object (with email) after Firebase `onAuthStateChanged` resolves with a user.
- Provides `null` user when `onAuthStateChanged` resolves with null (signed out).

### Route Guards -- Unauthenticated

- Navigating to `/` when not signed in redirects to `/login` and shows "Sign in to continue".
- Navigating to `/login` when not signed in shows the login page.

### Route Guards -- Authenticated

- Navigating to `/login` when signed in redirects to `/dashboard` (GuestRoute), hiding the login page.
- `/dashboard` shows the Dashboard view with the nav bar displaying the user's email and a "Sign Out" button.
- `/` redirects to `/dashboard` and renders the nav bar with Dashboard, Manage, and Settings links.
- Unknown routes (e.g., `/unknown`) redirect to `/dashboard`.
- `/manage/members` renders the manage view with Members, Bills, Invoicing, and Review Requests tabs.
- `/settings` renders the Settings view.
