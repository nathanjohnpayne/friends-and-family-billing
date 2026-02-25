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
  - Cloud Functions v2 (dispute submission, evidence URLs, dispute decisions)
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
├── share.html                 # Public share-link page (reads from Firestore, no auth)
├── check_data.html            # Firebase data verification/debugging tool
├── script.js                  # Main application logic (~3,670 lines)
├── auth.js                    # Authentication handling (~170 lines)
├── firebase-config.js         # Firebase init, conditional SDK exports (guards for missing SDKs)
├── design-tokens.css          # Design system tokens (colors, spacing, typography)
├── styles.css                 # Application styles (~1,980 lines, consumes design-tokens.css)
├── version.json               # App version for update checking (stamped on deploy)
├── stamp-version.js           # Predeploy script that writes current timestamp to version.json
├── logo.svg                   # App logo (SVG)
├── og-image.png               # OpenGraph social preview image
├── firestore.rules            # Firestore security rules
├── storage.rules              # Firebase Storage security rules
├── firebase.json              # Firebase hosting, functions, and deployment configuration
├── package.json               # Test script (npm test) and root dependencies
├── functions/
│   ├── index.js               # Cloud Functions v2 entry point
│   ├── billing.js             # Shared billing utilities for Cloud Functions
│   └── package.json           # Cloud Functions dependencies
├── tests/
│   └── billing.test.js        # Automated tests (~2,240 lines, Node built-in test runner)
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
  │     method: string ("cash"|"check"|"venmo"|"zelle"|"paypal"|"bank_transfer"|"other"),
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

### Application Pages

| Page | Auth Required | Purpose |
|------|:------------:|---------|
| `index.html` | Yes | Main app with all bill-splitting functionality |
| `login.html` | No | Email/Password and Google Sign-In authentication |
| `share.html` | No | Public billing summary via Firestore `publicShares` collection |
| `check_data.html` | Yes | Debug tool to inspect raw Firestore data |

### Firebase SDK Loading Order

Scripts must load in this exact order (all pages):

1. `firebase-app-compat.js` - Core Firebase
2. `firebase-auth-compat.js` - Authentication (index.html, login.html, check_data.html)
3. `firebase-firestore-compat.js` - Firestore (index.html, check_data.html, share.html)
4. `firebase-storage-compat.js` - Storage (index.html only)
5. `firebase-analytics-compat.js` - Analytics (index.html, login.html only)
6. `firebase-config.js` - Initializes Firebase, conditionally exports `auth`, `db`, `storage`, `analytics` (returns `null` for SDKs not loaded on the current page)
7. `script.js` or `auth.js` - Application logic

## Key Functions (script.js)

### Data Persistence
- `loadData()` - Fetches user data from Firestore billing year document, initializes defaults for missing fields
- `saveData()` - Persists `familyMembers`, `bills`, `payments`, `billingEvents`, `settings` to the active billing year document with timestamp. Blocked when year is read-only (closed/archived). Also calls `refreshPublicShares()`.
- `logout()` - Signs out the current user and redirects to login page

### Version Checking
- `checkForUpdate()` - Fetches `version.json` and compares against the running version to detect new deployments
- `showUpdateToast()` - Displays an "Update available" toast notification with reload action
- `dismissUpdateToast()` - Dismisses the update toast
- `startUpdateChecker()` - Starts periodic update checking (every 5 minutes)

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
- `renderArchivedBanner()` - Renders the archived year read-only banner
- `loadBillingYearsList()` - Loads all billing year documents for the current user
- `loadBillingYearData(yearId)` - Loads a specific billing year's data from Firestore
- `switchBillingYear(yearId)` - Switches the active billing year in the UI
- `startNewYear()` - Clones members and bills into a new billing year with fresh payment state
- `archiveCurrentYear()` - Sets year status to `archived` with confirmation
- `closeCurrentYear()` - Sets year status to `closed` with outstanding balance warning
- `migrateLegacyData(userDocRef, userData)` - Migrates flat user document data into year-scoped subcollections

