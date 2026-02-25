# Family Bill Splitter - AI Agent Instructions

## Project Overview

Family Bill Splitter is a cloud-based web application for coordinating and settling annual shared bills among friends and family. It features multi-user authentication, flexible bill splitting, parent-child account linking, a billing year lifecycle (open/settling/closed/archived), payment tracking with settlement progress, share links for member billing summaries, dispute resolution, calculation transparency, and email invoicing.

**Live URL:** https://friends-and-family-billing.web.app
**Firebase Project ID:** `friends-and-family-billing`

## Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (no build tools or frameworks)
- **Backend/Infrastructure:** Firebase
  - Firebase Authentication (Email/Password + Google Sign-In)
  - Cloud Firestore (NoSQL database)
  - Cloud Functions (share token resolution, dispute submission, evidence URLs)
  - Firebase Hosting with CDN
  - Firebase Analytics
  - Firebase Storage (dispute evidence uploads)
- **Image Processing:** Canvas API for client-side compression (max 200x200px PNG)
- **Dependencies:** Firebase SDK v10.7.1 loaded via CDN (compat libraries)

## Project Structure

```
.
├── index.html                 # Main application page (authenticated users only)
├── login.html                 # Login/signup page with Google Sign-In
├── share.html                 # Public share-link page (token-based, no auth)
├── check_data.html            # Firebase data verification/debugging tool
├── script.js                  # Main application logic (~3,590 lines)
├── auth.js                    # Authentication handling (~160 lines)
├── firebase-config.js         # Firebase initialization and SDK exports
├── design-tokens.css          # Design system tokens (colors, spacing, typography)
├── styles.css                 # Application styles (~1,960 lines, consumes design-tokens.css)
├── version.json               # App version for update checking
├── firestore.rules            # Firestore security rules
├── storage.rules              # Firebase Storage security rules
├── firebase.json              # Firebase hosting and deployment configuration
├── package.json               # Test script (npm test)
├── functions/
│   ├── index.js               # Cloud Functions entry point
│   ├── billing.js             # Shared billing utilities for Cloud Functions
│   └── package.json           # Cloud Functions dependencies
├── tests/
│   └── billing.test.js        # Automated tests (~2,090 lines, Node built-in test runner)
├── .gitignore                 # Git ignore rules
├── .gitattributes             # Git line-ending normalization
├── AGENTS.md                  # AI agent instructions (this file)
├── README.md                  # User-facing project documentation
├── DEPLOYMENT.md              # Step-by-step Firebase deployment guide
├── QUICKSTART.md              # 10-minute setup guide
└── FIREBASE_IMPLEMENTATION.md # Firebase migration reference
```

## Architecture

### Authentication Flow

1. User visits `index.html` -> `auth.onAuthStateChanged()` checks login state
2. If unauthenticated -> redirect to `login.html`
3. User logs in via Email/Password or Google Sign-In
4. On success -> redirect to `index.html`, load user data from Firestore
5. All data operations scoped to `/users/{userId}/billingYears/{yearId}`

### Data Architecture

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
  │     amount: number,
  │     logo: string (base64 data URL),
  │     website: string,
  │     members: number[] (member IDs assigned to this bill)
  │   }>
  ├── payments: Array<{
  │     id: string (e.g. "pay_1708000000000_12345"),
  │     memberId: number,
  │     amount: number,
  │     receivedAt: string (ISO 8601),
  │     note: string,
  │     method: string ("cash"|"check"|"venmo"|"zelle"|"paypal"|"bank_transfer"|"other")
  │   }>
  ├── settings: {
  │     emailMessage: string,
  │     paymentLinks: Array<{ id, name, url }> (legacy, migrated to paymentMethods on load),
  │     paymentMethods: Array<{
  │       id: string,
  │       type: string ("zelle"|"apple_cash"|"venmo"|"cashapp"|"paypal"|"other"),
  │       label: string,
  │       enabled: boolean,
  │       handle: string,
  │       url: string,
  │       phone: string,
  │       email: string,
  │       instructions: string
  │     }>
  │   }
  ├── shareTokens: Array<{
  │     tokenHash: string (SHA-256),
  │     memberId: number,
  │     createdAt: string (ISO 8601),
  │     scopes: string[]
  │   }>
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
```

**Storage path:** `users/{userId}/disputes/{disputeId}/{timestamp}_{filename}`

**Security rules** enforce that users can only read/write their own document:

```javascript
match /users/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

