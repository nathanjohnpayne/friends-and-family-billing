# Family Bill Splitter

A cloud-based web application for coordinating and settling annual shared bills among friends and family. Features per-account authentication, billing year lifecycle management, settlement progress tracking by Household, share links, Review Requests, Credits with Refunds or Carry-forward, Usage Charges and Service Credits, and invoicing by email or text.

**🌐 Live Application:** [https://friends-and-family-billing.web.app](https://friends-and-family-billing.web.app)

![Family Bill Splitter](https://img.shields.io/badge/status-live-success)
![Firebase](https://img.shields.io/badge/firebase-hosting-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

The terms below follow the domain glossary in [CONTEXT.md](CONTEXT.md).

### 👥 Accounts & Sign-In

- ✅ Email/Password authentication with forgot-password recovery
- ✅ Google Sign-In
- ✅ Email verification: sign-up sends a verification email, and a banner on every signed-in page offers to resend it; sending email from the app requires a verified account email
- ✅ Per-account data isolation (each Administrator sees only their own billing years)
- ✅ Data stored in Cloud Firestore, so it is available from any device you sign in on (it is not pushed live between open sessions; see [Persistence](#persistence))

### 📅 Billing Year Lifecycle

- ✅ Four lifecycle states: Open → Settling → Closed → Archived
- ✅ Lifecycle bar and forward action on the Dashboard (Start Settlement, Close Year, Archive Year); Close Year is enabled only once no Household has a balance due
- ✅ Settings → Billing Controls: switch the active year, move a Settling year back to Open, reopen a Closed year to Settling, start a new year
- ✅ Closed and Archived years are read-only
- ✅ Start New Year clones members, bills, the invoice template text and payment methods, and carries undisposed Credits and deferred Usage Charges forward as one opening balance per Household ([ADR 0006](docs/adr/0006-undisposed-adjustments-auto-carry.md))
- ✅ Closed years are corrected forward: refunds, charges and Service Credits happen in the open year, and reopening is reserved for correcting the closed year's own ledger ([ADR 0007](docs/adr/0007-closed-years-are-corrected-forward.md))

### 👨‍👩‍👧‍👦 Members & Households

- ✅ Add, edit and remove Members, with email addresses and phone numbers (E.164 format)
- ✅ Households: attach Linked Members to a Primary Member ("Manage Household"); a member can belong to only one Household
- ✅ A Household settles as one unit, with an optional proportional split of a payment across its members
- ✅ Initials avatars, with a Gravatar lookup from the member's email on the settlement board

### 💰 Bills

- ✅ Add, edit and remove bills with monthly or annual amounts
- ✅ Billing frequency toggle (Monthly ↔ Annual) per bill
- ✅ Canonical amount strategy prevents rounding drift
- ✅ Service logos: upload PNG, JPEG or SVG (rasterized to a PNG of at most 200px); without an upload, a Logo.dev lookup from the bill's website or name (when `VITE_LOGODEV_KEY` is configured), then initials
- ✅ Website URLs for each service (http/https)
- ✅ Per-bill member selection
- ✅ Per-bill audit history ("View History" timeline)
- ✅ Service Credits: record a reduction for a canceled, reduced or discounted service, split among the bill's members (or applied to one member) without editing the bill's amount

### 📊 Settlement

- ✅ Settlement board of Household cards with filters and status badges: Outstanding / Partial / Settled / Overpaid
- ✅ Global settlement progress bar with percentage and group messaging ("5 of 8 members are settled")
- ✅ KPIs: Outstanding, Owed to Members (unresolved Credits), Settled, Open Reviews
- ✅ Expandable per-bill calculation breakdowns on each Household card
- ✅ Record payments, edit them, and reverse them (no silent deletes)
- ✅ Payment history timeline with remaining balance
- ✅ Reminder hint for outstanding members

### 💸 Credits, Refunds and Carry-forward

- ✅ A Credit is the amount a Household has paid beyond what it owes; it is owned and cleared at the Household level ([ADR 0001](docs/adr/0001-household-is-the-unit-of-credit-and-refund.md))
- ✅ Record a Refund to the Primary Member (capped at the Household's Credit); recording it clears the Credit ([ADR 0003](docs/adr/0003-recording-clears-the-gate-confirmation-is-advisory.md))
- ✅ A Refund sends the member a Refund Notice by email with a link to confirm receipt or report that it has not arrived
- ✅ Credits not refunded carry forward to the next billing year; there is no write-off path ([ADR 0004](docs/adr/0004-credits-flow-back-to-the-member.md))

### 🧾 Usage Charges and Charge Notices

- ✅ Record a Usage Charge against one member for something they incurred mid-year (for example, a roaming overage); it is recorded as deferred, not billed ([ADR 0005](docs/adr/0005-symmetric-owed-adjustment-model.md))
- ✅ Members see their own pending Usage Charges on their share page, and the Dashboard shows the deferred total
- ✅ "Bill Charges" off-cycle-bills a Household's deferred charges as a single Charge Notice, which raises what the Household owes; the member pays it or contests it with a Review Request
- ✅ Deferred charges still unbilled at year end carry forward to the next year

### 🔗 Share Links

- ✅ Token-based billing summaries for a member's Household (no login required)
- ✅ Newly generated links show the summary, payment methods, the member's pending Usage Charges and the Household's payment history (links created before Usage Charges or payment history existed omit those sections until regenerated); options add Review Request submission and viewing
- ✅ Configurable expiry, revocation and a Manage Links view; up to five active links per member per year, with older links revoked automatically
- ✅ Personal settlement callout (outstanding balance or settled confirmation) and payment progress
- ✅ Service Credits shown as line items under the Household total
- ✅ A member whose link has expired or been revoked can ask for a new one, which emails the Administrator

### 💳 Payment Methods

- ✅ Configurable payment methods (Venmo, Zelle, Cash App, PayPal, Apple Cash, Check, Other)
- ✅ QR code uploads per payment method (PNG/JPEG)
- ✅ Payment methods appear on invoices and share links
- ✅ Copy-to-clipboard for payment handles on the share page

### 📧 Invoicing

- ✅ TipTap WYSIWYG rich-text template editor with inline token pills and slash-command menu (Manage → Invoicing)
- ✅ Template tokens such as `%first_name%`, `%full_name%`, `%billing_year%` and `%household_total%`
- ✅ Send a test email to yourself from the Invoicing tab
- ✅ Email Invoice with three variants (Text only, Text + link, Full invoice); Send Email delivers through Resend from a Cloud Function, and Copy or Open Mail App (`mailto:`) are also available
- ✅ Text Invoice (for members with a phone number) opens the device's SMS composer on iPhone, iPad, Mac and Android, and copies the message elsewhere
- ✅ Invoices to a Primary Member cover the whole Household

### 📋 Review Requests

- ✅ Members can raise a Review Request on a bill from their share link, with a message and an optional proposed correction
- ✅ Manage → Review Requests: status workflow Open → In Review → Resolved / Rejected, with a resolution note
- ✅ The Administrator can attach evidence files (PDF/PNG/JPEG, 20 MB max, up to 10 per request), which the member can view from the share page
- ✅ Members accept or reject a resolution from their share link
- ✅ Manage → Refund Notices: track member confirmations and resolve "not received" reports (re-send, cancel or dismiss)

### 🛡️ Trust & Transparency

- ✅ Change confirmation toasts for financial data mutations
- ✅ Money Integrity Layer: append-only event ledger (`billingEvents`) for financial mutations
- ✅ Payment reversal model (full audit trail preserved); Refunds, Usage Charges and Service Credits are voided by status change, never deleted
- ✅ Trust notes on the share page
- ✅ Archive integrity messaging for historical years

## Quick Start

### Using the App

1. Visit [https://friends-and-family-billing.web.app](https://friends-and-family-billing.web.app)
2. Create an account (then verify your email) or sign in with Google
3. Add Members under Manage → Members, and link Households where people settle together
4. Add bills under Manage → Bills and select the members who share each one
5. Start Settlement on the Dashboard, then send invoices by email or text, or share a link
6. Record payments as they arrive, and close the year once every Household is settled

### For Developers

```bash
# Clone the repository
git clone https://github.com/nathanjohnpayne/friends-and-family-billing.git
cd friends-and-family-billing

# Install dependencies (postinstall also installs functions/ dependencies)
npm install

# Create the local Firebase config (gitignored) and fill in the VITE_FIREBASE_* values.
# Maintainers with 1Password access can run ./scripts/bootstrap.sh instead.
cp .env.example .env.local

# Generate firebase-config.local.js (gitignored), the runtime config bridge index.html loads
node scripts/generate-firebase-config.js

# Dev server with hot module replacement
npm run dev

# Production build (build:react → build:assemble, output in app/)
npm run build

# Tests: Vitest suite + Cloud Functions tests + tracked-file secret scan
npm test

# Playwright end-to-end tests against an E2E-mode build (Chromium)
npm run test:e2e

# Firestore security-rules tests on the emulator (needs Java 21+)
npm run test:rules

# Deploy (requires 1Password CLI + deploy tooling)
npm run deploy             # Hosting + Firestore rules + Storage rules
npm run deploy:functions   # Cloud Functions
npm run deploy:all         # Everything
```

The deploy scripts use `op-firebase-deploy`, and Firebase Hosting runs the configured predeploy hook (`npm run build && node stamp-version.js`) before upload. See [DEPLOYMENT.md](DEPLOYMENT.md) for full setup instructions.

## Technical Details

### Persistence

`BillingYearService` reads the active billing year once when you sign in or switch years, and saves by overwriting the whole year document (`setDoc` without merge, from the `buildSavePayload` allowlist in `src/lib/persistence.js`; see [ADR 0008](docs/adr/0008-react-is-sole-writer-allowlist.md)). Saves go through a serialized `SaveQueue`. There is no live listener on the year document, so two tabs or devices editing the same year are last-writer-wins ([#463](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/463)); reload to pick up changes made elsewhere. Closed and Archived years are never saved. On load, missing fields get defaults and legacy email-template tokens are renamed.

### Images

- Bill logos and payment-method QR codes are stored as base64 data URLs
- Uploaded logos are drawn onto a canvas, scaled to at most 200px on the longer side, and saved as PNG in the billing-year document
- QR codes are kept in the `publicQrCodes` collection; the year document stores only a `hasQrCode` flag
- Without a stored image, logos fall back to Logo.dev and then initials, and avatars fall back to Gravatar (settlement board) and then initials

### Email and Text Delivery

- Email is queued as a document in the Firestore `mailQueue` collection; the `processMailQueue` Cloud Function renders HTML from the message body and sends it through Resend, with a plain-text fallback
- Client-sent email requires a verified sender email, may go only to your own address or a Member's address in your billing years, and is limited to 100 messages per account per 24 hours
- Text invoices use `sms:` deep links; no SMS is sent by the app itself

### Data Structure

Each billing year is one document at `/users/{userId}/billingYears/{yearId}`; `/users/{userId}` holds `activeBillingYear`. Review Requests, Refund Notices and Charge Notices live in the year's `disputes` subcollection, distinguished by kind ([ADR 0002](docs/adr/0002-refunds-reuse-the-requests-substrate.md)). The year document, as written by `buildSavePayload`:

```javascript
{
  label: "2026",
  status: "open",                 // "open" | "settling" | "closed" | "archived"
  createdAt: Timestamp,
  closedAt: Timestamp | null,
  archivedAt: Timestamp | null,
  familyMembers: [
    {
      id: number,
      name: string,
      email: string,
      phone: string,              // E.164 format (e.g. "+14155551212")
      avatar: string,             // base64 data URL (legacy; no upload in the current app)
      paymentReceived: number,    // legacy counter, defaults to 0
      linkedMembers: [number]     // Linked Member IDs (set on the Primary Member)
    }
  ],
  bills: [
    {
      id: number,
      name: string,
      amount: number,             // canonical amount as entered
      billingFrequency: string,   // "monthly" | "annual"
      website: string,
      logo: string,               // base64 data URL
      members: [number]           // member IDs assigned to bill
    }
  ],
  payments: [
    {
      id: string,
      memberId: number,
      amount: number,             // negative for reversals
      receivedAt: string,         // ISO 8601
      note: string,
      method: string,             // "venmo" | "zelle" | "cash" | etc.
      reversed: boolean,          // true if reversed by a later entry
      type: string,               // "reversal" for reversal entries
      reversesPaymentId: string   // original payment ID (reversals only)
    }
  ],
  creditAdjustments: [            // Credit dispositions; outside the payments ledger
    {
      id: string,
      memberId: number,           // the Household's Primary Member
      type: string,               // "refund" | "carry_forward"
      amount: number,
      method: string,             // refunds only
      reason: string,
      status: string,             // "recorded" | "cancelled"
      toYear: string,             // carry_forward only
      createdAt: string           // ISO 8601
    }
  ],
  owedAdjustments: [              // signed modifiers of what a member owes
    {
      id: string,
      memberId: number,
      kind: string,               // "usage_charge" | "service_credit" | "carry_opening"
      amount: number,
      description: string,        // usage_charge
      reason: string,             // service_credit
      billId: number,             // service_credit
      incurredDate: string,
      status: string,             // usage_charge: "deferred" | "billed" | "carried_forward"
                                  // service_credit: "active"; carry_opening: "carried_in"
      chargeNoticeId: string,     // billed usage charges
      createdAt: string           // ISO 8601
    }
  ],
  billingEvents: [                // append-only event ledger
    {
      id: string,
      timestamp: string,          // ISO 8601
      actor: { type, userId },
      eventType: string,          // BILL_CREATED, PAYMENT_RECORDED, REFUND_ISSUED, etc.
      payload: object,
      note: string,
      source: string              // "ui" | "system" | "migration"
    }
  ],
  settings: {
    emailMessage: string,         // plain-text template
    emailMessageDocument: object, // TipTap document for the template
    emailSubject: string,
    paymentLinks: [],             // legacy
    paymentMethods: [             // structured payment methods (QR image stripped; hasQrCode flag kept)
      { id, type, label, enabled, handle, url, phone, email, instructions, name, address, hasQrCode }
    ]
  },
  updatedAt: Timestamp
}
```

## Browser Compatibility

- React 19 SPA with code-split lazy loading, built for modern browsers
- Requires JavaScript enabled
- The Playwright end-to-end suite runs in Chromium
- Canvas API for logo resizing

## Example Use Cases

Shares are computed from each bill's annual total divided by the number of members on it. Dollar amounts are rounded to cents only for display, so a monthly figure × 12 can differ from the annual figure by a few cents.

**T-Mobile Bill ($300/month):**
- Add website: https://t-mobile.com
- Select all 8 members
- Each person pays $37.50/month ($450.00/year)

**Apple One ($37.95/month):**
- Add website: https://apple.com/apple-one
- Select 4 members
- Each person pays $9.49/month ($113.85/year)

## Tips

- Add each bill's website so the logo lookup can find it, or upload a logo
- Keep the invoice template concise, and send yourself a test email after editing it
- Review the settlement board before sending invoices
- Record a Service Credit when a service is canceled or discounted, rather than editing the bill's amount
- Update amounts when prices change
- Add or remove members as the group changes

## Security

- **Firestore Rules:** Owner-only access to `/users/{userId}` and its subcollections; everything not explicitly allowed is denied
- **Share Links:** Each link carries a random 256-bit token; the `shareTokens` and `publicShares` documents are keyed by its SHA-256 hash. Anyone can fetch a `publicShares` document by that hash, but only the owner can list them, and guests may update only the access counters
- **Scopes:** Newly generated links grant `summary:read`, `paymentMethods:read`, `usageCharges:read` and `payments:read`. Links minted before `usageCharges:read` or `payments:read` existed keep their original scopes and omit those sections until they are regenerated; `disputes:create` and `disputes:read` are optional, and `refunds:read` is granted only on Refund Notice confirmation links. The Cloud Functions reject revoked, expired or out-of-scope requests
- **Rate limits:** 10 Review Requests per link per 24 hours, one new-link request per link per 24 hours, and 100 client-sent emails per account per 24 hours
- **Evidence:** Stored in Firebase Storage under the owner's path; owner-only writes, PDF/PNG/JPEG under 20 MB; members view evidence through a short-lived signed URL
- **HTTPS:** All data transmitted securely via Firebase Hosting
- **Password Hashing:** Handled by Firebase Authentication

### Firebase web config hygiene

- Real Firebase config belongs in `.env.local` (gitignored) as `VITE_FIREBASE_*` environment variables; `scripts/generate-firebase-config.js` turns it into the gitignored `firebase-config.local.js` bridge that sets `window.__FIREBASE_CONFIG__`.
- Do not reintroduce CDN compat scripts or `__/firebase/init.js`.
- Firebase Web API keys are not auth secrets, but checking them into public source is still a security concern because it triggers Google abuse alerts and invites quota abuse.
- If a key is exposed: remove it from tracked files/history, create a replacement key in Google Cloud Credentials with the same referrer/API restrictions, update `.env.local`, redeploy Hosting, verify the live build uses the new key only, then delete the old key.
- `npm test` includes a tracked-file secret scan so committed API keys, OAuth tokens, and private keys fail before deployment.

### Deploy auth and future-secret flow

- Deploy maintainers need `firebase-tools`, `gcloud`, and the canonical helper scripts from `../mergepath/scripts/` (see [DEPLOYMENT.md](DEPLOYMENT.md) § First-Time Setup).
- The normal maintainer flow reads the shared `Private/GCP ADC` source credential through the 1Password CLI, so routine deploy work does not need browser login once that item exists.
- The 1Password-first deploy-auth model is intentional for this repo. Do not switch it back to ADC-first or deploy-key-based guidance unless a human explicitly requests that change.
- `op-firebase-setup friends-and-family-billing` creates the deployer service account, grants deploy roles, and grants the current maintainer impersonation rights.
- `npm run deploy`, `npm run deploy:functions`, and `npm run deploy:all` use `op-firebase-deploy`, which creates a temporary impersonated credential for `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com`.
- For future APIs or services, commit only template files such as `.env.tpl` or `config.runtime.tpl` with `op://Private/<item>/<field>` references, then materialize gitignored runtime files with `op inject -i <template> -o <runtime-file> -f`.

## Redesign Wireframes

[`plans/ffb-wireframes.html`](plans/ffb-wireframes.html) is a self-contained wireframe document proposing a full visual and interaction redesign of the app. It draws every screen and its main dialogs at three widths—desktop 1280, tablet 834 and phone 390—lists the remaining dialogs that reuse the same components with different copy, and includes a token legend with computed WCAG contrast, plus numbered Redesign changes, each with a rationale, and a summary table. It adds no app code.

To view it, open the file directly in a browser (there is no build step), or use the rendered copy at [raw.githack.com](https://raw.githack.com/nathanjohnpayne/friends-and-family-billing/main/plans/ffb-wireframes.html). Implementation is tracked in epic [#524](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/524).

## Documentation

- **[AGENTS.md](AGENTS.md)**—AI agent instructions and technical reference
- **[CONTEXT.md](CONTEXT.md)**—Domain glossary (Member, Household, Credit, Refund, Review Request, and more)
- **[docs/adr/](docs/adr/)**—Architecture decision records
- **[specs/](specs/)**—Feature specifications and acceptance criteria
- **[DEPLOYMENT.md](DEPLOYMENT.md)**—Detailed deployment instructions
- **[docs/QUICKSTART.md](docs/QUICKSTART.md)**—Fast 10-minute setup
- **[REVIEW_POLICY.md](REVIEW_POLICY.md)**—Multi-identity code review policy
- **[plans/ffb-wireframes.html](plans/ffb-wireframes.html)**—Redesign wireframes (see [Redesign Wireframes](#redesign-wireframes))

## Troubleshooting

### Data Not Loading

1. Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. Check browser console for errors ("Missing Firebase config" means `firebase-config.local.js` is missing or incomplete)
3. Verify you're logged in
4. Check that `.env.local` has correct Firebase config values, then regenerate `firebase-config.local.js`

### Authentication Issues

1. Check Firebase Console for enabled auth providers
2. Verify authorized domains include deployment URL
3. Clear browser cache
4. Check console for specific error codes

### Email Not Sending

1. Verify your account email (use "Resend verification email" in the banner at the top of the app)
2. Send only to your own address or to a Member's email address
3. Wait if you have hit the daily email limit

### Share Link Not Working

1. Check whether the link has expired or been revoked in Manage Links
2. Generate a new link; members can also request one from the expired link's page

### Payment Calculations

1. Reload the page to re-read the saved year (changes made in another tab or device are not pushed live)
2. Check Payment History for reversed or edited entries
3. Verify Households are linked correctly

## Cost

The app runs on Firebase Hosting, Cloud Firestore, Firebase Storage (Review Request evidence) and Cloud Functions, and sends email through Resend. What it costs depends on your Firebase plan and usage. Resend's free-tier limits are listed in [DEPLOYMENT.md](DEPLOYMENT.md) § Resend Free Tier Limits, and the app itself caps client-sent email at 100 messages per account per 24 hours.

## Changelog

### Redesign Wireframes (2026-10)—#524

- ✅ Added `plans/ffb-wireframes.html`, self-contained wireframes proposing a full visual and interaction redesign: every screen and its main dialogs at desktop 1280, tablet 834 and phone 390, a token legend with computed WCAG contrast, and numbered Redesign changes with rationales and a summary table
- 📋 Implementation tracked in epic [#524](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/524); no app code changes in this entry

### Legacy App Retirement (2026-06) --- #326

- ✅ React is now the sole client; the legacy vanilla-JS app (formerly served at `/site/`) is removed from source, build, hosting, and tests
- ✅ esbuild and the three-step build replaced by a two-step React-only build (`build:react` → `build:assemble`)
- ✅ Still-relevant Cloud Functions coverage consolidated into `tests/functions.test.js`
- ✅ Persistence fix folded in: the billing-year `closedAt` field is now preserved by the full-document save (see ADR 0008)

### TipTap Editor, Check Payment Method, QR Codes (2026-04)

- ✅ TipTap WYSIWYG rich-text editor for invoice templates (TemplateEditor, SubjectEditor)
- ✅ Custom TipTap nodes: inline %token% pills and block /slash_command tokens
- ✅ Check payment method type with name, address, phone fields
- ✅ Bank building icon for Check payment method (branded SVG)
- ✅ QR code uploads per payment method
- ✅ Vitest + React Testing Library and Playwright E2E coverage

### React Migration (2026-03) --- COMPLETE

- ✅ Full rewrite from vanilla JS to React 19 SPA
- ✅ Service-owns-state architecture: BillingYearService + useSyncExternalStore
- ✅ Code-split lazy loading via React.lazy + Suspense
- ✅ Vite build with code-split lazy chunks (~238 KB index + ~400 KB TipTap/InvoicingTab)
- ✅ React Router v7 with SPA fallback rewrites
- ✅ Vitest + React Testing Library test suite
- ✅ Public share page ported to React route (/share)
- ✅ Server-side email delivery via Resend Cloud Function
- ✅ Firebase modular SDK replaces CDN compat libraries
- ✅ React app promoted to primary at `/`; legacy retained at `/site/`

### Billing Frequency & Money Integrity (2026-02)

- ✅ Billing frequency toggle (Monthly ↔ Annual) per bill
- ✅ Canonical amount strategy prevents rounding drift across conversions
- ✅ Money Integrity Layer: append-only event ledger for all financial mutations
- ✅ Payment reversal model (audit-safe deletion preserving full history)
- ✅ Per-bill audit history dialog ("View History")
- ✅ 8 event types tracked: bill CRUD, member assignment, payments, reversals, year lifecycle
- ✅ Frequency-aware calculation breakdowns
- ✅ Automated test suite (subsequently replaced by React tests)

### Annual Billing Experience (2026-02)

- ✅ Billing year lifecycle (Open → Settling → Closed → Archived)
- ✅ Settlement progress bars and group completion messaging
- ✅ Payment confirmation with settlement progress feedback
- ✅ Calculation transparency (expandable per-bill breakdowns)
- ✅ Change confirmation toasts for financial data mutations
- ✅ Trust & privacy banners on share links and main app
- ✅ Payment history timeline with remaining balance
- ✅ Archive integrity messaging
- ✅ Annual billing messaging alignment across all screens
- ✅ Login experience optimized for annual billing context
- ✅ Forgot password flow

### Share Links & Review Requests (2026-01)

- ✅ Token-based share links for member billing summaries
- ✅ Configurable payment methods (Venmo, Zelle, Cash App, PayPal, Apple Cash, Check, Other)
- ✅ Review Request system (originally called "disputes") with evidence uploads
- ✅ Cloud Functions v2 for Review Request submission and evidence access
- ✅ Direct Firestore reads for share link data (via `publicShares` collection)
- ✅ Design tokens system (design-tokens.css)
- ✅ Google Sign-In as primary authentication
- ✅ E.164 phone number support

### Firebase Migration (2025)

- ✅ Multi-user authentication
- ✅ Cloud Firestore storage
- ✅ Firebase Hosting deployment
- ✅ Security rules implementation
- ✅ Cross-device sync

### Original Features

- ✅ Bill and member management
- ✅ Avatar and logo uploads
- ✅ Household linking (Primary and Linked Members)
- ✅ Email invoicing
- ✅ Payment tracking
- ✅ Annual summaries

## License

MIT License - feel free to use this for your own bill-splitting needs!

---

**Built with ❤️ for friends and families who split bills**
