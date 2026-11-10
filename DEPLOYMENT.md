# Deployment

Production deployment uses the attested artifact from **Build deployment artifact** (`.github/workflows/build-artifact.yml`). Invoke the reviewed entrypoint directly from current `main`; do not invoke it through npm, `bash script`, an arbitrary candidate checkout, or a package lifecycle hook.

There is no staging environment. Every selected target deploys to `friends-and-family-billing`. Obtain the human's approval for the exact revision and target before a production action.

## Build and signing boundary

The GitHub-hosted build runner starts a disposable, pinned Node24 container. Only the clean source checkout and an empty output directory are mounted. Its HOME, npm cache and working directory live in disposable tmpfs; operator homes, preflight caches, credential-manager files and the Docker socket are unavailable. No author/reviewer PAT, deployment credential or Actions signing token is passed to candidate build processes. Checkout does not persist Git credentials.

The build uses two **public Actions variables** configured by the maintainer:

- `PUBLIC_FIREBASE_CONFIG`: JSON with `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, and optional `measurementId`.
- `PUBLIC_LOGODEV_KEY`: the client Logo.dev key.

These public client identifiers are not deployment credentials. They are provided through the Actions variable API, never committed or printed. Production requires project `friends-and-family-billing`; the E2E stub is rejected. CI creates its own temporary `.env.local` and runtime config bridge from those inputs; it does not read an operator's ignored local configuration. Local `npm run build` remains a development check, not deployment material.

CI performs the real React production build, assembly and version stamp. It installs the locked Functions dependencies and generates `functions.yaml` with SDK7.4.0 in the same credential-free container. Declaring the `RESEND_API_KEY` secret is supported; reading its value during discovery is not. The container also exercises the pinned Firebase CLI's manifest discovery with candidate imports and child processes forbidden.

A separate runner, with no checkout or candidate execution, attests the successful main build. Pull requests run the real build and isolation proof but publish only the proof receipt, never an attested deployment artifact. Deployment material is named `ffb-deploy-<full-source-SHA>` and consists of one tar archive and `SHA256SUMS`.

<a id="deployment-steps"></a>

## Verify first, deploy one target

Install trusted global tools separately from this repository: Git, GitHub CLI, Python3 supporting `-I -S`, Node24 at `/opt/homebrew/opt/node@24/bin/node`, Firebase CLI **15.34.2**, 1Password CLI and the canonical `~/.local/bin/op-firebase-deploy`. The entrypoint pins the canonical helper's reviewed bytes. Updating any pin requires review; do not edit the canonical helper in a consumer repository or use an `npx` fallback.

For a successful main artifact at the exact approved revision:

```bash
./scripts/deploy-artifact.sh --sha <full-40-character-main-revision> --target functions --verify-only
```

Verification fetches current main, pins the entrypoint/helper code to that trusted revision, requires the source revision to be its ancestor, selects a successful main workflow run and verifies GitHub provenance. The attestation must bind this repository, full revision, main source ref, expected signer workflow and GitHub-hosted runner. It checks the archive digest, exact per-file allowlist/hashes, bounded safe extraction, target-only configs and the original git bytes for Functions source and rules.

After verification and the human's production authorization, use the same command without `--verify-only`:

```bash
./scripts/deploy-artifact.sh --sha <approved-full-main-revision> --target functions
```

The required target accepts exactly one of `functions`, `hosting`, `firestore:rules`, or `storage`. There is no default, `all`, comma-separated target list, `--except` or arbitrary Firebase argument passthrough. Each command stages only the selected target with a fixed config. A Functions deployment does not publish Hosting or either rules file; approval for Functions does not authorize the other targets.

The first rollout for #602 is **Functions only**. Later Hosting and rules rollout steps retain their own approval and verification gates. This tooling does not authorize new access rules or change either rules file.

## Credential consumer

Only after artifact/config/source verification does an external, isolated Python consuming subprocess read the fixed deployer service-account key once, from the 1Password document `friends-and-family-billing — Firebase Deployer SA Key` in the `Firebase` vault:

```bash
op document get "friends-and-family-billing — Firebase Deployer SA Key" --vault Firebase
```

This is the same model nathanpaynedotcom deploys with, adopted here by owner decision on 2026-11-10. The adapter previously read the shared user ADC (`Private/GCP ADC`), an `authorized_user` credential whose refresh token stops working whenever Google requires interactive re-authentication; a deploy then needed a browser login and a re-seeded 1Password item. The service-account key does not expire that way, so 1Password is the only thing a deploy needs.

The accepted source is a bounded `service_account` JSON key whose `project_id` is `friends-and-family-billing`, whose `client_email` is `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com` and whose `token_uri` is Google's token endpoint. A key for another project or account, an `authorized_user` or external-account source, an unknown or empty field, a caller-supplied credential path or document name, and any source or service-account override are refused before the helper runs. The adapter creates no IAM bindings and changes nothing about who can deploy; anyone who can read that document can deploy, so access to the `Firebase` vault is the deploy permission.

Only the trusted 1Password reader retains the operator HOME for its desktop CLI configuration; helper/Firebase receive a fresh neutral HOME. The subprocess writes the key into a private temporary file outside every project/upload directory and passes its explicit path only to the unchanged canonical helper, which uses a key that belongs to the deployer account directly. The temporary file holds a long-lived private key: it has owner-only permissions and is removed on every exit path, including cancellation. Source/helper/auth errors stop the attempt.

The helper runs from an empty external CWD with isolated Python imports. Firebase receives a neutral HOME, trusted Node24/tool paths and only the explicit temporary key file. Caller PATs, preflight markers, npm/Node/Python startup hooks, cached Firebase login and caller GAC do not cross the boundary. The selected staging hashes and Functions manifest/discovery are checked again before acquisition and at the Firebase launch boundary.

Never use `op-preflight --mode all`/deploy exports, `npm run deploy`, local predeploy hooks, direct `firebase deploy`, or a locally rebuilt candidate as this deployment boundary. Review credentials may be used only by the GitHub download/attestation subprocess; they are not passed to the deployment consumer.

## Functions guarantee and limits

The producer emits artifact metadata schema `2`. Its exact Functions source set
is `index.js`, `billing.js`, `package.json`, `package-lock.json`, `functions.yaml`,
`money.js`, `money.mjs`, `household-money.js` and `household-money.mjs`. The
household wrapper loads `household-money.mjs`, which imports `money.mjs`; the
separate `money.js` wrapper loads `money.mjs`. Further dependencies require
explicit reviewed admission. No caller-supplied list or wildcard registers files.

The trusted consumer also accepts retained schema `1` artifacts with exactly the
original five files (`index.js`, `billing.js`, `package.json`, `package-lock.json`,
`functions.yaml`). Schema/file-set mismatches and unknown schemas fail closed.
Both variants retain the same repository, revision, digest, attestation and tool
checks; every admitted source file except generated `functions.yaml` is compared
with the original git bytes at that full revision, even for other deploy targets.
The declared schema stays bound through the selected-stage copy, credential
consumer and final Firebase launch; a reduced schema 2 tree cannot become schema 1.
Copied files must match the selected target's original attested metadata hashes;
copied bytes never establish replacement expected hashes for later checks.
Compatibility permits a separately approved rollback only while the original
artifact and its provenance remain available; it extends no retention window or
deployment authority. Retention/rebuild policy follow-up remains [#626](https://github.com/nathanjohnpayne/friends-and-family-billing/issues/626).

Inside the credential-free build container, the producer extracts its emitted tar
into a fresh directory and runs `check-functions-modules.cjs` against those bytes.
It proves both Node24 CJS/ESM entrypoints and their required transitive module.
This candidate-loading proof is build/test-only; deployment never invokes it.
Admitting these unused modules does not activate public writers or authorize a
partial financial release, deployment, live report or migration (#629/#636).

Functions deployment uploads **attested source and a precomputed discovery manifest**, not a prebuilt container image. The verified extraction contains no `node_modules`, `.npmrc`, `.bin`, environment files or lifecycle scripts. Node24 SDK resolution is checked against source ancestors/global paths; any resolvable SDK is refused. The pinned CLI's local build is a no-op and its discover step reads the validated manifest instead of importing the candidate Functions module. Missing, changed or unreadable manifests fail closed before discovery fallback.

The trusted CLI re-zips validated source as data. Google then builds the container remotely from that uploaded source. The isolation guarantee covers local build/deploy separation and the attested uploaded source; it makes no claim that the provider's remote build account lacks provider credentials.

## Verification and failures

`npm test` includes the fake-credential archive/config/consumer security suite. The CI build emits an `isolation-proof-<SHA>` receipt after the actual production build and discovery proof. No security test deploys production or reads 1Password. Required application tests/lint and independent review remain required for the final PR head.

If verification fails, stop before acquiring deployment credentials. If acquisition, token validation or deployment fails, report that failure and preserve its non-secret receipt; do not switch identities/auth sources, widen targets, strip hooks ad hoc or rebuild under credentials. Rollback uses a separately approved, previously attested full main revision with the same explicit-target path.

After deployment, verify the selected production behavior and record exact revision, target and result on the owning issue. A merged implementation does not complete #602 until its required Functions deployment is verified.


## Environments

| Environment | Firebase Project | URL |
|-------------|-----------------|-----|
| Production | `friends-and-family-billing` | https://friends-and-family-billing.web.app |

There is no staging environment. All deploys go directly to production.

## Build Process

The production CI packager builds the `app/` directory (`"public": "app"` in the development config), then places those compiled bytes under the artifact’s target-only `hosting/public/` root. The React SPA is the sole client at `/`.

| Step | Build command | Output | Served at |
|------|---------------|--------|-----------|
| 1. React SPA | `npm run build:react` | `app/` directory (Vite) | `/` |
| 2. Assemble | `npm run build:assemble` | generates the config bridge, copies shared assets → `app/` | `/` |

```bash
# Local development check only; production builds use isolated CI
npm run build
```

`npm run build` runs `build:react` (Vite) then `build:assemble` (assembly script).


## Post-Deployment Verification

Verify the app after each deploy:

### React app

1. Open https://friends-and-family-billing.web.app/ in an incognito window
2. Sign in — confirm the dashboard loads with KPIs and settlement board
3. Verify data populates (settlement board, members, bills)
4. Check browser DevTools → Console for errors

### Common deploy issues
- **Blank React app**: `firebase-config.local.js` was not deployed. Ensure it
  exists in the verified CI artifact. CI generates it from the public Actions variables; operator-local ignored files are not deployment inputs.
- **Artifact/config verification fails**: stop before credentials; use the failure handling above. There is no predeploy hook to strip.
- **Rules deployment**: verify the intended allow and deny cases after the separately authorized rules target; owner-only user-data access remains an invariant. This tooling does not relax either rules file.


## Secrets Management

- No API keys or secrets are committed to this repository.
- Deploy auth uses the fixed 1Password deployer service-account key document described above. The temporary key file holds long-lived private-key material and remains outside upload trees.
- For future secrets, use `op://Private/<item>/<field>` references in committed files and resolve them into gitignored runtime files with `op inject`. Never commit the resolved output.