### Application Pages

| Page | Auth Required | Purpose |
|------|:------------:|---------|
| `index.html` | Yes | Main app with all bill-splitting functionality |
| `login.html` | No | Email/Password and Google Sign-In authentication |
| `share.html` | No | Token-based annual billing summary for individual members |
| `check_data.html` | Yes | Debug tool to inspect raw Firestore data |

### Firebase SDK Loading Order

Scripts must load in this exact order (all pages):

1. `firebase-app-compat.js` - Core Firebase
2. `firebase-auth-compat.js` - Authentication
3. `firebase-firestore-compat.js` - Firestore (index.html, check_data.html only)
4. `firebase-storage-compat.js` - Storage (index.html only)
5. `firebase-analytics-compat.js` - Analytics (index.html, login.html only)
6. `firebase-config.js` - Initializes Firebase, exports `auth`, `db`, `storage`, `analytics`
7. `script.js` or `auth.js` - Application logic

## Key Functions (script.js)

### Data Persistence
- `loadData()` - Fetches user data from Firestore billing year document, initializes defaults for missing fields
- `saveData()` - Persists `familyMembers`, `bills`, `payments`, `settings` to the active billing year document with timestamp. Blocked when year is read-only (closed/archived).

### Billing Year Lifecycle
- `BILLING_YEAR_STATUSES` - Constant defining the four lifecycle states with labels, colors, and sort order
- `isArchivedYear()` - Returns true when current billing year status is `archived`
- `isClosedYear()` - Returns true when current billing year status is `closed`
- `isSettlingYear()` - Returns true when current billing year status is `settling`
- `isYearReadOnly()` - Returns true when year is `closed` or `archived` (mutations blocked)
- `yearReadOnlyMessage()` - Returns user-facing message explaining why edits are blocked
- `getBillingYearStatusLabel(status)` - Returns display label for a lifecycle status
- `setBillingYearStatus(newStatus)` - Writes new status to the billing year document
- `renderBillingYearSelector()` - Renders year dropdown with status badges and lifecycle transition buttons
- `renderStatusBanner()` - Displays status-specific banner (settling, closed with completion message, archived with integrity message)
- `startNewYear()` - Clones members and bills into a new billing year with fresh payment state
- `archiveCurrentYear()` - Sets year status to `archived` with confirmation
- `closeCurrentYear()` - Sets year status to `closed` with outstanding balance warning

### Family Member Management
- `addFamilyMember()` - Creates member with unique ID, optional email and phone. Shows change toast on success.
- `editFamilyMember(id)` / `editMemberEmail(id)` / `editMemberPhone(id)` - Inline editing via prompt
- `removeFamilyMember(id)` - Deletes member, cleans up bill references, shows change toast
- `uploadAvatar(id)` / `removeAvatar(id)` - Image upload with 200x200px PNG compression
- `manageLinkMembers(parentId)` - Opens dialog to link child members to a parent

### Bill Management
- `addBill()` - Creates bill with unique ID, amount, optional website. Shows change toast with recalculation message.
- `editBillName(id)` / `editBillAmount(id)` / `editBillWebsite(id)` - Inline editing. Amount changes show change toast.
- `removeBill(id)` - Deletes bill, shows change toast
- `uploadLogo(id)` / `removeLogo(id)` - Logo upload with compression
- `toggleMember(billId, memberId)` - Toggles member participation in a bill, shows change toast

