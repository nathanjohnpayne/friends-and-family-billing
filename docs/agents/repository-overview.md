# Repository Overview

### Project Overview
Family Bill Splitter is a cloud-based web application for coordinating and settling annual shared bills among friends and family. It features multi-user authentication, flexible bill splitting, parent-child account linking, a billing year lifecycle (open/settling/closed/archived), payment tracking with settlement progress, share links for member billing summaries, dispute resolution, calculation transparency, and email invoicing.

**Live URL:** https://friends-and-family-billing.web.app
**Firebase Project ID:** `friends-and-family-billing`

### Tech Stack
- **Frontend:** React 19 SPA (Vite build, code-split via `React.lazy`)
- **State Management:** Service-owns-state pattern — `BillingYearService` owns canonical state, React subscribes via `useSyncExternalStore`
- **Styling:** CSS3 with design tokens (`design-tokens.css` → `shell.css`)
- **Backend/Infrastructure:** Firebase
  - Firebase Authentication (Email/Password + Google Sign-In)
  - Cloud Firestore (NoSQL database)
  - Cloud Functions v2 (email delivery via Resend, dispute submission, evidence URLs, dispute decisions)
  - Firebase Hosting with CDN
  - Firebase Analytics
  - Firebase Storage (dispute evidence uploads)
