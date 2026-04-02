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
- **Dependencies:** Firebase SDK v12, React 19, React Router v7, Vite 8, Resend SDK

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
│       ├── sms.js                 # SMS deep link generation
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
| `/app/` | Yes | Dashboard — KPIs, settlement board, lifecycle bar |
| `/app/manage` | Yes | Members, Bills, Invoicing, Reviews tabs |
| `/app/settings` | Yes | Year management + payment methods |
| `/app/share` | No | Public billing summary via `publicShares` collection |
| `/app/login` | No | Email/Password and Google Sign-In |

