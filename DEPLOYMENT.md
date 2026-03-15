# Deployment

> This guide covers deploying the existing project. For **new project setup** (create Firebase project, `firebase init`, first-time auth bootstrap), see `ai_agent_repo_template/DEPLOYMENT.md` in the sibling directory.

## Prerequisites

- [Firebase CLI](https://firebase.google.com/docs/cli) (`firebase-tools`) installed globally
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`) installed
- [1Password CLI](https://developer.1password.com/docs/cli/) (`op`) installed and signed in
- Local `gcloud` wrapper installed on PATH (see First-Time Setup below)
- `op-firebase-deploy` and `op-firebase-setup` on PATH
- Access to the shared 1Password source credential `op://Private/GCP ADC/credential` or another explicit `GOOGLE_APPLICATION_CREDENTIALS` file
- Permission to impersonate `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com`

## Environments

| Environment | Firebase Project | URL |
|-------------|-----------------|-----|
| Production | `friends-and-family-billing` | https://friends-and-family-billing.web.app |

There is no staging environment. All deploys go directly to production.

## Build Process

Firebase Hosting deploys the repository root, but the app bundle is generated from `src/` first.

```bash
# Build the browser bundle locally
npm run build
```

`npm run build` runs esbuild and writes `script.js` and `script.js.map` at the repo root.
During deploys, Firebase also runs the configured hosting predeploy hook: `node stamp-version.js && npm run build`.

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

The script:
1. Auto-detects the Firebase project from `.firebaserc`
2. Reads source credentials from `GOOGLE_APPLICATION_CREDENTIALS`, then `op://Private/GCP ADC/credential`, then `~/.config/gcloud/application_default_credentials.json`
3. Generates a temporary `impersonated_service_account` credential file for `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com`
4. Sets `GOOGLE_APPLICATION_CREDENTIALS` to that temp file and runs `firebase deploy --non-interactive`
5. Cleans up credentials on exit

No browser prompt is needed for routine use once `op://Private/GCP ADC/credential` exists and the 1Password CLI is unlocked.

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

If `op://Private/GCP ADC/credential` does not exist yet, seed it once by running `gcloud auth application-default login`, then copy the resulting `~/.config/gcloud/application_default_credentials.json` into the 1Password item `Private/GCP ADC`, field `credential`.

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

1. Open https://friends-and-family-billing.web.app in an incognito window
2. Create an account or sign in with Google — confirm authentication works
3. Add a bill and split it between family members — confirm calculations render correctly
4. Check browser DevTools → Console for any errors

## CI/CD Integration

No CI/CD pipeline is currently configured. Deploys are manual via `op-firebase-deploy`.

When connecting CI, prefer Workload Identity Federation or another `external_account` credential as the source credential. If CI already exposes `GOOGLE_APPLICATION_CREDENTIALS` pointing at an `external_account` file, `op-firebase-deploy` can reuse it to impersonate the deployer service account.

## Secrets Management

- No API keys or secrets are committed to this repository.
- Deploy auth uses short-lived impersonated credentials derived from a 1Password-backed GCP ADC source credential, another explicit `GOOGLE_APPLICATION_CREDENTIALS` file, or CI-provided external-account credentials.
- For future secrets, use `op://Private/<item>/<field>` references in committed files and resolve them into gitignored runtime files with `op inject`. Never commit the resolved output.

## Auth Maintenance

If day-to-day auth stops working, first make sure the 1Password CLI is signed in and `op://Private/GCP ADC/credential` is readable.

If deploy impersonation breaks because IAM bindings or `gcloud` config drifted, rerun:

```bash
op-firebase-setup friends-and-family-billing
```

If the shared source credential itself needs rotation, refresh it once with `gcloud auth application-default login`, overwrite the `Private/GCP ADC` item with the new `application_default_credentials.json`, and, if desired, align its own quota project with:

```bash
gcloud auth application-default set-quota-project friends-and-family-billing
```