### Family Member Management
- `addFamilyMember()` - Creates member with unique ID, optional email and phone. Shows change toast on success.
- `editFamilyMember(id)` / `editMemberEmail(id)` / `editMemberPhone(id)` - Inline editing via prompt
- `removeFamilyMember(id)` - Deletes member, cleans up bill references, shows change toast
- `uploadAvatar(id)` / `removeAvatar(id)` - Image upload with 200x200px PNG compression
- `manageLinkMembers(parentId)` - Opens dialog to link child members to a parent
- `isLinkedToAnyone(memberId)` - Checks if a member is linked as a child to any parent
- `getParentMember(memberId)` - Returns the parent member for a linked child

### Billing Frequency Helpers
- `getBillAnnualAmount(bill)` - Returns canonical annual amount (amount for annual bills, amount*12 for monthly)
- `getBillMonthlyAmount(bill)` - Returns derived monthly amount (amount/12 for annual bills, amount for monthly)
- `getBillFrequencyLabel(bill)` - Returns display suffix: ` / year` or ` / month`
- `setAddBillFrequency(frequency)` / `getAddBillFrequency()` - Manage the Add Bill form frequency toggle state and update the amount label dynamically
- `updateBillAmountPreview()` - Live derived amount preview beneath the bill amount input (shows annual↔monthly equivalent)
- `toggleBillFrequency(id)` - Switches a bill between monthly and annual, converting the canonical amount

### Bill Management
- `addBill()` - Creates bill with unique ID, amount, billing frequency, optional website. Emits `BILL_CREATED` event.
- `editBillName(id)` / `editBillAmount(id)` / `editBillWebsite(id)` - Inline editing. Emits `BILL_UPDATED` events with before/after values.
- `removeBill(id)` - Deletes bill, emits `BILL_DELETED` event with snapshot
- `uploadLogo(id)` / `removeLogo(id)` - Logo upload with compression
- `toggleMember(billId, memberId)` - Toggles member participation in a bill, emits `MEMBER_ADDED_TO_BILL` or `MEMBER_REMOVED_FROM_BILL` event
- `showBillAuditHistory(billId)` - Opens dialog showing the complete event timeline for a bill

### Calculations & Payments
- `calculateAnnualSummary()` - Computes monthly/yearly totals per member using canonical amounts (`getBillAnnualAmount`). Returns `{ [memberId]: { member, total, bills: [{ bill, monthlyShare, annualShare }] } }`
- `calculateSettlementMetrics()` - Derives settlement progress from existing data: `{ totalAnnual, totalPayments, totalOutstanding, paidCount, totalMembers, percentage }`
- `getCalculationBreakdown(memberSummary)` - Generates expandable HTML showing per-bill formulas (frequency-aware: `$X / year ÷ N` for annual, `$X / month × 12 ÷ N` for monthly)
- `toggleCalcBreakdown(memberId)` - Toggles visibility of a member's calculation breakdown panel
- `getPaymentStatusBadge(total, payment)` - Returns status badge HTML: "Outstanding", "Partial", or "Settled"
- `recordPayment(memberId, amount, method, note, distribute)` - Creates ledger entry (or distributed entries for linked members). Emits `PAYMENT_RECORDED` events.
- `getPaymentTotalForMember(memberId)` - Derives paid-to-date total from ledger for a member (reversals have negative amounts)
- `getMemberPayments(memberId)` - Returns sorted payment history for a member
- `deletePaymentEntry(paymentId, memberId)` - Creates a reversal entry (negative amount) instead of deleting. Marks original as `reversed: true`. Emits `PAYMENT_REVERSED` event. Preserves full audit trail.
- `migratePaymentReceivedToLedger()` - One-time migration of legacy `paymentReceived` values into ledger entries

### Invoicing
- `generateInvoice()` - Full annual invoice in a new window (printable)
- `sendIndividualInvoice(memberId)` - Individual member invoice via mailto link
- `generateInvoiceHTML(summary, year)` - Renders printable HTML invoice