### Cloud Functions Secrets

| Secret | Purpose | 1Password Item | `op://` Reference |
|--------|---------|----------------|-------------------|
| `RESEND_API_KEY` | Resend email delivery API key | `Resend API Key` (ID: `kjkuytr4u24wwlkstwmsm5237i`) | `op://Private/kjkuytr4u24wwlkstwmsm5237i/credential` |

Cloud Functions secrets are managed via Firebase. Setting/rotating a production secret is a separate human-authorized operation; it is never part of the credential-free artifact build. The existing maintainer operation passes the value directly from 1Password to Firebase stdin:

```bash
# Set or rotate the Resend API key
op read 'op://Private/kjkuytr4u24wwlkstwmsm5237i/credential' | firebase functions:secrets:set RESEND_API_KEY

# Verify the secret exists
firebase functions:secrets:get RESEND_API_KEY --project friends-and-family-billing
```

Secrets are accessed in Cloud Functions via `defineSecret()` (Firebase Functions v2 params) and are only loaded at runtime for functions that declare them.

The deployer service account needs `roles/secretmanager.viewer` on this project
so Firebase CLI can validate `defineSecret()` declarations during functions
deploy analysis. If the separately approved Functions deployment fails with
`Permission 'secretmanager.secrets.get' denied` for `RESEND_API_KEY`, stop and report the failure. Obtain separate human authorization before rerunning
`op-firebase-setup friends-and-family-billing` or repairing the role on
`firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com`; the failed deployment does not authorize IAM changes.


