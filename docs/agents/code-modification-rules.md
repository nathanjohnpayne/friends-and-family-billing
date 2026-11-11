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
- Deploy auth is 1Password-only. The reviewed artifact consumer reads one fixed source after verification, the deployer service-account key document `friends-and-family-billing — Firebase Deployer SA Key` in the `Firebase` vault (owner decision 2026-11-10), and passes its private temporary path to the unchanged canonical `op-firebase-deploy`. The temporary file holds a long-lived private key and the adapter attempts to remove it on every exit path the process can handle. A forced kill (`SIGKILL`) cannot be handled: after one, stop any remaining deploy processes and delete any `/tmp/ffb-deploy.*` directory. This adapter accepts no caller GAC, no other key, no `authorized_user` or external-account source and no override; see `DEPLOYMENT.md`.
- The 1Password-first deploy-auth model is a deliberate repository invariant. Do not switch this repo back to ADC-first, routine browser-login or `firebase login` auth, and do not add a second deploy key or another key source, without explicit human approval.
- Routine deploys need nothing but 1Password: no browser or `gcloud` login. Rotating the deployer key is a human-owned operation (create a new key, replace the 1Password document, delete the old key in IAM); an agent never creates, copies or stores that key. If the key is refused or the deployer's roles drift, stop and report the failure; obtain separate human authorization before rerunning `op-firebase-setup friends-and-family-billing` or repairing IAM.

### Resolved Bugs (Historical Context)
1. Duplicate member IDs causing bills to show incorrect member counts
2. Avatar upload failures due to LocalStorage quota limits (resolved by Firebase migration)
3. Black backgrounds on logos from JPEG transparency handling (fixed: PNG compression)
4. Data not loading after refresh (fixed: proper async/await on Firestore reads)
5. Linked member payment math showing incorrect credits (fixed: proportional distribution)

### Security Rules (firestore.rules, storage.rules)
These files control data access for all users. Changes require careful manual testing and human review. Never relax security rules without explicit justification. Owner-only access for user data is an invariant.