- **Image Processing:** Canvas API for client-side compression (max 200x200px PNG)
- **Build:** Vite (React app → `app/` directory, code-split chunks)
- **Testing:** Vitest + React Testing Library
- **Email Delivery:** [Resend](https://resend.com) via Cloud Function — HTML emails from `billing@mail.nathanpayne.com` (SPF/DKIM verified)
- **Rich-Text Editing:** [TipTap](https://tiptap.dev) WYSIWYG editor for invoice templates — custom inline token nodes, block token nodes, slash-command menu (TemplateEditor.jsx, SubjectEditor.jsx)
- **Dependencies:** Firebase SDK v12, React 19, React Router v7, Vite 8, TipTap, Resend SDK

### Project Structure
```
.
├── src/
│   ├── app/                       # React application
│   │   ├── main.jsx               # React entry point (createRoot)
│   │   ├── App.jsx                # Root component — routing, auth, lazy-loaded views
│   │   ├── index.html             # SPA HTML shell (Vite entry)
│   │   ├── shell.css              # All React component styles (consumes design-tokens.css)
│   │   ├── components/            # Shared React components
│   │   │   ├── ActionMenu.jsx     # Three-dot dropdown menu
│   │   │   ├── AppShell.jsx       # Authenticated layout shell (NavBar + content)
│   │   │   ├── BillAuditHistoryDialog.jsx  # Per-bill event timeline dialog
│   │   │   ├── BillingYearSelector.jsx     # Year dropdown with lifecycle controls
│   │   │   ├── ConfirmDialog.jsx  # Modal confirmation dialog
│   │   │   ├── DisputeDetailDialog.jsx     # Dispute detail with evidence, resolution
│   │   │   ├── EmailInvoiceDialog.jsx      # Email invoice composer with variants
│   │   │   ├── EmptyState.jsx     # Empty list placeholder
│   │   │   ├── NavBar.jsx         # Top navigation bar
│   │   │   ├── PaymentHistoryDialog.jsx    # Payment timeline with reversal support
│   │   │   ├── PaymentMethodsManager.jsx   # Payment methods CRUD (on Settings page)
│   │   │   ├── SettlementBoard.jsx         # Household settlement cards with filters
│   │   │   ├── ShareLinkDialog.jsx         # Share link generation and management
│   │   │   ├── StatusBadge.jsx    # Payment status pill (Outstanding/Partial/Settled)
│   │   │   ├── TemplateEditor.jsx          # TipTap WYSIWYG editor with token pills, toolbar, slash-commands
│   │   │   ├── SubjectEditor.jsx           # TipTap single-line editor for email subjects
│   │   │   ├── SlashCommandMenu.jsx        # Slash-command autocomplete for TipTap
│   │   │   ├── TokenNode.js                # Custom TipTap node for inline %token% pills
│   │   │   ├── BlockTokenNode.js           # Custom TipTap node for block /slash_command tokens
│   │   │   ├── BlockTokenNodeView.jsx      # React component for rendering block token nodes
│   │   │   ├── CompanyLogo.jsx             # Company logo SVG renderer
│   │   │   ├── UpdateToast.jsx             # Service worker update notification
│   │   │   └── TextInvoiceDialog.jsx       # SMS invoice composer with deep links
│   │   ├── contexts/
│   │   │   ├── AuthContext.jsx    # Firebase auth state provider
│   │   │   └── ToastContext.jsx   # Toast notification provider
│   │   ├── hooks/
│   │   │   ├── useBillingData.js  # BillingYearService subscription hook
│   │   │   └── useDisputes.js     # Firestore disputes collection hook
│   │   └── views/
│   │       ├── Dashboard/
│   │       │   └── DashboardView.jsx  # KPIs, settlement board, lifecycle bar
│   │       ├── Manage/
│   │       │   ├── ManageView.jsx     # Tab container (Members/Bills/Invoicing/Reviews)
│   │       │   ├── MembersTab.jsx     # Full CRUD for family members
│   │       │   ├── BillsTab.jsx       # Full CRUD for bills
│   │       │   ├── InvoicingTab.jsx   # Invoice email template editor
│   │       │   └── ReviewsTab.jsx     # Dispute management
│   │       ├── Settings/
│   │       │   └── SettingsView.jsx   # Year management + payment methods
│   │       ├── LoginView.jsx          # Email/Password + Google Sign-In
│   │       └── ShareView.jsx          # Public share page (React route, no auth)
│   └── lib/                       # Pure business logic (no React dependency)
│       ├── BillingYearService.js  # Service-owns-state: all billing mutations
│       ├── SaveQueue.js           # Serialized Firestore write queue
│       ├── billing-year.js        # Year lifecycle utilities
│       ├── calculations.js        # Bill splitting math, settlement metrics
│       ├── constants.js           # Shared constants
│       ├── firebase.js            # Modular Firebase init (reads .env.local)
│       ├── formatting.js          # Number/date/currency formatting
│       ├── invoice.js             # Invoice text/HTML generation
│       ├── persistence.js         # Firestore read/write operations
│       ├── share.js               # Share token, public share data
│       ├── ShareLinkService.js    # Share link CRUD, token lifecycle, public share sync
│       ├── sms.js                 # SMS deep link generation
│       ├── mail.js                # Email queueing via Firestore mailQueue
│       ├── template-doc.js        # TipTap document ↔ token processing
│       └── validation.js          # Input validation (E.164, URLs, amounts)
├── app/                           # BUILD OUTPUT (gitignored) — Vite builds here
├── functions/
│   ├── index.js                   # Cloud Functions v2 entry point (sendEmail, resolveShareToken, submitDispute, etc.)
│   ├── billing.js                 # Shared billing utilities for Cloud Functions
│   └── package.json               # Cloud Functions dependencies (firebase-admin, firebase-functions, resend)
├── tests/react/                   # Vitest + React Testing Library test suite
│   ├── app.test.jsx               # App routing tests
│   ├── routes.test.jsx            # Route configuration tests
│   ├── components/                # Shared component tests
│   ├── contexts/                  # Context provider tests
│   ├── hooks/                     # Hook tests
│   ├── lib/                       # Service and business logic tests
│   └── views/                     # View-level integration tests
├── tests/e2e/                     # Playwright end-to-end tests
├── playwright.config.js           # Playwright configuration
├── specs/                         # Feature specifications and acceptance criteria
├── scripts/
│   ├── check-no-public-secrets.mjs  # Secret scanning (runs as part of npm test)
│   └── ci/                        # CI enforcement scripts
├── rules/                         # Repository-level binding constraints
├── plans/                         # Feature rollout and migration plans
├── docs/                          # Extended documentation
├── design-tokens.css              # Design system tokens (colors, spacing, typography)
├── firebase.json                  # Firebase hosting, functions, and deployment config
├── vite.config.js                 # Vite build configuration
├── version.json                   # App version for update checking (stamped on deploy)
├── stamp-version.js               # Predeploy script
├── firestore.rules                # Firestore security rules
├── storage.rules                  # Firebase Storage security rules
├── package.json                   # Build/test scripts and root dependencies
├── AGENTS.md                      # Agent instructions index (points to docs/agents/)
├── README.md                      # User-facing project documentation
├── DEPLOYMENT.md                  # Step-by-step Firebase deployment guide
├── CONTRIBUTING.md                # Contribution guidelines
└── .ai_context.md                 # Supplemental AI agent context
```

### Application Routes

| Route | Auth Required | Purpose |
|-------|:------------:|---------|
| `/dashboard` | Yes | Dashboard — KPIs, settlement board, lifecycle bar |
| `/manage` | Yes | Members, Bills, Invoicing, Reviews tabs |
| `/settings` | Yes | Year management + payment methods |
| `/share` | No | Public billing summary via `publicShares` collection |
| `/login` | No | Email/Password and Google Sign-In |

### Architecture

#### Authentication Flow
1. User visits any protected route → `AuthContext` checks `onAuthStateChanged()`
2. If unauthenticated → React Router redirects to `/login`
3. User logs in via Email/Password or Google Sign-In
4. On success → redirect to `/dashboard`, `useBillingData` hook initializes `BillingYearService`
5. All data operations scoped to `/users/{userId}/billingYears/{yearId}`

#### Data Architecture
**Firestore document structure:**
```
/users/{userId}
  ├── activeBillingYear: string (e.g. "2026")
  ├── migrationVersion: number
  └── updatedAt: Timestamp

/users/{userId}/billingYears/{yearId}
  ├── label: string (e.g. "2026")
  ├── status: "open"|"settling"|"closed"|"archived"
  ├── createdAt: Timestamp
  ├── closedAt: Timestamp|null
  ├── archivedAt: Timestamp|null
  ├── familyMembers: Array<{
  │     id: number,
  │     name: string,
  │     email: string,
  │     phone: string (E.164 format, e.g. "+14155551212"),
  │     avatar: string (base64 data URL),
  │     paymentReceived: number (legacy, migrated to ledger),
  │     linkedMembers: number[] (child member IDs)
  │   }>
  ├── bills: Array<{
  │     id: number,
  │     name: string,
  │     amount: number (canonical amount as entered),
  │     billingFrequency: "monthly"|"annual" (defaults to "monthly"),
  │     logo: string (base64 data URL),
  │     website: string,
  │     members: number[] (member IDs assigned to this bill)
  │   }>
  ├── payments: Array<{
  │     id: string (e.g. "pay_1708000000000_12345"),
  │     memberId: number,
  │     amount: number (negative for reversals),
  │     receivedAt: string (ISO 8601),
  │     note: string,
  │     method: string ("venmo"|"zelle"|"cashapp"|"paypal"|"apple_cash"|"check"|"other"),
  │     reversed: boolean|undefined (true when reversed by a later entry),
  │     type: string|undefined ("reversal" for reversal entries),
  │     reversesPaymentId: string|undefined (original payment ID for reversals)
  │   }>
  ├── billingEvents: Array<{
  │     id: string (e.g. "evt_1708000000000_12345"),
  │     timestamp: string (ISO 8601),
  │     actor: { type: "admin"|"system"|"member", userId?: string },
  │     eventType: string (BILL_CREATED|BILL_UPDATED|BILL_DELETED|MEMBER_ADDED_TO_BILL|MEMBER_REMOVED_FROM_BILL|PAYMENT_RECORDED|PAYMENT_REVERSED|YEAR_STATUS_CHANGED),
  │     payload: Record<string, any>,
  │     note: string,
  │     source: "ui"|"import"|"migration"|"system"
  │   }>
  ├── settings: {
  │     emailMessage: string,
  │     paymentLinks: Array<{ id, name, url }> (legacy, migrated to paymentMethods on load),
  │     paymentMethods: Array<{
  │       id: string,
  │       type: string ("venmo"|"zelle"|"cashapp"|"paypal"|"apple_cash"|"check"|"other"),
  │       label: string,
  │       enabled: boolean,
  │       handle: string,
  │       url: string,
  │       phone: string,
  │       email: string,
  │       instructions: string,
  │       name: string (check type only),
  │       address: string (check type only),
  │       qrCode: string (base64 data URL, optional),
  │       hasQrCode: boolean (optional)
  │     }>
  │   }
  └── updatedAt: Timestamp

/users/{userId}/billingYears/{yearId}/disputes/{disputeId}
  ├── memberId: number
  ├── memberName: string
  ├── billId: number
  ├── billName: string
  ├── message: string (max 2000 chars)
  ├── proposedCorrection: string|null (max 500 chars)
  ├── status: "open"|"in_review"|"resolved"|"rejected"
  ├── resolutionNote: string|null
  ├── resolvedAt: Timestamp|null
  ├── rejectedAt: Timestamp|null
  ├── evidence: Array<{
  │     name: string,
  │     storagePath: string,
  │     contentType: string,
  │     size: number,
  │     uploadedAt: string (ISO 8601)
  │   }>
  ├── userReview: {
  │     state: "requested"|"approved_by_user"|"rejected_by_user",
  │     rejectionNote: string|null,
  │     decidedAt: Timestamp|null
  │   }|null
  ├── createdAt: Timestamp
  └── tokenHash: string (SHA-256 of share token)

/users/{userId}/auditLog/{logId}
  ├── action: string (e.g. "share_token_resolved", "dispute_submitted")
  ├── timestamp: Timestamp (server-generated)
  └── ... (action-specific fields)

/shareTokens/{tokenHash}  (top-level collection)
  ├── ownerId: string (Firebase UID)
  ├── memberId: number
  ├── memberName: string
  ├── billingYearId: string
  ├── scopes: string[]
  ├── revoked: boolean
  ├── expiresAt: string (ISO 8601)|null
  ├── createdAt: string (ISO 8601)
  ├── lastAccessedAt: string (ISO 8601)|null
  └── accessCount: number

/publicShares/{tokenHash}  (top-level collection, publicly readable)
  ├── ownerId: string (Firebase UID)
  ├── memberId: number
  ├── billingYearId: string
  ├── scopes: string[]
  ├── member: { id, name, email, phone }
  ├── bills: Array<{ billId, billName, monthlyShare, annualShare }>
  ├── total: number
  ├── monthlyTotal: number
  ├── linkedMembers: Array<{ id, name, bills, total, monthlyTotal }>
  ├── paymentMethods: Array<{ type, label, ... }>
  ├── payments: Array<{ amount, receivedAt, note, method }>
  ├── paymentTotal: number
  ├── yearLabel: string
  └── updatedAt: string (ISO 8601)
```

**Storage path:** `users/{userId}/disputes/{disputeId}/{timestamp}_{filename}`

**Security rules:**
```javascript
// Owner-only access for user data
match /users/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
  match /billingYears/{yearId} { /* owner only */ }
  match /billingYears/{yearId}/disputes/{disputeId} { /* owner only */ }
  match /auditLog/{logId} { allow read: if owner; allow write: if false; }
}

// Share tokens — owner CRUD, Cloud Functions use Admin SDK for resolution
match /shareTokens/{tokenId} {
  allow read, update, delete: if auth && resource.data.ownerId == auth.uid;
  allow create: if auth && request.resource.data.ownerId == auth.uid;
}

// Public shares — anyone can read (security via SHA-256 token hash), owner-only write
match /publicShares/{tokenHash} {
  allow read: if true;
  allow create, update, delete: if auth && resource.data.ownerId == auth.uid;
}
```

#### Firebase Configuration
Firebase is initialized via the modular SDK in `src/lib/firebase.js`, which reads config from `.env.local` (gitignored) as `VITE_FIREBASE_*` environment variables. Create `.env.local` from the template before building or running the dev server.

Do not reintroduce `__/firebase/init.js` or CDN compat scripts.

### Build System
The application uses a two-step build pipeline. The React SPA is the sole client at `/`.

```bash
npm run build          # Two-step: build:react → build:assemble
npm run dev            # Vite dev server with HMR
```

**How it works:**
1. `build:react` — Vite builds the root `index.html` React entry → `app/` (code-split chunks; ~238 KB index + ~400 KB jsx-runtime + ~401 KB InvoicingTab/TipTap lazy chunk)
2. `build:assemble` — generates the runtime `firebase-config.local.js` bridge and copies shared assets (design tokens, logos, favicon, OG image, QR code) into `app/` (Vite already emits the root `index.html` to `app/index.html`)
- `index.html` (project root) is the HTML entry; `src/app/main.jsx` is the JS entry point (React `createRoot`)
- `src/app/App.jsx` is the root component with React Router and lazy-loaded views
- `src/lib/` contains pure business logic (no React dependency) shared across components
- The `app/` output directory is **gitignored**; source of truth is `src/`
- Firebase Hosting serves `app/` at `/` with SPA fallback rewrites (`"public": "app"` in `firebase.json`)

**State management:** `BillingYearService` (in `src/lib/`) owns all mutable billing state. React components subscribe via `useSyncExternalStore` through the `useBillingData` hook. Mutations go through service methods → `_setState()` → subscriber notification → React re-render. Firestore writes are serialized through `SaveQueue`.

### Key Modules

#### BillingYearService (src/lib/BillingYearService.js)
Central service owning all billing state. React subscribes via `useSyncExternalStore`.

**CRUD Methods** (all guarded by `_guardReadOnly()`, all emit billing events):
- `addMember(name, email, phone)` — Creates member with unique ID. E.164 phone validation.
- `updateMember(memberId, fields)` — Inline field updates. Enforces one-parent household invariant for `linkedMembers`.
- `removeMember(memberId)` — Deletes member, cleans up bill references.
- `addBill(name, amount, frequency, website)` — Creates bill. Validates http(s) website URLs.
- `updateBill(billId, fields)` — Updates bill fields. Validates amount (positive) and website.
- `removeBill(billId)` — Deletes bill with event snapshot.
- `toggleBillMember(billId, memberId)` — Toggles member participation in a bill.
- `recordPayment(memberId, amount, method, note, distribute)` — Creates ledger entry. Supports proportional distribution across linked household members.
- `reversePayment(paymentId, memberId)` — Creates reversal entry (negative amount), marks original as `reversed: true`.
- `updateSettings(fields)` — Updates email message and payment methods.

**Household Invariants** (enforced in `updateMember()`):
- No self-linking
- Children cannot be parents
- A child can only have one parent
- Parents cannot be children of other members

#### ShareLinkService (src/lib/ShareLinkService.js)
Manages the full share link lifecycle: create, revoke, update scopes, refresh public share data. Coordinates between `shareTokens` and `publicShares` Firestore collections.

#### Business Logic (src/lib/)
- `calculations.js` — `calculateAnnualSummary()`, `calculateSettlementMetrics()`, `getPaymentTotalForMember()`, `getBillAnnualAmount()`, `getBillMonthlyAmount()`
- `validation.js` — `isValidE164()`, `isYearReadOnly()`, `yearReadOnlyMessage()`
- `share.js` — `generateRawToken()`, `hashToken()`, `buildPublicShareData()`, `refreshPublicShares()`
- `invoice.js` — `buildInvoiceSubject()`, `buildInvoiceBody()`, `buildFullInvoiceText()`, `getInvoiceSummaryContext()`, `renderInvoiceTemplate()`, `buildInvoiceTemplateEmailPayload()`; `renderInvoiceTemplate()` is the canonical HTML path for Invoicing preview and template-generated email output
- `sms.js` — `buildSmsDeepLink()`, `openSmsComposer()`
- `formatting.js` — Currency, date, and number formatting utilities
- `billing-year.js` — Year lifecycle utilities, status constants
- `persistence.js` — Firestore read/write operations

#### React Hooks (src/app/hooks/)
- `useBillingData()` — Subscribes to `BillingYearService` state via `useSyncExternalStore`. Returns `{ activeYear, familyMembers, bills, payments, settings, service, loading, error }`.
- `useDisputes(userId, yearId)` — Real-time Firestore subscription to disputes subcollection. Returns `{ disputes, loading, updateDispute, removeEvidence, uploadEvidence }`.

### Cloud Functions (functions/index.js)
All functions use the **v2 API** (`firebase-functions/v2/https` with `onRequest`). They are deployed to `us-central1`.

> **Note:** The GCP organization policy blocks granting `allUsers` the Cloud Run invoker role, so these functions cannot be made publicly accessible. The React share page (`ShareView.jsx`) reads data directly from the `publicShares` Firestore collection, with a fallback to the `resolveShareToken` Cloud Function. Dispute-related functions are called via Firebase Hosting rewrites or direct URLs.

- `resolveShareToken` — POST endpoint: validates share token, returns billing summary, linked members, payment data, disputes (if `disputes:read` scope), and payment methods. Writes audit log entry on access.
- `submitDispute` — POST endpoint: creates a dispute from a share link (requires `disputes:create` scope), rate-limited to 10 per 24 hours per token. Writes audit log entry.
- `getEvidenceUrl` — POST endpoint: returns a 1-hour signed URL for a dispute evidence file (requires `disputes:read` scope, validates member ownership)
- `submitDisputeDecision` — POST endpoint: records user approve/reject decision on a dispute (requires `disputes:read` scope, idempotent). Writes audit log entry.
- `appendAuditLog(ownerId, entry)` — Internal helper that writes audit entries to `/users/{userId}/auditLog`
- `_testHelpers` — Test-only export exposing `validateToken`, `validateDisputeInput`, `DISPUTE_RATE_LIMIT`, `EVIDENCE_URL_EXPIRY_MS`

#### Share Token Scopes

| Scope | Purpose |
|-------|---------|
| `summary:read` | View billing summary and bill breakdown |
| `paymentMethods:read` | View payment methods (Venmo, Zelle, etc.) |
| `disputes:create` | Submit new review requests |
| `disputes:read` | View disputes, evidence, and approve/reject resolutions |

### Payment Ledger
Payments are stored as an append-only ledger per billing year. Each entry records `{id, memberId, amount, receivedAt, note, method}`. The per-member "paid to date" total is derived by summing all ledger entries for that member (including negative reversal amounts). Legacy `paymentReceived` counters are automatically migrated into a single "migration payment" entry on first load.

#### Distributed Payments
When recording a payment for a parent with linked child members (with the "distribute" option):
1. Calculate total owed by parent + all linked children
2. Create individual ledger entries proportional to each person's annual total
3. Last child receives the rounding remainder to ensure the sum equals the entered amount

Example: Parent owes $1,000, Child owes $500 (total: $1,500). Payment of $900:
- Parent entry: $900 × ($1,000 / $1,500) = $600
- Child entry: $900 × ($500 / $1,500) = $300

### Billing Year Lifecycle
Each billing year progresses through four states:

| State | Order | Behavior | Badge Color |
|-------|:-----:|----------|-------------|
| `open` | 1 | Bills/members editable, payments allowed | Primary (blue) |
| `settling` | 2 | Invoices issued, payments being collected, admin reminders shown | Warning (amber) |
| `closed` | 3 | All balances settled, payments disabled, completion banner shown | Success (green) |
| `archived` | 4 | Fully read-only, historical reference only | Muted (gray) |

State transitions are managed via `setBillingYearStatus()`. The dashboard displays a lifecycle progress bar showing the current stage.

### UI/CSS Design System
Design tokens are defined in `design-tokens.css` and consumed by `src/app/shell.css` (React components).

- **Primary color:** `#667eea` / `var(--color-primary)`
- **Background:** Gradient from `var(--color-gradient-start)` to `var(--color-gradient-end)`
- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Spacing:** 8-point scale (`--space-1` through `--space-6`)
- **Layout:** Flexbox-based, responsive (breakpoint: 768px)
- **Core components:** `.card`, `.btn` (primary/secondary/success/danger), `.member-card`, `.bill-card`
- **Settlement components:** `.settlement-board`, `.settlement-card`, `.settlement-filter-chip`, `.balance-indicator`
- **Dialog components:** `.dialog-overlay`, `.dialog-content`, `.confirm-dialog`
- **Shared components:** `.action-menu`, `.status-badge`, `.empty-state`, `.toast`
- **Lifecycle components:** `.lifecycle-bar`, `.lifecycle-step`
- **Avatar size:** 48x48px circle (32x32px in invoices)

### Local Development
```bash
git clone <repository-url>
cd friends-and-family-billing
npm install

# Create .env.local with Firebase config (gitignored)
# VITE_FIREBASE_API_KEY=...
# VITE_FIREBASE_AUTH_DOMAIN=...
# VITE_FIREBASE_PROJECT_ID=...
# (etc.)

# Dev server with HMR
npm run dev

# Production build
npm run build
```

### Analytics Events
Currently implemented Firebase Analytics events:
- `login` / `sign_up` — Authentication events (in `LoginView.jsx`)

> **Not yet implemented:** `family_member_added`, `bill_added`, `share_link_generated`, `invoice_sent` are defined in the spec but not instrumented in the React codebase. Add them when the relevant views are next touched.

### Known Limitations
- Email invoices use `mailto:` links (requires a desktop email client)
- Images stored as base64 strings in Firestore (subject to document size limits)
- No PDF generation (invoices are printable HTML)
- Single Firestore document per billing year (may hit 1MB limit with many large images)
- GCP organization policy blocks making Cloud Functions publicly accessible; share page reads from `publicShares` Firestore collection instead
- Existing share links generated before the `publicShares` migration must be regenerated

### Troubleshooting
- **Data not loading:** Hard refresh (Cmd+Shift+R / Ctrl+Shift+R), check console, verify `.env.local` has correct Firebase config
- **Auth issues:** Verify providers are enabled in Firebase Console, check authorized domains
- **Payment errors:** Data repair runs automatically on load; re-enter payment amounts if needed
- **Billing year issues:** Check browser console for service errors; use year selector to switch years
- **Share links not loading:** Regenerate the share link --- older links created before the `publicShares` migration won't have data in Firestore
- **Cloud Functions 403:** Expected due to GCP org policy; share page reads from Firestore directly, not Cloud Functions

