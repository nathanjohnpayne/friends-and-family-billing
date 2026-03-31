# Code Modification Rules

### High-Risk Zones — Payment and Financial Logic

**These areas require explicit human review before any agent-proposed change is accepted.**

- **`src/lib/calculations.js` — `calculateAnnualSummary()`** — The core bill-splitting formula. Changes affect real financial amounts for all users.
- **`src/lib/BillingYearService.js` — `recordPayment()`** — Creates ledger entries. Must maintain append-only semantics; partial amounts, method validation, proportional distribution, and event emission must all be correct.
- **`src/lib/BillingYearService.js` — `reversePayment()`** — Payments are never physically deleted. This function creates a reversal entry (negative amount) and marks the original as `reversed: true`. Never change this to a physical delete.
- **`src/lib/calculations.js` — `getPaymentTotalForMember()`** — Derives balance from the ledger. If this is wrong, users see incorrect amounts owed.
- **`src/lib/calculations.js` — `calculateSettlementMetrics()`** — Settlement percentage calculation. Changes affect the progress bar and dashboard.
- **`functions/billing.js`** — Shared billing utilities used by Cloud Functions. Changes affect both frontend calculations and server-side validation.

### Payment Reversals (Ledger Immutability)
Payments are never physically deleted. Instead, `deletePaymentEntry()` creates a **reversal**:
1. The original payment is marked `reversed: true`
2. A new entry with `type: "reversal"`, `reversesPaymentId`, and a negative `amount` is appended
3. A `PAYMENT_REVERSED` event is emitted to the billing event ledger

This preserves the full audit trail while correctly adjusting the member's balance. **Do not change this pattern.**

### Credential Hygiene and Rotation
- Real Firebase web config belongs in `.env.local` (gitignored) as `VITE_FIREBASE_*` environment variables. Never commit `.env.local`.
- Firebase Web API keys are not the auth boundary, but committing them to tracked source is still a security concern because public repos trigger abuse alerts and create quota/noise risk.
- If a browser key leaks: remove it from tracked files/history, create a replacement key with the same referrer/API restrictions, update `.env.local`, redeploy Hosting, verify the served config uses the new key only, then delete the old key.
- Deploy auth is keyless and 1Password-backed: `op-firebase-deploy` creates short-lived impersonated credentials from `op://Private/c2v6emkwppjzjjaq2bdqk3wnlm/credential`, another explicit `GOOGLE_APPLICATION_CREDENTIALS` file, or CI-provided external-account credentials.
- The 1Password-first deploy-auth model is a deliberate repository invariant. Do not switch this repo back to ADC-first, routine browser-login, `firebase login`, or long-lived deploy-key auth without explicit human approval.
- Routine deploys and `gcloud` work should not require browser login once the shared 1Password source credential exists. If that credential itself needs rotation, refresh it once and update the 1Password item. If impersonation bindings drift, rerun `op-firebase-setup friends-and-family-billing`.

### Resolved Bugs (Historical Context)
1. Duplicate member IDs causing bills to show incorrect member counts
2. Avatar upload failures due to LocalStorage quota limits (resolved by Firebase migration)
3. Black backgrounds on logos from JPEG transparency handling (fixed: PNG compression)
4. Data not loading after refresh (fixed: proper async/await on Firestore reads)
5. Linked member payment math showing incorrect credits (fixed: proportional distribution)

### Security Rules (firestore.rules, storage.rules)
These files control data access for all users. Changes require careful manual testing and human review. Never relax security rules without explicit justification. Owner-only access for user data is an invariant.