### Calculations & Payments
- `calculateAnnualSummary()` - Computes monthly/yearly totals per member across all bills. Returns `{ [memberId]: { member, total, bills: [{ bill, monthlyShare, annualShare }] } }`
- `calculateSettlementMetrics()` - Derives settlement progress from existing data: `{ totalAnnual, totalPayments, totalOutstanding, paidCount, totalMembers, percentage }`
- `getCalculationBreakdown(memberSummary)` - Generates expandable HTML showing per-bill calculation formulas (amount x 12 / members = share)
- `toggleCalcBreakdown(memberId)` - Toggles visibility of a member's calculation breakdown panel
- `getPaymentStatusBadge(total, payment)` - Returns status badge HTML: "Outstanding", "Partial", or "Settled"
- `recordPayment(memberId, amount, method, note, distribute)` - Creates ledger entry (or distributed entries for linked members)
- `getPaymentTotalForMember(memberId)` - Derives paid-to-date total from ledger for a member
- `getMemberPayments(memberId)` - Returns sorted payment history for a member
- `deletePaymentEntry(paymentId, memberId)` - Removes a payment entry from the ledger, shows change toast
- `migratePaymentReceivedToLedger()` - One-time migration of legacy `paymentReceived` values into ledger entries

### Invoicing
- `generateInvoice()` - Full annual invoice in a new window (printable)
- `sendIndividualInvoice(memberId)` - Individual member invoice via mailto link
- `generateInvoiceHTML(summary, year)` - Renders printable HTML invoice

### Share Links
- `generateShareLink(memberId)` - Creates a cryptographic share token with configurable scopes, stores hash in Firestore
- `showShareLinks(memberId)` - Dialog listing all active share links for a member with copy/revoke controls
- `generateRawToken()` - Generates a 64-character hex token via Web Crypto API
- `hashToken(token)` - SHA-256 hashes a token for storage
- `validateToken(token)` - Client-side token format validation
- `computeMemberSummary(memberId)` - Computes a member's bill breakdown for share link data

### Payment Methods
- `PAYMENT_METHOD_TYPES` - Constant defining supported types (zelle, apple_cash, cashapp, venmo, paypal, other) with per-type field lists
- `addPaymentMethod()` - Adds a payment method by type, opens edit dialog for field entry
- `editPaymentMethod(id)` - Opens dialog with type-specific fields (email, phone, handle, url, instructions)
- `savePaymentMethodEdit(id)` - Persists edits from the payment method dialog with validation
- `removePaymentMethod(id)` - Removes a payment method
- `togglePaymentMethodEnabled(id)` - Toggles a payment method's enabled state
- `getEnabledPaymentMethods()` - Returns enabled payment methods from settings
- `getPaymentMethodDetail(method)` - Returns a summary string of a method's identifiers
- `renderPaymentMethodsSettings()` - Renders the payment methods configuration UI with type-aware cards
- `migratePaymentLinksToMethods(paymentLinks)` - Migrates legacy `{name, url}` links to structured payment methods, inferring type from name
- `formatPaymentOptionsHTML()` - Renders enabled payment methods as HTML for invoices (type-aware: Zelle shows email/phone, Apple Cash shows contact, others show URL)
- `formatPaymentOptionsText()` - Renders enabled payment methods as plain text for email invoices

### Payment UI
- `showAddPaymentDialog(memberId)` - Modal dialog to record a payment with amount, method, and note
- `submitPayment(memberId)` - Records payment, then shows confirmation with settlement progress bar for 2 seconds before auto-closing
- `showPaymentHistory(memberId)` - Timeline-style modal showing all ledger entries with remaining balance indicator
- `closePaymentDialog()` - Closes the payment dialog overlay
- `ensureDialogContainer()` - Lazily creates the dialog overlay DOM

