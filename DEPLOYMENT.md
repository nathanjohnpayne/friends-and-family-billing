# Deployment

## New Machine Setup

Run these steps on any new or temporary machine. Tell your AI agent:

> "Set up this machine for development. Run the new machine setup from DEPLOYMENT.md."

### 1. Install system tools

```bash
# 1Password CLI
brew install --cask 1password-cli

# Firebase CLI
npm install -g firebase-tools

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

# Google Cloud — use 1Password-backed ADC (no interactive login needed
# if op is authenticated and the GCP ADC item exists in 1Password)
```

### 3. Install deploy scripts

```bash
# Clone the template repo if not already present
git clone https://github.com/nathanjohnpayne/ai_agent_repo_template.git ~/Documents/GitHub/ai_agent_repo_template

# Install canonical helper scripts
mkdir -p ~/.local/bin
cp ~/Documents/GitHub/ai_agent_repo_template/scripts/gcloud/gcloud ~/.local/bin/
cp ~/Documents/GitHub/ai_agent_repo_template/scripts/firebase/op-firebase-deploy ~/.local/bin/
cp ~/Documents/GitHub/ai_agent_repo_template/scripts/firebase/op-firebase-setup ~/.local/bin/
chmod +x ~/.local/bin/gcloud ~/.local/bin/op-firebase-deploy ~/.local/bin/op-firebase-setup

# Ensure PATH includes ~/.local/bin
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

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

## Prerequisites

- [Firebase CLI](https://firebase.google.com/docs/cli) (`firebase-tools`) installed globally
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`) installed
- [1Password CLI](https://developer.1password.com/docs/cli/) (`op`) installed and signed in
- Local `gcloud` wrapper installed on PATH (see First-Time Setup below)
- `op-firebase-deploy` and `op-firebase-setup` on PATH
- Access to the project SA key in `op://Firebase/friends-and-family-billing — Firebase Deployer SA Key` (preferred for CI/headless) or the shared 1Password source credential `op://Private/c2v6emkwppjzjjaq2bdqk3wnlm/credential`, or another explicit `GOOGLE_APPLICATION_CREDENTIALS` file
- Permission to impersonate `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com` (skipped when using the project SA key directly)

## Machine User Setup (New Project)

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
| `CLAUDE_PAT` | Classic PAT for `nathanpayne-claude` with `repo` scope | **Classic** (not fine-grained) |
| `CODEX_PAT` | Classic PAT for `nathanpayne-codex` with `repo` scope | **Classic** (not fine-grained) |
| `CURSOR_PAT` | Classic PAT for `nathanpayne-cursor` with `repo` scope | **Classic** (not fine-grained) |
| `REVIEWER_ASSIGNMENT_TOKEN` | PAT for `nathanjohnpayne` | Fine-grained OK (owns repo) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude Code headless review | — |
| `OPENAI_API_KEY` | OpenAI API key for Codex headless review | — |

**Why classic PATs?** Machine users are collaborators, not repo owners. Fine-grained
PATs on personal accounts only cover owned repos. See "Token type" section below.

Or use the CLI (faster). Use 1Password item IDs to avoid shell issues with parentheses:

```bash
# Use exact 1Password item IDs (avoids shell issues with parentheses in item titles):
gh secret set CLAUDE_PAT --repo {owner}/{repo} --body "$(op read 'op://Private/pvbq24vl2h6gl7yjclxy2hbote/token')"
gh secret set CURSOR_PAT --repo {owner}/{repo} --body "$(op read 'op://Private/bslrih4spwxgookzfy6zedz5g4/token')"
gh secret set CODEX_PAT --repo {owner}/{repo} --body "$(op read 'op://Private/o6ekjxjjl5gq6rmcneomrjahpu/token')"
gh secret set REVIEWER_ASSIGNMENT_TOKEN --repo {owner}/{repo} --body "$(op read 'op://Private/sm5kopwk6t6p3xmu2igesndzhe/token')"
gh secret set ANTHROPIC_API_KEY --repo {owner}/{repo} --body "$(op read 'op://Private/ey6stbr75px3mx6nzthh6z54o4/credential')"  # Claude API Key (Test/Dev) — generate a project-specific key for long-term use
gh secret set OPENAI_API_KEY --repo {owner}/{repo} --body "$(op read 'op://Private/ooj5vq25ynj5n56mqm7xrmumsq/credential')"  # ChatGPT API Key (Test/Dev) — generate a project-specific key for long-term use
```

### 4. Configure branch protection

Go to the new repo → Settings → Branches → Add branch protection rule for `main`:

1. **Require pull request reviews before merging:** Yes
2. **Required number of approving reviews:** 1
3. **Dismiss stale pull request approvals when new commits are pushed:** Yes
4. **Require status checks to pass before merging:** Yes
   - Add `Self-Review Required`
   - Add `Label Gate`
5. **Do not allow bypassing the above settings:** Disabled (so Nathan can force-merge in emergencies)

Or use the CLI:

```bash
gh api --method PUT "repos/{owner}/{repo}/branches/main/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "Self-Review Required"},
      {"context": "Label Gate"}
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null
}
EOF
```

**Note:** Branch protection requires the repo to be public, or requires GitHub Pro/Team for private repos.

**Known issue (as of 2026-03-25):** The `Self-Review Required` and `Label Gate`
status checks are configured as required but never report. The CI workflows that
should post these statuses (`pr-review-policy.yml`) fail silently when repository
secrets (PATs) are missing or misconfigured. This blocks all merges — every PR
requires either:
- Fixing the CI secrets so status checks report, **or**
- Using the GitHub web UI "Merge without waiting for requirements" bypass checkbox

The `--admin` flag on `gh pr merge` does **not** bypass required status checks
when "Do not allow bypassing the above settings" is partially enabled for checks.
The break-glass hook (`BREAK_GLASS_ADMIN=1`) only bypasses the PreToolUse guard
in Claude Code — it cannot override GitHub's branch protection API.

**To fix:** Ensure all repository secrets listed in step 3 are correctly populated
and that the CI workflow files reference them correctly. Verify by checking
Actions → recent workflow runs for `pr-review-policy.yml` errors.

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
| `nathanpayne-codex` | `o6ekjxjjl5gq6rmcneomrjahpu` | `op read "op://Private/o6ekjxjjl5gq6rmcneomrjahpu/token"` |
| `nathanjohnpayne` | `sm5kopwk6t6p3xmu2igesndzhe` | `op read "op://Private/sm5kopwk6t6p3xmu2igesndzhe/token"` |

Use the item ID (not the item title) to avoid shell issues with parentheses in
1Password item names like `GitHub PAT (pr-review-claude)`.

### Reviewer PAT quick check

Before asking a reviewer identity to approve a PR, verify the token with
`gh api user` and then reuse the same explicit `GH_TOKEN` override for
`gh pr review`:

```bash
GH_TOKEN="$(op read 'op://Private/o6ekjxjjl5gq6rmcneomrjahpu/token')" \
  gh api user --jq '.login'
# expected: nathanpayne-codex

GH_TOKEN="$(op read 'op://Private/o6ekjxjjl5gq6rmcneomrjahpu/token')" \
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

The current PATs are set to never expire. If you ever need to rotate them:

1. Generate new **classic** PATs with `repo` scope for each machine user account
2. Update the tokens in 1Password (field name: `token`)
3. Update `CLAUDE_PAT`, `CODEX_PAT`, `CURSOR_PAT` secrets on every repo
4. Revoke the old tokens
5. Verify agent access still works

The `REVIEWER_ASSIGNMENT_TOKEN` (Nathan's PAT) follows the same rotation process.

---

## Environments

| Environment | Firebase Project | URL |
|-------------|-----------------|-----|
| Production | `friends-and-family-billing` | https://friends-and-family-billing.web.app |

There is no staging environment. All deploys go directly to production.

## Build Process

Firebase Hosting deploys the repository root (`.`). Two apps coexist:

| App | Build command | Output | Served at |
|-----|---------------|--------|-----------|
| Legacy (vanilla JS) | `npm run build:legacy` | `script.js` (repo root) | `/` |
| React SPA | `npm run build:react` | `app/` directory | `/app/` |

```bash
# Build both apps
npm run build
```

`npm run build` runs `build:legacy` (esbuild) then `build:react` (Vite).

### Firebase config (required before build or deploy)

Both apps read Firebase config from `firebase-config.local.js` (gitignored), which
sets `window.__FIREBASE_CONFIG__`. This file **must exist in the repo root** before
building or deploying. Create it from the template:

```bash
cp firebase-config.local.example.js firebase-config.local.js
# Then fill in the real values from Firebase Console → Project Settings → Web app
```

The React app also supports `.env.local` with `VITE_FIREBASE_*` variables (used by
Vite at build time), but the runtime config bridge uses `window.__FIREBASE_CONFIG__`
for compatibility with the legacy app.

### Predeploy hook caveat

The `firebase.json` predeploy hook (`npm run build && node stamp-version.js`) may
fail under `op-firebase-deploy` because the esbuild step in `build:legacy` can't
read stdin in the non-interactive environment. **Workaround:** build locally first,
then deploy with the predeploy hook stripped:

```bash
npm run build && node stamp-version.js
# Then temporarily remove predeploy from firebase.json, deploy, restore it.
# Or use the pattern in the deploy steps below.
```

## Deployment Steps

All deploys use `op-firebase-deploy` for keyless, non-interactive service account impersonation. Never run `firebase deploy` directly.

```bash
# Full deploy (hosting + Firestore rules + Storage rules)
op-firebase-deploy

# Hosting only
op-firebase-deploy --only hosting

# Rules only
op-firebase-deploy --only firestore:rules,storage
```

### If predeploy fails under op-firebase-deploy

The `build:legacy` esbuild step can fail in the non-interactive deploy
environment. Build locally first, then deploy without predeploy:

```bash
npm run build && node stamp-version.js

# Strip predeploy, deploy, restore
cp firebase.json firebase.json.bak
python3 -c "
import json
with open('firebase.json') as f: c = json.load(f)
del c['hosting']['predeploy']
with open('firebase.json', 'w') as f: json.dump(c, f, indent=2); f.write('\n')
"
op-firebase-deploy friends-and-family-billing --only hosting
mv firebase.json.bak firebase.json
```

The script:
1. Uses the Firebase project ID from `firebase.json` or the `--project` flag (`.firebaserc` is gitignored and not present in this repo)
2. Reads source credentials from `GOOGLE_APPLICATION_CREDENTIALS`, then the project SA key from `op://Firebase/friends-and-family-billing — Firebase Deployer SA Key`, then `op://Private/c2v6emkwppjzjjaq2bdqk3wnlm/credential`, then `~/.config/gcloud/application_default_credentials.json`
3. If the source credential is a `service_account` key matching the target deployer SA, uses it directly (no impersonation needed, faster). Otherwise generates a temporary `impersonated_service_account` credential file for `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com`
4. Sets `GOOGLE_APPLICATION_CREDENTIALS` to that temp file and runs `firebase deploy --non-interactive`
5. Cleans up credentials on exit

No browser prompt is needed for routine use once `op://Private/c2v6emkwppjzjjaq2bdqk3wnlm/credential` exists and the 1Password CLI is unlocked.

This 1Password-first source-credential model is a deliberate project decision. Do not replace it with ADC-first day-to-day docs, routine browser-login steps, `firebase login`, or long-lived deploy keys unless a human explicitly asks for that change.

The local `gcloud` wrapper uses the same source-credential precedence, then resolves quota attribution in this order: explicit `--billing-project`, explicit `--project`, the nearest repo `.firebaserc` project, then the active `gcloud` config.

## First-Time Setup

Install the canonical helper scripts from the sibling template repo once per machine:

```bash
mkdir -p ~/.local/bin
cp ../ai_agent_repo_template/scripts/gcloud/gcloud ~/.local/bin/gcloud
cp ../ai_agent_repo_template/scripts/firebase/op-firebase-deploy ~/.local/bin/
cp ../ai_agent_repo_template/scripts/firebase/op-firebase-setup ~/.local/bin/
chmod +x ~/.local/bin/gcloud ~/.local/bin/op-firebase-deploy ~/.local/bin/op-firebase-setup
hash -r
```

Then bootstrap project impersonation:

```bash
op-firebase-setup friends-and-family-billing
```

If `op://Private/c2v6emkwppjzjjaq2bdqk3wnlm/credential` does not exist yet, seed it once by running `gcloud auth application-default login`, then copy the resulting `~/.config/gcloud/application_default_credentials.json` into the 1Password item `Private/GCP ADC`, field `credential`.

`op-firebase-setup` is the legacy script name, but it now performs keyless setup. For this project it:
1. Enables the IAM Credentials API
2. Creates `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com` if needed
3. Grants deploy roles to that service account
4. Grants your current principal `roles/iam.serviceAccountTokenCreator` on the deployer
5. Creates or updates a dedicated `gcloud` configuration named `friends-and-family-billing`, including `billing/quota_project=friends-and-family-billing`

## Rollback Procedure

Firebase Hosting supports instant rollback:

```bash
# List recent releases
firebase hosting:releases:list

# Roll back via CLI
firebase hosting:channel:deploy live --release-id <VERSION_ID>
```

Or use Firebase Console → Hosting → Release History → Roll back.

## Post-Deployment Verification

Verify both apps after each deploy:

### Legacy app (primary)
1. Open https://friends-and-family-billing.web.app/ in an incognito window
2. Sign in — confirm the purple gradient hero and billing controls load
3. Verify data populates (settlement board, members, bills)
4. Check browser DevTools → Console for errors

### React app (secondary)
5. Open https://friends-and-family-billing.web.app/app/ in the same window
6. Confirm it redirects to `/app/dashboard` and data loads
7. Click "Payment History" on any member — confirm the dialog opens
8. Check browser DevTools → Console for errors

### Common deploy issues
- **Blank React app**: `firebase-config.local.js` was not deployed. Ensure it
  exists in the repo root before deploying. It is gitignored so it won't
  appear in `git status`.
- **Legacy app shows "Missing Firebase web config"**: Same cause — the legacy
  app's `firebase-config.js` loads `firebase-config.local.js` at runtime.
- **Predeploy fails**: See "If predeploy fails" section above.

## CI/CD Integration

The repo has GitHub Actions workflows for testing (`test.yml`), review policy enforcement (`pr-review-policy.yml`, `agent-review.yml`), PR auditing (`pr-audit.yml`), and repo linting (`repo_lint.yml`). Deploys are manual via `op-firebase-deploy`.

When connecting CI, prefer Workload Identity Federation or another `external_account` credential as the source credential. If CI already exposes `GOOGLE_APPLICATION_CREDENTIALS` pointing at an `external_account` file, `op-firebase-deploy` can reuse it to impersonate the deployer service account.

### CI/CD & Headless Deploy

For headless environments (Claude Code cloud tasks, GitHub Actions, etc.) where
1Password biometric auth is unavailable, use the project SA key directly:

```bash
# Pull the SA key from 1Password (one-time, requires biometric)
op document get "friends-and-family-billing — Firebase Deployer SA Key" \
  --vault Firebase --out-file ~/firebase-keys/friends-and-family-billing-sa-key.json

# Deploy with the SA key
GOOGLE_APPLICATION_CREDENTIALS=~/firebase-keys/friends-and-family-billing-sa-key.json op-firebase-deploy friends-and-family-billing --only hosting
```

The SA key (`op://Firebase/friends-and-family-billing — Firebase Deployer SA Key`, item ID `edzuvkafretsjow5g6a26m6tza`) is a `service_account` credential for `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com`. When `op-firebase-deploy` detects that the source credential already matches the target deployer SA, it skips impersonation and uses direct auth (faster).

For Claude Code cloud scheduled tasks:
1. Retrieve the key: `op document get "friends-and-family-billing — Firebase Deployer SA Key" --vault Firebase`
2. Copy the JSON contents
3. In the task's cloud environment, add: `FIREBASE_SA_KEY=<paste JSON>`
4. Add a setup script:
   ```bash
   echo "$FIREBASE_SA_KEY" > /tmp/sa-key.json
   export GOOGLE_APPLICATION_CREDENTIALS=/tmp/sa-key.json
   ```

## Secrets Management

- No API keys or secrets are committed to this repository.
- Deploy auth uses short-lived impersonated credentials derived from a 1Password-backed GCP ADC source credential, another explicit `GOOGLE_APPLICATION_CREDENTIALS` file, or CI-provided external-account credentials.
- For future secrets, use `op://Private/<item>/<field>` references in committed files and resolve them into gitignored runtime files with `op inject`. Never commit the resolved output.

### Cloud Functions Secrets

| Secret | Purpose | 1Password Item | `op://` Reference |
|--------|---------|----------------|-------------------|
| `RESEND_API_KEY` | Resend email delivery API key | `Resend API Key` (ID: `kjkuytr4u24wwlkstwmsm5237i`) | `op://Private/kjkuytr4u24wwlkstwmsm5237i/credential` |

Cloud Functions secrets are managed via Firebase:

```bash
# Set or rotate the Resend API key
op read 'op://Private/kjkuytr4u24wwlkstwmsm5237i/credential' | firebase functions:secrets:set RESEND_API_KEY

# Verify the secret exists
firebase functions:secrets:access RESEND_API_KEY
```

Secrets are accessed in Cloud Functions via `defineSecret()` (Firebase Functions v2 params) and are only loaded at runtime for functions that declare them.

## Email Delivery (Resend)

Invoice and dispute resolution emails are sent server-side via [Resend](https://resend.com) through the `sendEmail` Cloud Function.

### Sending Domain

- **Domain:** `mail.nathanpayne.com` (subdomain of `nathanpayne.com`)
- **Sender:** `Friends & Family Billing <billing@mail.nathanpayne.com>`
- **DNS records:** SPF (TXT), DKIM (TXT), MX — configured in Squarespace DNS, verified in Resend dashboard
- **Resend account:** `nathanpayne` at resend.com

### Architecture

```
Client (EmailInvoiceDialog / DisputeDetailDialog / InvoicingTab)
  → queueEmail() writes to Firestore: mailQueue/{docId}
    → { to, subject, body, html?, uid, status: 'pending' }
  → Client listens to the document for status changes

processMailQueue Cloud Function (Firestore trigger)
  → Fires on mailQueue/{docId} creation
  → Validates fields and uid
  → If html field present: uses it directly (trusted path)
  → Otherwise: simpleMarkdownToHtml() converts body to HTML
  → sanitizeHref() blocks non-http(s) protocols, escapes attribute context
  → wrapEmailHtml() wraps in responsive email template
  → Resend API sends HTML + plain-text fallback
  → Updates document: { status: 'sent' } or { status: 'error' }
```

**Trusted HTML path:** The `html` field in mailQueue documents bypasses
`simpleMarkdownToHtml()` and is used as-is. This field must only contain
app-generated HTML from `buildInvoiceTemplateEmailPayload()` (in
`src/lib/invoice.js`). Do not add new producers without reviewing the trust
boundary—pre-rendered HTML is not re-sanitized in the Cloud Function.

### Cloud Function: `processMailQueue`

- **Type:** Firestore-triggered function (`onDocumentCreated`) — no HTTP endpoint, no Cloud Run invoker policy needed
- **Trigger:** New document in `mailQueue/{docId}`
- **Auth:** Firestore security rules enforce that only authenticated users can create queue documents, and only for their own `uid`. The function validates `uid` matches the document.
- **Secret:** `RESEND_API_KEY` (Firebase Functions secret via `defineSecret`)
- **Document schema (input):** `{ to: string, subject: string, body: string, replyTo?: string, uid: string, status: 'pending', createdAt: Timestamp }`
- **Document schema (output):** Updated with `{ status: 'sent', resendId: string, processedAt: Timestamp }` or `{ status: 'error', error: string, processedAt: Timestamp }`
- **Client helper:** `queueEmail()` in `src/lib/mail.js` — writes the document and listens for status changes via `onSnapshot`. Times out after 30 seconds.

### Deploying Functions

```bash
# Deploy all functions (including sendEmail)
op-firebase-deploy --only functions

# Or deploy functions + hosting together
op-firebase-deploy
```

If `op-firebase-deploy` fails, use the gcloud token workaround:

```bash
/opt/homebrew/bin/gcloud auth activate-service-account --key-file=/tmp/sa-key.json
TOKEN=$(/opt/homebrew/bin/gcloud auth print-access-token)
firebase deploy --only functions --project friends-and-family-billing --token "$TOKEN"
```

### Resend Free Tier Limits

| Limit | Value |
|-------|-------|
| Emails per month | 3,000 |
| Emails per day | 100 |

### Rotating the Resend API Key

1. Generate a new key in Resend dashboard → API Keys (scope: "Sending access")
2. Update 1Password item `Resend API Key` (ID: `kjkuytr4u24wwlkstwmsm5237i`), field `credential`
3. Set the new secret: `op read 'op://Private/kjkuytr4u24wwlkstwmsm5237i/credential' | firebase functions:secrets:set RESEND_API_KEY`
4. Redeploy functions: `op-firebase-deploy --only functions`
5. Revoke the old key in Resend dashboard

## Auth Maintenance

For interactive (biometric) environments, ensure the 1Password CLI is signed in and `op://Private/c2v6emkwppjzjjaq2bdqk3wnlm/credential` is readable. For headless environments, the project SA key in `op://Firebase/friends-and-family-billing — Firebase Deployer SA Key` is the primary credential source — set `GOOGLE_APPLICATION_CREDENTIALS` to point at the exported key file.

If deploy impersonation breaks because IAM bindings or `gcloud` config drifted, rerun:

```bash
op-firebase-setup friends-and-family-billing
```

If the shared source credential itself needs rotation, refresh it once with `gcloud auth application-default login`, overwrite the `Private/GCP ADC` item with the new `application_default_credentials.json`, and, if desired, align its own quota project with:

```bash
gcloud auth application-default set-quota-project friends-and-family-billing
```
