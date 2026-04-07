# Family Bill Splitter

A cloud-based web application for coordinating and settling annual shared bills among friends and family. Features multi-user authentication, billing year lifecycle management, settlement progress tracking, share links, dispute resolution, and email invoicing.

**🌐 Live Application:** [https://friends-and-family-billing.web.app](https://friends-and-family-billing.web.app)

![Family Bill Splitter](https://img.shields.io/badge/status-live-success)
![Firebase](https://img.shields.io/badge/firebase-hosting-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

### 👥 User Management
- ✅ Email/Password authentication with forgot-password recovery
- ✅ Google Sign-In (primary action)
- ✅ Secure logout
- ✅ Per-user data isolation
- ✅ Cloud sync across devices

### 📅 Billing Year Lifecycle
- ✅ Four lifecycle states: Open → Settling → Closed → Archived
- ✅ Visual lifecycle progress bar on dashboard
- ✅ State-specific UI behavior (editable, collecting, complete, read-only)
- ✅ Year selector with status badges
- ✅ Start new billing year with cloned members/bills
- ✅ Archive years for historical reference

### 👨‍👩‍👧‍👦 Family Member Management
- ✅ Add/edit/delete family members
- ✅ Upload custom avatars (PNG/JPG) with automatic compression to 200x200px
- ✅ Automatic initials generation for members without avatars
- ✅ Email addresses and phone numbers (E.164 format)
- ✅ Parent-child linking for combined invoices
- ✅ Proportional payment distribution for linked members

### 💰 Bill Management
- ✅ Add/edit/delete bills with monthly or annual amounts
- ✅ Billing frequency toggle (Monthly ↔ Annual) per bill
- ✅ Canonical amount strategy prevents rounding drift
- ✅ Upload service logos (PNG/JPG) with compression
- ✅ Website URLs for each service
- ✅ Flexible member selection per bill (checkbox interface)
- ✅ Automatic frequency-aware annual calculation
- ✅ Calculation transparency ("View calculation" expandable breakdowns)

### 📊 Settlement Progress
- ✅ Global settlement progress bar with percentage
- ✅ Group completion messaging ("5 of 8 members settled")
- ✅ Payment status badges: Settled / Partial / Outstanding
- ✅ Completion banner when all balances reach zero
- ✅ Payment confirmation with progress feedback
- ✅ Admin reminder hints for outstanding members

### 🔗 Share Links
- ✅ Token-based billing summaries for individual members (no login required)
- ✅ Configurable scopes (summary, payment links, disputes)
- ✅ Personal settlement callout (outstanding balance or settled confirmation)
- ✅ Personal payment progress bar
- ✅ Trust banner with security messaging

### 💳 Payment Methods
- ✅ Configurable payment methods (Venmo, Zelle, Cash App, PayPal, Apple Cash, Check, Other)
- ✅ QR code uploads per payment method (PNG/JPEG)
- ✅ Payment methods appear on invoices and share links
- ✅ Copy-to-clipboard for payment handles

### 📧 Invoicing & Reporting
- ✅ TipTap WYSIWYG rich-text template editor with inline token pills and slash-command menu
- ✅ Server-side email delivery via Resend (HTML + plain-text fallback)
- ✅ Annual summary with monthly and yearly totals
- ✅ Payment tracking with automatic balance calculation
- ✅ Customizable email templates with token placeholders (%member_name%, %household_total%, etc.)
- ✅ Combined invoices for parent + linked members
- ✅ Payment history timeline with remaining balance

### 🛡️ Trust & Transparency
- ✅ Expandable calculation breakdowns showing per-bill math
- ✅ Change confirmation toasts for all financial data mutations
- ✅ Money Integrity Layer: immutable event ledger for all financial mutations
- ✅ Payment reversal model (no silent deletes — full audit trail preserved)
- ✅ Per-bill audit history ("View History" timeline)
- ✅ Privacy footer on main app and share pages
- ✅ Trust banner on share link pages
- ✅ Archive integrity messaging for historical years

### 📋 Dispute / Review System
- ✅ Members can flag bill items for review via share links
- ✅ Admin dispute management with status workflow (Open → In Review → Resolved/Rejected)
- ✅ Evidence file uploads (PDF/PNG/JPEG, 20MB max)
- ✅ User approval/rejection of resolutions

### 🔧 Data Management
- ✅ Real-time cloud sync across devices
- ✅ Automatic data integrity repair on load
- ✅ Data verification tool (check_data.html)
- ✅ Cloud Firestore persistence with per-user isolation
- ✅ Legacy data migration (flat → year-scoped)

## Quick Start

### For Users

1. Visit [https://friends-and-family-billing.web.app](https://friends-and-family-billing.web.app)
2. Create an account or sign in with Google
3. Add family members with avatars
4. Add monthly bills with logos
5. Assign bills to family members
6. Track payments and send invoices

### For Developers

```bash
# Clone the repository
git clone <repository-url>
cd friends-and-family-billing

# Install dependencies
npm install

# Create a local Firebase config file (gitignored)
# Add VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, etc.
cp .env.example .env.local

# Dev server with hot module replacement
npm run dev

# Production build
npm run build

# Deploy to production (requires 1Password CLI + deploy tooling)
npm run deploy
```

`npm run deploy` uses `op-firebase-deploy`, and Firebase Hosting runs the configured predeploy hook (`npm run build && node stamp-version.js`) before upload. See `DEPLOYMENT.md` for full setup instructions.

### Uploading Images

**Avatars (Family Members):**
- Click the camera icon (📷) next to any family member
- Select a PNG or JPG file
- Image is automatically converted and saved
- Displays as a circle (48x48px)
- If no image: shows initials in a purple circle

**Logos (Bills/Services):**
- Click "Upload Logo" button on any bill
- Select a PNG or JPG file
- Image is automatically converted and saved
- Displays as a rectangle (80x60px)
- If no image: shows service name in a styled box

### Generating Invoices

**Annual Invoice (All Members):**
- Click "Generate Annual Invoice" button at bottom
- Opens new window with complete breakdown
- Click "Print Invoice" to save as PDF
- Includes all avatars and logos

**Individual Invoice (One Member):**
- Click "Email Invoice" next to any family member in summary table
- Invoice opens in new window with that member's bills only
- Click "Print as PDF" button
- Follow instructions to email:
  1. Print/save the page as PDF
  2. Click OK on alert dialog
  3. Email client opens with pre-filled subject and message
  4. Attach the PDF you just saved
  5. Send email

### Email Settings
- Scroll to "Email Settings" section
- Edit the message sent with all invoices
- Message appears in email body and on printed invoices
- Uses member's first name in greeting
- Click "Save Message" to update

## Technical Details

### Image Storage
- Images converted to base64 data URLs via Canvas API
- Compressed to max 200x200px and saved as PNG
- Stored in Cloud Firestore as part of user document
- PNG and JPG upload formats supported

### Image Display
- **Avatars**: 48x48px circles in UI, 32x32px in invoices
- **Logos**: 80x60px rectangles in UI, 40x30px in invoices
- CSS `object-fit` ensures proper scaling
- Fallback: initials for avatars, service name for logos

### Email System
- Uses `mailto:` links to open the user's email client
- Invoices rendered as printable HTML (save as PDF)
- Email pre-filled with subject, greeting, and customizable message
- `%total` placeholder in email message replaced with member's total

### Data Structure

Data is organized per billing year under `/users/{userId}/billingYears/{yearId}`:

```javascript
{
  label: "2026",
  status: "open",                 // "open" | "settling" | "closed" | "archived"
  familyMembers: [
    {
      id: number,
      name: string,
      email: string,
      phone: string,              // E.164 format (e.g. "+14155551212")
      avatar: string,             // base64 data URL
      paymentReceived: number,    // legacy, migrated to payments ledger
      linkedMembers: [number]     // child member IDs
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
      method: string,             // "cash" | "zelle" | "venmo" | etc.
      reversed: boolean,          // true if reversed by a later entry
      type: string,               // "reversal" for reversal entries
      reversesPaymentId: string   // original payment ID (reversals only)
    }
  ],
  billingEvents: [                // append-only event ledger
    {
      id: string,
      timestamp: string,          // ISO 8601
      actor: { type, userId },
      eventType: string,          // BILL_CREATED, PAYMENT_RECORDED, etc.
      payload: object,
      note: string,
      source: string              // "ui" | "system" | "migration"
    }
  ],
  settings: {
    emailMessage: string,
    paymentMethods: [             // structured payment methods
      { id, type, label, enabled, handle, url, phone, email, instructions }
    ]
  }
}
```

## Browser Compatibility
- Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- Requires JavaScript enabled
- React 19 SPA with code-split lazy loading
- Canvas API for image compression

## Example Use Cases

**T-Mobile Bill ($300/month):**
- Upload T-Mobile logo
- Add website: https://t-mobile.com
- Select all 8 family members
- Each person pays $37.50/month ($450/year)

**Apple One ($37.95/month):**
- Upload Apple logo
- Add website: https://apple.com/apple-one
- Select 4 family members
- Each person pays $9.49/month ($113.85/year)

## Tips
- Upload high-quality logos for best print results
- Keep email message concise and professional
- Review summary before generating invoices
- Save invoices as PDFs for record-keeping
- Update amounts when prices change
- Add/remove members as family changes

## Security

- **Firestore Rules:** Per-user data isolation (`/users/{userId}`), public read on `publicShares` (secured by SHA-256 token hashes)
- **HTTPS:** All data transmitted securely via Firebase Hosting
- **Password Hashing:** Handled by Firebase Authentication
- **Share Links:** Cryptographic tokens with SHA-256 hashing; configurable expiry and revocation
- **Image Compression:** Prevents Firestore document size issues
- **No Cross-User Access:** Users can only read/write their own data

### Firebase web config hygiene

- Real Firebase config belongs in `.env.local` (gitignored) as `VITE_FIREBASE_*` environment variables.
- Do not reintroduce CDN compat scripts or `__/firebase/init.js`.
- Firebase Web API keys are not auth secrets, but checking them into public source is still a security concern because it triggers Google abuse alerts and invites quota abuse.
- If a key is exposed: remove it from tracked files/history, create a replacement key in Google Cloud Credentials with the same referrer/API restrictions, update `.env.local`, redeploy Hosting, verify the live build uses the new key only, then delete the old key.
- `npm test` includes a tracked-file secret scan so committed API keys, OAuth tokens, and private keys fail before deployment.

### Deploy auth and future-secret flow

- Deploy maintainers need `firebase-tools`, `gcloud`, and the canonical helper scripts from `../ai_agent_repo_template/scripts/`.
- The normal maintainer flow reads the shared `Private/GCP ADC` source credential through the 1Password CLI, so routine deploy work does not need browser login once that item exists.
- The 1Password-first deploy-auth model is intentional for this repo. Do not switch it back to ADC-first or deploy-key-based guidance unless a human explicitly requests that change.
- `op-firebase-setup friends-and-family-billing` creates the deployer service account, grants deploy roles, and grants the current maintainer impersonation rights.
- `npm run deploy`, `npm run deploy:functions`, and `npm run deploy:all` use `op-firebase-deploy`, which creates a temporary impersonated credential for `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com`.
- For future APIs or services, commit only template files such as `.env.tpl` or `config.runtime.tpl` with `op://Private/<item>/<field>` references, then materialize gitignored runtime files with `op inject -i <template> -o <runtime-file> -f`.

## Documentation

- **[AGENTS.md](AGENTS.md)** - AI agent instructions and technical reference
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Detailed deployment instructions
- **[QUICKSTART.md](docs/QUICKSTART.md)** - Fast 10-minute setup
- **[REVIEW_POLICY.md](REVIEW_POLICY.md)** - Multi-identity code review policy

## Troubleshooting

### Data Not Loading
1. Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. Check browser console for errors
3. Verify you're logged in
4. Check that `.env.local` has correct Firebase config values

### Authentication Issues
1. Check Firebase Console for enabled auth providers
2. Verify authorized domains include deployment URL
3. Clear browser cache
4. Check console for specific error codes

### Payment Calculations
1. Hard refresh the page (data repair runs automatically on load)
2. Re-enter payment amounts
3. Verify linked members are configured correctly

## Cost

### Firebase Free Tier
- 50,000 database reads/day
- 20,000 database writes/day
- 1 GB storage
- 10 GB/month hosting transfer

**Perfect for families!** You'd need thousands of daily users to exceed the free tier.

## Changelog

### TipTap Editor, Check Payment Method, QR Codes (2026-04)
- ✅ TipTap WYSIWYG rich-text editor for invoice templates (TemplateEditor, SubjectEditor)
- ✅ Custom TipTap nodes: inline %token% pills and block /slash_command tokens
- ✅ Check payment method type with name, address, phone fields
- ✅ Bank building icon for Check payment method (branded SVG)
- ✅ QR code uploads per payment method
- ✅ 632 React tests + 288 legacy tests + Playwright E2E

### React Migration (2026-03) --- COMPLETE
- ✅ Full rewrite from vanilla JS to React 19 SPA
- ✅ Service-owns-state architecture: BillingYearService + useSyncExternalStore
- ✅ Code-split lazy loading via React.lazy + Suspense
- ✅ Vite build with ~237 KB main bundle + lazy chunks
- ✅ React Router v7 with SPA fallback rewrites
- ✅ 632 Vitest + React Testing Library tests
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

### Share Links & Disputes (2026-01)
- ✅ Token-based share links for member billing summaries
- ✅ Configurable payment methods (Venmo, Zelle, Cash App, PayPal, Apple Cash, Check, Other)
- ✅ Dispute/review request system with evidence uploads
- ✅ Cloud Functions v2 for dispute submission and evidence management
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
- ✅ Parent-child linking
- ✅ Email invoicing
- ✅ Payment tracking
- ✅ Annual summaries

## License

MIT License - feel free to use this for your own family bill splitting needs!

---

**Built with ❤️ for families who split bills**