### Settlement & Dashboard
- `renderDashboardStatus()` - Renders lifecycle progress bar, settlement progress bar with percentage, group completion messaging, and admin reminder hints
- `updateSummary()` - Renders annual summary table with payment tracking, calculation breakdown toggles, and settlement completion banner when all balances are zero

### Trust & Feedback
- `showChangeToast(message)` - Displays a brief green toast notification (3 seconds) confirming financial data changes

### Data Integrity
- `debugDataIntegrity()` - Logs data state to console for debugging
- `repairDuplicateIds()` - Fixes duplicate member IDs (runs automatically on load)
- `cleanupInvalidBillMembers()` - Removes invalid member references from bills (runs automatically on load)

### Dispute Resolution (Admin)
- `normalizeDisputeStatus(status)` - Maps legacy statuses (`pending`→`open`, `reviewed`→`in_review`)
- `loadDisputes()` - Loads disputes from Firestore, normalizes statuses, renders filter bar and list
- `renderDisputeFilterBar(disputes)` - Renders status filter buttons (All/Open/In Review/Resolved/Rejected) with counts
- `setDisputeFilter(status)` - Applies client-side status filter and re-renders
- `renderDisputes(disputes)` - Renders filtered dispute cards (clickable to open detail)
- `showDisputeDetail(disputeId)` - Detail dialog with status actions, resolution note, evidence, user review toggle, quick-jump links
- `doDisputeAction(disputeId, newStatus)` - Changes status with resolution note (required for resolve/reject)
- `updateDispute(disputeId, updates)` - Writes arbitrary updates to a dispute doc
- `toggleUserReview(disputeId, checked)` - Sets/clears `userReview.state = 'requested'`
- `uploadEvidence(disputeId)` - File picker with validation (PDF/PNG/JPEG, 20MB max, 10 max), uploads to Storage, saves metadata
- `viewEvidence(disputeId, index)` - Opens evidence file via Storage download URL
- `removeEvidence(disputeId, index)` - Deletes evidence from Storage and removes metadata

### Rendering
- `renderFamilyMembers()` - Renders member cards with avatars, edit/delete controls
- `renderBills()` - Renders bill cards with logos, member checkboxes
- `renderEmailSettings()` - Renders email message editor
- `renderStatusBanner()` - Renders lifecycle-state-specific banner

### Helpers
- `isValidE164(phone)` - Validates E.164 phone number format (+ followed by 1-15 digits, first digit non-zero)
- `getInitials(name)` - Extracts initials for avatar fallback
- `generateAvatar(member)` / `generateLogo(bill)` - HTML generation for images
- `uploadImage(callback)` - Shared image upload with Canvas compression
- `generateUniqueId()` / `generateUniqueBillId()` - Unique ID generators
- `escapeHtml(str)` - XSS prevention by escaping HTML special characters
- `sanitizeImageSrc(src)` - Validates image data URIs, rejects non-image and external sources
- `formatFileSize(bytes)` - Human-readable file size formatting
- `disputeStatusClass(status)` - Maps dispute status to CSS class

## Key Functions (auth.js)

- `switchTab(tab)` - Toggles between login/signup forms
- `handleLogin(event)` - Email/password authentication
- `handleSignup(event)` - Account creation with password confirmation
- `handleGoogleSignIn()` - Google OAuth sign-in
- `handleForgotPassword()` - Sends password reset email via Firebase
- `getErrorMessage(errorCode)` - Maps Firebase error codes to user-friendly messages

## Cloud Functions (functions/index.js)

- `resolveShareToken` - POST endpoint: validates share token, returns billing summary, linked members, payment data, disputes (if `disputes:read` scope), and payment links
- `submitDispute` - POST endpoint: creates a dispute from a share link (requires `disputes:create` scope), rate-limited to 10 per 24 hours per token
- `getEvidenceUrl` - POST endpoint: returns a 1-hour signed URL for a dispute evidence file (requires `disputes:read` scope, validates member ownership)
- `submitDisputeDecision` - POST endpoint: records user approve/reject decision on a dispute (requires `disputes:read` scope, idempotent)