### Share Links
- `generateShareLink(memberId)` - Opens scope selection dialog for share link generation
- `doGenerateShareLink(memberId)` - Creates a cryptographic share token, writes to `shareTokens` and `publicShares` collections
- `showShareLinkSuccess(shareUrl, memberName, autoCopied)` - Renders success dialog with copy-to-clipboard UI
- `copyShareLinkUrl()` - Copies the share link URL from the success dialog input field
- `showShareLinks(memberId)` - Dialog listing all active share links for a member with copy/revoke controls
- `revokeShareLink(tokenHash, memberId)` - Marks a share token as revoked in Firestore
- `generateRawToken()` - Generates a 64-character hex token via Web Crypto API
- `hashToken(token)` - SHA-256 hashes a token for storage
- `computeMemberSummaryForShare(targetMemberId)` - Computes a member's bill breakdown for share data
- `buildPublicShareData(memberId, scopes)` - Constructs the denormalized `publicShares` document
- `refreshPublicShares()` - Refreshes all active `publicShares` documents for the current billing year (called by `saveData()`)

### Payment Method Icons
- `PAYMENT_METHOD_ICONS` - Constant mapping payment method types to inline SVG icon strings (zelle, cashapp, venmo, paypal, apple_cash, other)
- `getPaymentMethodIcon(type)` - Returns the SVG icon string for a payment method type

### Payment Methods
- `PAYMENT_METHOD_TYPES` - Constant defining supported types ordered by popularity (venmo, zelle, cashapp, paypal, apple_cash, other) with per-type field lists
- `getPaymentMethodLabel(method)` - Returns display label for a payment method type
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
- `updatePaymentPreview(memberId)` - Dynamically updates the payment amount preview in the payment dialog
- `toggleDistributePreview()` - Toggles the distributed payment breakdown preview for linked members
- `showPaymentHistory(memberId)` - Timeline-style modal showing all ledger entries with remaining balance indicator
- `closePaymentDialog()` - Closes the payment dialog overlay
- `ensureDialogContainer()` - Lazily creates the dialog overlay DOM

### Text Invoice
- `showTextInvoiceDialog(memberId)` - Opens a dialog with a pre-filled SMS message containing the member's billing summary, amount due, and share link (if available). Supports copy-to-clipboard and `sms:` deep link.
- `copyTextInvoiceMessage()` - Copies the text invoice message textarea to clipboard
- `copyTextInvoiceLink(url)` - Copies a share link URL to clipboard

### Bill Card Helpers
- `toggleBillSplit(billId)` - Toggles the collapsible "Split with" section between collapsed summary and expanded checkbox grid
- `toggleBillActionsMenu(event, billId)` - Toggles the bill card "Actions" dropdown menu, closing any other open menus

### Settlement & Dashboard
- `renderDashboardStatus()` - Renders lifecycle progress bar, settlement progress bar with percentage, group completion messaging, and admin reminder hints
- `updateSummary()` - Renders annual summary table with payment tracking, calculation breakdown toggles, and settlement completion banner when all balances are zero
- `toggleActionMenu(event)` - Toggles visibility of per-member action menu dropdowns
- `closeAllActionMenus()` - Closes all open action menus

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
- `getDisputeRef(disputeId)` - Returns a Firestore document reference for a dispute
- `doDisputeAction(disputeId, newStatus)` - Changes status with resolution note (required for resolve/reject)
- `updateDispute(disputeId, updates)` - Writes arbitrary updates to a dispute doc
- `toggleUserReview(disputeId, checked)` - Sets/clears `userReview.state = 'requested'`
- `scrollToBill(billId)` / `scrollToMember(memberId)` - Scrolls the view to a specific bill or member card
- `uploadEvidence(disputeId)` - File picker with validation (PDF/PNG/JPEG, 20MB max, 10 max), uploads to Storage, saves metadata
- `viewEvidence(disputeId, index)` - Opens evidence file via Storage download URL
- `removeEvidence(disputeId, index)` - Deletes evidence from Storage and removes metadata

### Rendering
- `renderFamilyMembers()` - Renders member cards with avatars, edit/delete controls
- `renderBills()` - Renders bill cards with logos, member checkboxes
- `renderEmailSettings()` - Renders email message editor
- `saveEmailMessage()` - Persists the email message setting

