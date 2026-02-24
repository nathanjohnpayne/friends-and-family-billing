# Family Bill Splitter - AI Agent Instructions

## Project Overview

Family Bill Splitter is a cloud-based web application for managing and splitting monthly bills among family members. It features multi-user authentication, flexible bill splitting, parent-child account linking, payment tracking, and email invoicing with annual summaries.

**Live URL:** https://friends-and-family-billing.web.app
**Firebase Project ID:** `friends-and-family-billing`

## Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (no build tools or frameworks)
- **Backend/Infrastructure:** Firebase
  - Firebase Authentication (Email/Password + Google Sign-In)
  - Cloud Firestore (NoSQL database)
  - Firebase Hosting with CDN
  - Firebase Analytics
- **Image Processing:** Canvas API for client-side compression (max 200x200px PNG)
- **Dependencies:** Firebase SDK v10.7.1 loaded via CDN (compat libraries)

## Project Structure

```
.
├── index.html                 # Main application page (authenticated users only)
├── login.html                 # Login/signup page with Google Sign-In
├── check_data.html            # Firebase data verification/debugging tool
├── script.js                  # Main application logic (~1,600 lines)
├── auth.js                    # Authentication handling (~160 lines)
├── firebase-config.js         # Firebase initialization and SDK exports
├── styles.css                 # Application styles (~540 lines)
├── firestore.rules            # Firestore security rules
├── firebase.json              # Firebase hosting and deployment configuration
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
5. All data operations scoped to `/users/{userId}` document

### Data Architecture

**Firestore document structure** (`/users/{userId}`):

```
/users/{userId}
  ├── familyMembers: Array<{
  │     id: number,
  │     name: string,
  │     email: string,
  │     avatar: string (base64 data URL),
  │     paymentReceived: number,
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
  ├── settings: {
  │     emailMessage: string
  │   }
  └── updatedAt: Timestamp
```

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
| `check_data.html` | Yes | Debug tool to inspect raw Firestore data |

### Firebase SDK Loading Order

Scripts must load in this exact order (all pages):

1. `firebase-app-compat.js` - Core Firebase
2. `firebase-auth-compat.js` - Authentication
3. `firebase-firestore-compat.js` - Firestore (index.html, check_data.html only)
4. `firebase-analytics-compat.js` - Analytics (index.html, login.html only)
5. `firebase-config.js` - Initializes Firebase, exports `auth`, `db`, `analytics`
6. `script.js` or `auth.js` - Application logic

## Key Functions (script.js)

### Data Persistence
- `loadData()` - Fetches user data from Firestore, initializes defaults for missing fields
- `saveData()` - Persists `familyMembers`, `bills`, `settings` to Firestore with timestamp

### Family Member Management
- `addFamilyMember()` - Creates member with unique ID, optional email
- `editFamilyMember(id)` / `editMemberEmail(id)` - Inline editing via prompt
- `removeFamilyMember(id)` - Deletes member and cleans up all bill references
- `uploadAvatar(id)` / `removeAvatar(id)` - Image upload with 200x200px PNG compression
- `manageLinkMembers(parentId)` - Opens dialog to link child members to a parent

### Bill Management
- `addBill()` - Creates bill with unique ID, amount, optional website
- `editBillName(id)` / `editBillAmount(id)` / `editBillWebsite(id)` - Inline editing
- `removeBill(id)` - Deletes bill
- `uploadLogo(id)` / `removeLogo(id)` - Logo upload with compression
- `toggleMember(billId, memberId)` - Toggles member participation in a bill

### Calculations & Payments
- `calculateAnnualSummary()` - Computes monthly/yearly totals per member across all bills
- `updatePayment(memberId, value)` - Distributes payment proportionally among parent + linked members

### Invoicing
- `generateInvoice()` - Full annual invoice in a new window (printable)
- `sendIndividualInvoice(memberId)` - Individual member invoice via mailto link
- `generateInvoiceHTML(summary, year, forPrint)` - Renders printable HTML invoice
- `generateIndividualInvoiceHTML(memberData, year)` - Renders individual invoice HTML

### Data Integrity
- `debugDataIntegrity()` - Logs data state to console for debugging
- `repairDuplicateIds()` - Fixes duplicate member IDs
- `cleanupInvalidBillMembers()` - Removes invalid member references from bills
- `forceDataRepair()` - Runs all repair functions
- `importFromLocalStorage()` - Migrates pre-Firebase LocalStorage data
- `clearAllData()` - Deletes all user data with confirmation

### Rendering
- `renderFamilyMembers()` - Renders member cards with avatars, edit/delete controls
- `renderBills()` - Renders bill cards with logos, member checkboxes
- `updateSummary()` - Renders annual summary table with payment tracking
- `renderEmailSettings()` - Renders email message editor

### Helpers
- `getInitials(name)` - Extracts initials for avatar fallback
- `generateAvatar(member)` / `generateLogo(bill)` - HTML generation for images
- `uploadImage(callback)` - Shared image upload with Canvas compression
- `generateUniqueId()` / `generateUniqueBillId()` - Unique ID generators

## Key Functions (auth.js)

- `switchTab(tab)` - Toggles between login/signup forms
- `handleLogin(event)` - Email/password authentication
- `handleSignup(event)` - Account creation with password confirmation
- `handleGoogleSignIn()` - Google OAuth sign-in
- `getErrorMessage(errorCode)` - Maps Firebase error codes to user-friendly messages

## Payment Distribution Logic

When a payment is entered for a parent with linked child members:

1. Calculate total owed by parent + all linked children
2. Distribute payment proportionally based on individual totals
3. Update each person's `paymentReceived` field

Example: Parent owes $1,000, Child owes $500 (total: $1,500). Payment of $900:
- Parent receives: $900 x ($1,000 / $1,500) = $600
- Child receives: $900 x ($500 / $1,500) = $300

## UI/CSS Design System

- **Primary color:** `#667eea` (purple)
- **Background:** Gradient from `#667eea` to `#764ba2`
- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Layout:** CSS Grid, 2-column desktop, single-column mobile (breakpoint: 768px)
- **Components:** `.card`, `.btn` (primary/secondary/success/danger), `.member-card`, `.bill-item`, `.summary-table`
- **Avatar size:** 48x48px circle (32x32px in invoices)
- **Logo size:** 80x60px rectangle (40x30px in invoices)

## Development

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
- Single Firestore document per user (may hit 1MB limit with many large images)

## Resolved Bugs (Historical)

1. Duplicate member IDs causing bills to show incorrect member counts
2. Avatar upload failures due to LocalStorage quota limits (resolved by Firebase migration)
3. Black backgrounds on logos from JPEG transparency handling (fixed: PNG compression)
4. Data not loading after refresh (fixed: proper async/await on Firestore reads)
5. Linked member payment math showing incorrect credits (fixed: proportional distribution)

## Troubleshooting

- **Data not loading:** Hard refresh (Cmd+Shift+R / Ctrl+Shift+R), check console, verify Firebase config
- **Auth issues:** Verify providers are enabled in Firebase Console, check authorized domains
- **Payment errors:** Use "Repair Data" button, re-enter payment amounts
- **Data verification:** Open `check_data.html` while logged in to inspect raw Firestore data