### Share Token Scopes

| Scope | Purpose |
|-------|---------|
| `summary:read` | View billing summary and bill breakdown |
| `paymentMethods:read` | View payment methods (Venmo, Zelle, etc.) |
| `disputes:create` | Submit new review requests |
| `disputes:read` | View disputes, evidence, and approve/reject resolutions |

## Payment Ledger

Payments are stored as an append-only ledger per billing year. Each entry records `{id, memberId, amount, receivedAt, note, method}`. The per-member "paid to date" total is derived by summing all ledger entries for that member. Legacy `paymentReceived` counters are automatically migrated into a single "migration payment" entry on first load.

### Distributed Payments

When recording a payment for a parent with linked child members (with the "distribute" option):

1. Calculate total owed by parent + all linked children
2. Create individual ledger entries proportional to each person's annual total
3. Last child receives the rounding remainder to ensure the sum equals the entered amount

Example: Parent owes $1,000, Child owes $500 (total: $1,500). Payment of $900:
- Parent entry: $900 x ($1,000 / $1,500) = $600
- Child entry: $900 x ($500 / $1,500) = $300

## Billing Year Lifecycle

Each billing year progresses through four states:

| State | Order | Behavior | Badge Color |
|-------|:-----:|----------|-------------|
| `open` | 1 | Bills/members editable, payments allowed | Primary (blue) |
| `settling` | 2 | Invoices issued, payments being collected, admin reminders shown | Warning (amber) |
| `closed` | 3 | All balances settled, payments disabled, completion banner shown | Success (green) |
| `archived` | 4 | Fully read-only, historical reference only | Muted (gray) |

State transitions are managed via `setBillingYearStatus()`. The dashboard displays a lifecycle progress bar showing the current stage.

## UI/CSS Design System

All visual primitives are defined in `design-tokens.css` and consumed by `styles.css`.

- **Primary color:** `#667eea` / `var(--color-primary)`
- **Background:** Gradient from `var(--color-gradient-start)` to `var(--color-gradient-end)`
- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Spacing:** 8-point scale (`--space-1` through `--space-6`)
- **Layout:** CSS Grid, 2-column desktop, single-column mobile (breakpoint: 768px)
- **Core components:** `.card`, `.btn` (primary/secondary/success/danger), `.member-card`, `.bill-item`, `.summary-table`
- **Settlement components:** `.settlement-progress`, `.settlement-progress-bar`, `.settlement-message`, `.settlement-complete-banner`, `.settlement-admin-hint`
- **Transparency components:** `.calc-breakdown`, `.calc-toggle-btn`, `.payment-timeline`, `.change-toast`, `.privacy-footer`
- **Lifecycle components:** `.lifecycle-bar`, `.lifecycle-step`, `.lifecycle-active`, `.lifecycle-complete`
- **Avatar size:** 48x48px circle (32x32px in invoices)
- **Logo size:** 80x60px rectangle (40x30px in invoices)

## Development

### Testing

```bash
npm test
```

Tests use Node's built-in test runner (`node:test`) with `vm` to sandbox `script.js` in a mock DOM/Firebase environment. Test file: `tests/billing.test.js`.