## Email Delivery (Resend)

Invoice and dispute resolution emails are sent server-side via [Resend](https://resend.com) through the `processMailQueue` Cloud Function.

### Sending Domain

- **Domain:** `mail.nathanpayne.com` (subdomain of `nathanpayne.com`)
- **Sender:** `Friends & Family Billing <billing@mail.nathanpayne.com>`
- **DNS records:** SPF (TXT), DKIM (TXT), MX — configured in Squarespace DNS, verified in Resend dashboard
- **Resend account:** `nathanpayne` at resend.com

### Architecture

```
Client (EmailInvoiceDialog / DisputeDetailDialog / InvoicingTab / Charge + Refund notices)
  → queueEmail() writes to Firestore: mailQueue/{docId}
    → { to, subject, body, uid, status: 'pending', createdAt }  (rules reject any other field)
  → Client listens to the document for status changes

Cloud Functions (share-page notifications)
  → queueEmailFromFunction() writes mailQueue/{docId} via the Admin SDK
    → same fields plus origin: 'server' (a field clients can never set)

processMailQueue Cloud Function (Firestore trigger)
  → Fires on mailQueue/{docId} creation, claims it (pending → processing)
  → Validates fields and uid
  → Client-enqueued mail only (no origin: 'server'):
      → sender's Firebase Auth email must be verified
      → recipient must be the sender's own email or a household member email
        in the sender's users/{uid}/billingYears/* data
      → per-uid rate limit (transactional counter in mailRateLimits/{uid})
  → simpleMarkdownToHtml() converts body to HTML (always server-side)
  → sanitizeHref() blocks non-http(s) protocols, escapes attribute context
  → wrapEmailHtml() wraps in responsive email template
  → Resend API sends HTML + plain-text fallback (markdownToPlainText(body): markdown syntax and escapes stripped)
  → Updates document: { status: 'sent' } or { status: 'error' }
```

Queue documents cannot carry pre-rendered HTML or a reply-to address; the HTML body is always rendered server-side from the markdown `body`.

### Cloud Function: `processMailQueue`

- **Type:** Firestore-triggered function (`onDocumentCreated`) — no HTTP endpoint, no Cloud Run invoker policy needed
- **Trigger:** New document in `mailQueue/{docId}`
- **Auth:** Firestore security rules enforce that only authenticated users can create queue documents, only for their own `uid`, and only with the plain-field allowlist below. For client-enqueued mail the function additionally requires a verified sender email, restricts the recipient to the sender or their household members, and rate-limits per uid (`mailRateLimits/{uid}`, server-only).
- **Secret:** `RESEND_API_KEY` (Firebase Functions secret via `defineSecret`)
- **Document schema (input):** `{ to: string, subject: string, body: string, uid: string, status: 'pending', createdAt: Timestamp }` (Admin SDK writers also set `origin: 'server'`)
- **Document schema (output):** Updated with `{ status: 'sent', resendId: string, processedAt: Timestamp }` or `{ status: 'error', error: string, processedAt: Timestamp }`
- **Client helper:** `queueEmail()` in `src/lib/mail.js` — writes the document and listens for status changes via `onSnapshot`. Times out after 30 seconds.

### Deploying Functions

Use the exact-revision, explicit `functions` target above. Do not combine it with Hosting/rules or fall back to service-account keys, browser login or a `gcloud` access token. A failure stops the attempt for diagnosis; it does not authorize another authentication source.

### Resend Free Tier Limits

| Limit | Value |
|-------|-------|
| Emails per month | 3,000 |
| Emails per day | 100 |

### Rotating the Resend API Key

1. Generate a new key in Resend dashboard → API Keys (scope: "Sending access")
2. Update 1Password item `Resend API Key` (ID: `kjkuytr4u24wwlkstwmsm5237i`), field `credential`
3. Set the new secret: `op read 'op://Private/kjkuytr4u24wwlkstwmsm5237i/credential' | firebase functions:secrets:set RESEND_API_KEY`
4. Redeploy the separately approved attested Functions revision through `./scripts/deploy-artifact.sh --sha <full-main-revision> --target functions`.
5. Revoke the old key in Resend dashboard


## New Machine Setup

These are development-machine setup steps, not a production artifact build or deployment. Local bootstrap/build output is never deployment material. Run these steps on any new or temporary machine. Tell your AI agent:

> "Set up this machine for development. Run the new machine setup from DEPLOYMENT.md."

### 1. Install system tools

```bash
# 1Password CLI
brew install --cask 1password-cli

# Firebase CLI
brew install node@24
npm install -g firebase-tools@15.34.2

# Google Cloud SDK
brew install google-cloud-sdk

# GitHub CLI
brew install gh
```

### 2. Authenticate

```bash
# 1Password — enables biometric unlock for op CLI
# (Follow the prompts to sign in and enable Touch ID)
op signin

# GitHub CLI
gh auth login

# Google Cloud — deploys read the deployer key document from 1Password
# (vault Firebase); no gcloud or browser login is needed to deploy
```

### 3. Install trusted canonical helpers

```bash
# Clone the template repo if not already present
git clone https://github.com/nathanjohnpayne/mergepath.git ~/Documents/GitHub/mergepath

# Install canonical helper scripts
mkdir -p ~/.local/bin
cp ~/Documents/GitHub/mergepath/scripts/gcloud/gcloud ~/.local/bin/
cp ~/Documents/GitHub/mergepath/scripts/firebase/op-firebase-deploy ~/.local/bin/
cp ~/Documents/GitHub/mergepath/scripts/firebase/op-firebase-setup ~/.local/bin/
chmod +x ~/.local/bin/gcloud ~/.local/bin/op-firebase-deploy ~/.local/bin/op-firebase-setup

# Ensure PATH includes ~/.local/bin
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

The artifact consumer verifies the reviewed canonical deploy-helper hash before use; reinstalling a newer helper requires a separately reviewed pin update.

### 4. Clone and bootstrap all repos

```bash
cd ~/Documents/GitHub

for repo in friends-and-family-billing device-platform-reporting device-source-of-truth swipewatch nathanpaynedotcom overridebroadway; do
  git clone "https://github.com/nathanjohnpayne/$repo.git" 2>/dev/null || (cd "$repo" && git pull)
  cd "$repo"
  ./scripts/bootstrap.sh    # restores .env.local from 1Password via op inject
  cd ..
done
```

The bootstrap script for each repo:
- Resolves `op://` references in `.env.tpl` → writes `.env.local` (via `op inject`)
- Runs `npm install`
- Runs `npm run build` (if applicable)

### 5. Verify

```bash
# Quick check that each repo's local config was restored
for repo in friends-and-family-billing device-platform-reporting device-source-of-truth overridebroadway; do
  echo "=== $repo ==="
  ls ~/Documents/GitHub/$repo/.env* 2>/dev/null || echo "  (no env files expected)"
done
```

---

## Returning to Your Main Machine

When you return from a temporary machine, tell your agent:

> "Sync any changes from this session back. Run the return-to-main workflow from DEPLOYMENT.md."

### 1. On the temporary machine (before leaving)

```bash
cd ~/Documents/GitHub
for repo in friends-and-family-billing device-platform-reporting device-source-of-truth swipewatch nathanpaynedotcom overridebroadway; do
  cd "$repo"
  # Push any local config changes to 1Password
  ./scripts/bootstrap.sh --sync
  # Ensure all code changes are committed and pushed
  git status
  cd ..
done
```

### 2. On the main machine (when you return)

```bash
cd ~/Documents/GitHub
for repo in friends-and-family-billing device-platform-reporting device-source-of-truth swipewatch nathanpaynedotcom overridebroadway; do
  cd "$repo"
  git pull                          # get code changes from the temp machine
  ./scripts/bootstrap.sh --force    # re-resolve .env.tpl from 1Password (latest values)
  cd ..
done
```

The `--force` flag overwrites existing `.env.local` files with freshly resolved
values from 1Password. This ensures you pick up any secrets that were updated
on the temporary machine via `--sync`.

### Conflict resolution

If both machines modified the same 1Password item:
- 1Password keeps the latest write (last-writer-wins)
- The `.env.tpl` templates are in git, so structural changes merge normally
- For true conflicts, compare with `op item get <id>` and resolve manually

---


## Machine User Setup (New Project)

The current [REVIEW_POLICY.md](REVIEW_POLICY.md), registered identities and wrapper/preflight flow govern every review action; the project-bootstrap reference below does not override them or authorize gate bypasses. No review PAT belongs in the isolated artifact build.

When creating a new repository from this template, complete these steps to enable the AI agent cross-review system. All steps are manual (human-only) unless noted.

### 1. Add machine users as collaborators

Go to the new repo → Settings → Collaborators → Invite each:

- `nathanpayne-claude` — Write access
- `nathanpayne-codex` — Write access
- `nathanpayne-cursor` — Write access

### 2. Accept collaborator invitations

Log into each machine user account and accept the invitation:

- https://github.com/notifications (as `nathanpayne-claude`)
- https://github.com/notifications (as `nathanpayne-codex`)
- https://github.com/notifications (as `nathanpayne-cursor`)

Alternatively, use `gh` CLI or the invite URL directly: `https://github.com/{owner}/{repo}/invitations`

**Note:** Fine-grained PATs cannot accept invitations via API. Use the browser or a classic PAT with `repo` scope.

### 3. Store PATs as repository secrets

Go to the new repo → Settings → Secrets and variables → Actions → New repository secret. Add:

| Secret name | Value | PAT type |
|---|---|---|
| `REVIEWER_ASSIGNMENT_TOKEN` | PAT for `nathanjohnpayne` | Fine-grained OK (owns repo) |

Or use the CLI (faster):

```bash
gh secret set REVIEWER_ASSIGNMENT_TOKEN --repo {owner}/{repo} --body "$(op read 'op://Private/sm5kopwk6t6p3xmu2igesndzhe/token')"
```

**Reviewer identity PATs (`nathanpayne-claude`, `nathanpayne-codex`,
`nathanpayne-cursor`) are intentionally NOT stored as repo CI secrets.**
Phase 2 internal self-peer review runs in the agent's own session: the
agent switches its Git identity to its reviewer account with a PAT
read directly from 1Password (`op read 'op://Private/<item-id>/token'`)
and posts the review with that PAT. See REVIEW_POLICY.md § Phase 2 and
each repo's `CLAUDE.md` / `AGENTS.md` for the identity-switch procedure.

**Do NOT add `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `CLAUDE_PAT` /
`CODEX_PAT` / `CURSOR_PAT` as repo secrets.** An earlier iteration of
`agent-review.yml` had an `invoke-reviewer` job that ran the Claude
Code CLI headlessly as a CI-side reviewer; this was the wrong flow
(parallel to the authoring session, stale-API-key failure surface,
duplicate work) and was removed. Phase 2 now lives entirely inside
the authoring agent's session.

### 4. Configure branch protection

Configure the new project's branch protection and required checks from its current `REVIEW_POLICY.md` and `.github/review-policy.yml`. Do not reuse obsolete status names or bypass missing checks; diagnose their workflow/credential failure through the owning review policy.

### 5. Create required labels

The workflows expect these labels to exist. Create them if they don't:

```bash
gh label create "needs-external-review" --color "D93F0B" --description "Blocks merge until external reviewer approves" --repo {owner}/{repo}
gh label create "needs-human-review" --color "B60205" --description "Agent disagreement — requires human review" --repo {owner}/{repo}
gh label create "policy-violation" --color "000000" --description "Review policy violation detected" --repo {owner}/{repo}
gh label create "audit" --color "FBCA04" --description "Weekly PR audit report" --repo {owner}/{repo}
```

### 6. Verify setup

Run these checks after completing the steps above:

```bash
REPO="{owner}/{repo}"

# Check collaborators
echo "=== Collaborators ==="
gh api "repos/$REPO/collaborators" --jq '.[].login'

# Check secrets exist
echo "=== Secrets ==="
gh secret list --repo "$REPO"

# Check branch protection
echo "=== Branch Protection ==="
DEFAULT=$(gh api "repos/$REPO" --jq '.default_branch')
gh api "repos/$REPO/branches/$DEFAULT/protection/required_status_checks" --jq '.checks[].context'

# Check labels
echo "=== Labels ==="
gh label list --repo "$REPO" --search "needs-external-review"
gh label list --repo "$REPO" --search "needs-human-review"
gh label list --repo "$REPO" --search "policy-violation"
```

### Token type: classic PATs required

Machine user reviewer identities (nathanpayne-claude, etc.) are **collaborators**,
not repo owners. GitHub fine-grained PATs on personal accounts only cover repos
owned by the token account — they cannot access collaborator repos. The "All
repositories" scope in fine-grained PATs means all repos the account *owns* (zero
for collaborators), not repos they collaborate on.

**Use classic PATs with `repo` scope for all reviewer identities.** This is stored
in 1Password with the field name `token` (not `credential` or `password`).

1Password item IDs (all classic PATs with `ghp_` prefix, field `token`, vault `Private`):

| Reviewer Identity | 1Password Item ID | `op read` command |
|---|---|---|
| `nathanpayne-claude` | `pvbq24vl2h6gl7yjclxy2hbote` | `op read "op://Private/pvbq24vl2h6gl7yjclxy2hbote/token"` |
| `nathanpayne-cursor` | `bslrih4spwxgookzfy6zedz5g4` | `op read "op://Private/bslrih4spwxgookzfy6zedz5g4/token"` |
| `nathanpayne-codex` | `etak327mpz4drd4byxszfex4vm` | `op read "op://Private/etak327mpz4drd4byxszfex4vm/token"` |
| `nathanjohnpayne` | `sm5kopwk6t6p3xmu2igesndzhe` | `op read "op://Private/sm5kopwk6t6p3xmu2igesndzhe/token"` |

> The item `o6ekjxjjl5gq6rmcneomrjahpu` is **not** in this table on purpose: it is the `nathanpayne-robot` CI service account, which holds no reviewer standing and must never post a review. It was the Codex item until 2026-08-21 — see REVIEW_POLICY.md § PAT lookup table for the hazard note. It changed hands on 2026-08-21 because the robot PAT was created by repurposing the existing Codex item instead of minting a fresh one.

Use the item ID (not the item title) to avoid shell issues with parentheses in
1Password item names like `GitHub PAT (pr-review-claude)`.

### Reviewer PAT quick check

Before asking a reviewer identity to approve a PR, verify the token with
`gh api user` and then reuse the same explicit `GH_TOKEN` override for
`gh pr review`:

```bash
GH_TOKEN="$(op read 'op://Private/etak327mpz4drd4byxszfex4vm/token')" \
  gh api user --jq '.login'
# expected: nathanpayne-codex

GH_TOKEN="$(op read 'op://Private/etak327mpz4drd4byxszfex4vm/token')" \
  gh pr review <PR#> --repo <owner/repo> --approve --body "Review comment"
```

- If `gh auth status` still shows `nathanjohnpayne`, that is okay.
  `GH_TOKEN=...` overrides the ambient login for that command.
- On local interactive machines, the `op read` command itself may trigger the
  1Password biometric prompt even if `op whoami` says you are not signed in.
- `Review Can not approve your own pull request` means the wrong GitHub
  identity is still being used.
- Use the 1Password item ID, not the item title, in `op read`.

### Token rotation (as needed)

If you need to rotate a reviewer identity PAT (`nathanpayne-claude`, `nathanpayne-codex`,
`nathanpayne-cursor`):

1. Generate a new **classic** PAT with `repo` scope for the machine user account
2. Update the `token` field on the corresponding 1Password item
3. Revoke the old token in GitHub
4. Verify agent access still works: `GH_TOKEN="$(op read 'op://Private/<item-id>/token')" gh api user`

Note: reviewer identity PATs are NOT stored as repo CI secrets. They are
read from 1Password per-session by the authoring agent for the in-session
identity switch, so rotation does not require updating any repo secrets.

The `REVIEWER_ASSIGNMENT_TOKEN` repo secret (Nathan's PAT used by the
Agent Review Pipeline workflow) follows a similar process but also
needs a `gh secret set REVIEWER_ASSIGNMENT_TOKEN --repo {owner}/{repo}`
call on every repo after rotating the 1Password item.

---


## First-Time Setup

Install the canonical helper scripts from the sibling template repo once per machine:

```bash
mkdir -p ~/.local/bin
cp ../mergepath/scripts/gcloud/gcloud ~/.local/bin/gcloud
cp ../mergepath/scripts/firebase/op-firebase-deploy ~/.local/bin/
cp ../mergepath/scripts/firebase/op-firebase-setup ~/.local/bin/
chmod +x ~/.local/bin/gcloud ~/.local/bin/op-firebase-deploy ~/.local/bin/op-firebase-setup
hash -r
```

This is a separately authorized, human-owned setup operation: it changes project APIs/IAM. It is not run by the artifact builder or deploy adapter, and a routine deploy does not depend on it: deploys use the deployer key document, not impersonation by the maintainer. Run it only to create the deployer service account and its roles, or to repair them:

```bash
op-firebase-setup friends-and-family-billing
```

Only when the deployer key itself needs initial creation or explicit rotation (never as routine deploy login): create a new key for `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com`, store its JSON as the 1Password document `friends-and-family-billing — Firebase Deployer SA Key` in the `Firebase` vault, and delete the old key in IAM. This is a human-owned operation; it needs an interactive `gcloud` login with IAM rights, and the key file must not be left on disk. The shared `Private/GCP ADC` item is no longer read by this repository's deploys.

`op-firebase-setup` is the legacy script name. It creates no key. For this project it:
1. Enables the IAM Credentials API
2. Creates `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com` if needed
3. Grants deploy roles to that service account:
   - `roles/firebase.admin`
   - `roles/cloudfunctions.admin`
   - `roles/secretmanager.viewer`
   - `roles/iam.serviceAccountUser`
   - `roles/artifactregistry.writer`
   - `roles/run.admin`
4. Grants your current principal `roles/iam.serviceAccountTokenCreator` on the deployer
5. Creates or updates a dedicated `gcloud` configuration named `friends-and-family-billing`, including `billing/quota_project=friends-and-family-billing`

## Auth Maintenance

Routine deployment reads the deployer key document from 1Password through the verified consumer, without browser login, `gcloud` login or caller GAC. The first-time setup section retains the separately authorized, human-owned key creation and rotation process and the existing IAM roles. If the key is refused or a deploy is denied, stop and report the concrete failure; key rotation or IAM repair requires its own authorization and is not an automatic deployment fallback.