### Money Integrity Layer (Event Ledger)
- `emitBillingEvent(eventType, payload, note, source)` - Appends an event to the append-only `billingEvents` ledger with timestamp and actor attribution
- `generateEventId()` - Generates unique `evt_*` IDs for events
- `getBillingEventsForBill(billId)` - Returns all events for a bill, sorted newest first
- `getBillingEventsForMember(memberId)` - Returns all events for a member, sorted newest first
- `getBillingEventsForPayment(paymentId)` - Returns events referencing a payment (including reversals)
- `showBillAuditHistory(billId)` - Opens dialog showing the complete event timeline for a bill
- `BILLING_EVENT_LABELS` - Human-readable labels for all event types

### Helpers
- `isValidE164(phone)` - Validates E.164 phone number format (+ followed by 1-15 digits, first digit non-zero)
- `getInitials(name)` - Extracts initials for avatar fallback
- `generateAvatar(member)` / `generateLogo(bill)` - HTML generation for images
- `uploadImage(callback)` - Shared image upload with Canvas compression
- `generateUniqueId()` / `generateUniqueBillId()` / `generateUniquePaymentId()` - Unique ID generators
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

All functions use the **v2 API** (`firebase-functions/v2/https` with `onRequest`). They are deployed to `us-central1`.

> **Note:** The GCP organization policy blocks granting `allUsers` the Cloud Run invoker role, so these functions cannot be made publicly accessible. The share page reads data directly from the `publicShares` Firestore collection instead of calling `resolveShareToken`. Dispute-related functions are still called from `share.html` via Firebase Hosting rewrites or direct URLs.

- `resolveShareToken` - POST endpoint: validates share token, returns billing summary, linked members, payment data, disputes (if `disputes:read` scope), and payment methods. Writes audit log entry on access.
- `submitDispute` - POST endpoint: creates a dispute from a share link (requires `disputes:create` scope), rate-limited to 10 per 24 hours per token. Writes audit log entry.
- `getEvidenceUrl` - POST endpoint: returns a 1-hour signed URL for a dispute evidence file (requires `disputes:read` scope, validates member ownership)
- `submitDisputeDecision` - POST endpoint: records user approve/reject decision on a dispute (requires `disputes:read` scope, idempotent). Writes audit log entry.
- `appendAuditLog(ownerId, entry)` - Internal helper that writes audit entries to `/users/{userId}/auditLog`
- `_testHelpers` - Test-only export exposing `validateToken`, `validateDisputeInput`, `DISPUTE_RATE_LIMIT`, `EVIDENCE_URL_EXPIRY_MS`

### Share Token Scopes

| Scope | Purpose |
|-------|---------|
| `summary:read` | View billing summary and bill breakdown |
| `paymentMethods:read` | View payment methods (Venmo, Zelle, etc.) |
| `disputes:create` | Submit new review requests |
| `disputes:read` | View disputes, evidence, and approve/reject resolutions |

## Payment Ledger

Payments are stored as an append-only ledger per billing year. Each entry records `{id, memberId, amount, receivedAt, note, method}`. The per-member "paid to date" total is derived by summing all ledger entries for that member (including negative reversal amounts). Legacy `paymentReceived` counters are automatically migrated into a single "migration payment" entry on first load.

### Payment Reversals

Payments are never physically deleted. Instead, `deletePaymentEntry()` creates a **reversal**:
1. The original payment is marked `reversed: true`
2. A new entry with `type: "reversal"`, `reversesPaymentId`, and a negative `amount` is appended
3. A `PAYMENT_REVERSED` event is emitted to the billing event ledger

This preserves the full audit trail while correctly adjusting the member's balance.

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
- **Frequency toggle components:** `.frequency-toggle`, `.frequency-option`, `.frequency-option.active`, `.bill-frequency-toggle`, `.derived-amount-preview`, `.bill-derived-amount`
- **Audit & reversal components:** `.audit-event`, `.audit-event-header`, `.payment-reversed`, `.payment-reversal`, `.reversal-tag`
- **Avatar size:** 48x48px circle (32x32px in invoices)
- **Logo size:** 80x60px rectangle (40x30px in invoices)

## Development

### Testing

```bash
npm test
```