**162 tests across 45 suites.** Covered areas:
- `escapeHtml` - XSS prevention utility
- `calculateAnnualSummary` - bill splitting math across members and multiple bills
- `recordPayment` - ledger entry creation, proportional distribution for linked members, non-positive rejection
- `getPaymentTotalForMember` - per-member ledger sum derivation
- `migratePaymentReceivedToLedger` - legacy migration, parent/child split, idempotency, zero-out
- `deletePaymentEntry` - ledger entry removal
- `manageLinkMembers` - link preservation and cross-parent isolation
- `editBillWebsite` - URL validation (rejects non-http schemes)
- `sanitizeImageSrc` - image URI validation (rejects non-image, javascript:, external URLs)
- `isValidE164` - E.164 phone validation (format, length, leading zero rejection)
- `editMemberPhone` - phone editing (set, clear, reject invalid, archived guard)
- `addFamilyMember` with phone - phone included on create (valid, invalid, blank, missing input)
- `isArchivedYear` / `isClosedYear` / `isSettlingYear` / `isYearReadOnly` - lifecycle state helpers
- `yearReadOnlyMessage` / `getBillingYearStatusLabel` / `BILLING_YEAR_STATUSES` - lifecycle constants
- `closed year guards` / `archived year guards` - mutation prevention by state
- `startNewYear` / `archiveCurrentYear` - year management operations
- `saveData archived guard` - write prevention for read-only years
- `generateRawToken` / `hashToken` - cryptographic token generation and hashing
- `computeMemberSummary` / `validateToken` / `validateDisputeInput` - share link utilities
- `payment methods settings` - payment method CRUD, migration, type constants, enable/disable, archived guards
- `normalizeDisputeStatus` / `disputeStatusClass` - dispute status mapping
- `formatFileSize` / `Evidence constraints` / `DISPUTE_STATUS_LABELS` - dispute utilities
- `migrateLegacyData` - flat-to-year-scoped data migration
- `CURRENT_MIGRATION_VERSION` - migration version constant
- `calculateSettlementMetrics` - settlement percentage, paid count, edge cases
- `getPaymentStatusBadge labels` - badge text verification ("Settled" not "Paid")
- `getCalculationBreakdown` - bill breakdown HTML generation and XSS escaping
- `showChangeToast` - change notification function

### Local Development

```bash
git clone <repository-url>
cd friends-and-family-billing

firebase login
firebase use friends-and-family-billing

# Local server
firebase serve
# Or: python3 -m http.server 8000
```

### Deployment

```bash
# Full deployment (hosting + Firestore rules)
firebase deploy

# Hosting only
firebase deploy --only hosting

# Firestore rules only
firebase deploy --only firestore:rules

# Cloud Functions only
firebase deploy --only functions
```

### Firebase Hosting Configuration

- Public directory: `.` (project root)
- Ignored from deployment: `firebase.json`, dotfiles, `node_modules`, markdown docs
- Cache-control: `no-cache, no-store, must-revalidate` on all `.js` files
- SPA rewrite: all routes -> `/index.html`

## Analytics Events

The app tracks these Firebase Analytics events:
- `family_member_added` - When a new member is created
- `bill_added` - When a new bill is created
- `invoice_sent` - When an individual invoice is emailed
- `login` / `sign_up` - Authentication events

## Known Limitations

- Email invoices use `mailto:` links (requires a desktop email client)
- Images stored as base64 strings in Firestore (subject to document size limits)
- No PDF generation (invoices are printable HTML)
- Single Firestore document per billing year (may hit 1MB limit with many large images)

## Resolved Bugs (Historical)

1. Duplicate member IDs causing bills to show incorrect member counts
2. Avatar upload failures due to LocalStorage quota limits (resolved by Firebase migration)
3. Black backgrounds on logos from JPEG transparency handling (fixed: PNG compression)
4. Data not loading after refresh (fixed: proper async/await on Firestore reads)
5. Linked member payment math showing incorrect credits (fixed: proportional distribution)

## Troubleshooting

- **Data not loading:** Hard refresh (Cmd+Shift+R / Ctrl+Shift+R), check console, verify Firebase config
- **Auth issues:** Verify providers are enabled in Firebase Console, check authorized domains
- **Payment errors:** Data repair runs automatically on load; re-enter payment amounts if needed
- **Data verification:** Open `check_data.html` while logged in to inspect raw Firestore data
- **Billing year issues:** Check `currentBillingYear.status` in console; use year selector to switch years