Tests use Node's built-in test runner (`node:test`) with `vm` to sandbox `script.js` in a mock DOM/Firebase environment. Test file: `tests/billing.test.js`.

**232 tests across 66 suites.** Covered areas:
- `escapeHtml` - XSS prevention utility
- `calculateAnnualSummary` - bill splitting math across members and multiple bills, frequency-aware calculations
- `recordPayment` - ledger entry creation, proportional distribution for linked members, non-positive rejection, event emission
- `getPaymentTotalForMember` - per-member ledger sum derivation (including reversals)
- `migratePaymentReceivedToLedger` - legacy migration, parent/child split, idempotency, zero-out
- `deletePaymentEntry` - payment reversal (marks original reversed, appends negative entry, emits event)
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
- `computeMemberSummary` / `validateToken` / `validateDisputeInput` - share link and dispute utilities (tested via Cloud Functions exports)
- `payment methods settings` - payment method CRUD, migration, type constants, enable/disable, archived guards
- `normalizeDisputeStatus` / `disputeStatusClass` - dispute status mapping
- `formatFileSize` / `Evidence constraints` / `DISPUTE_STATUS_LABELS` - dispute utilities
- `migrateLegacyData` - flat-to-year-scoped data migration
- `CURRENT_MIGRATION_VERSION` - migration version constant
- `calculateSettlementMetrics` - settlement percentage, paid count, edge cases
- `getPaymentStatusBadge labels` - badge text verification ("Settled" not "Paid")
- `getCalculationBreakdown` - bill breakdown HTML generation and XSS escaping
- `showChangeToast` - change notification function
- `billing frequency` - canonical amount helpers, monthly/annual toggle, frequency-aware annual summary
- `billing event ledger` - event emission, event ID generation, event filtering by bill/member/payment
- `bill mutations emit events` - BILL_CREATED, BILL_UPDATED, BILL_DELETED, MEMBER_ADDED/REMOVED_TO_BILL events
- `payment events` - PAYMENT_RECORDED and PAYMENT_REVERSED event emission
- `showBillAuditHistory` - audit history dialog rendering
- `updateBillAmountPreview` - derived amount preview (monthly↔annual conversion, edge cases, rounding)
- `setAddBillFrequency updates label` - dynamic form label updates when frequency toggle changes

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
# Full deployment (hosting + Firestore rules + Storage rules + functions)
firebase deploy

# Hosting only (runs stamp-version.js predeploy hook automatically)
firebase deploy --only hosting

# Firestore rules only
firebase deploy --only firestore:rules

# Cloud Functions only (may show IAM errors due to org policy — functions still deploy)
firebase deploy --only functions
```

### Firebase Hosting Configuration

- Public directory: `.` (project root)
- Predeploy hook: `node stamp-version.js` (stamps `version.json` with current ISO timestamp for update detection)
- Ignored from deployment: `firebase.json`, dotfiles, `node_modules`, markdown docs, `package.json`, `tests/`, `functions/`, `stamp-version.js`
- Cache-control: `no-cache, no-store, must-revalidate` on all `.js` files, `version.json`, and `share.html`
- Rewrites: `/share` → `share.html`, then SPA catch-all `**` → `index.html`

## Analytics Events

The app tracks these Firebase Analytics events:
- `family_member_added` - When a new member is created
- `bill_added` - When a new bill is created
- `share_link_generated` - When a share link is created (includes `has_expiry`, `billing_year`)
- `invoice_sent` - When an individual invoice is emailed
- `login` / `sign_up` - Authentication events

## Known Limitations

- Email invoices use `mailto:` links (requires a desktop email client)
- Images stored as base64 strings in Firestore (subject to document size limits)
- No PDF generation (invoices are printable HTML)
- Single Firestore document per billing year (may hit 1MB limit with many large images)
- GCP organization policy blocks making Cloud Functions publicly accessible; share page reads from `publicShares` Firestore collection instead
- Existing share links generated before the `publicShares` migration must be regenerated

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
- **Share links not loading:** Regenerate the share link — older links created before the `publicShares` migration won't have data in Firestore
- **Cloud Functions 403:** Expected due to GCP org policy; share page reads from Firestore directly, not Cloud Functions
