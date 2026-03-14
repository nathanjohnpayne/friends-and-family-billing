# Deployment

> This guide covers deploying the existing project. For **new project setup** (create Firebase project, `firebase init`, first-time credential setup), see `ai_agent_repo_template/DEPLOYMENT.md` in the sibling directory.

## Prerequisites

- [Firebase CLI](https://firebase.google.com/docs/cli) (`firebase-tools`) installed globally
- [1Password CLI](https://developer.1password.com/docs/cli/) (`op`) installed and signed in
- `op-firebase-deploy` script on PATH (see First-Time Setup below)
- Access to the `Private` vault in 1Password: `Private/Firebase Deploy - friends-and-family-billing`

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

All deploys use `op-firebase-deploy` for non-interactive 1Password auth. Never run `firebase deploy` directly.

```bash
# Full deploy (hosting + Firestore rules + Storage rules)
op-firebase-deploy

# Hosting only
op-firebase-deploy --only hosting

# Rules only
op-firebase-deploy --only firestore:rules,storage
```

The script:
1. Reads the service account key from 1Password (`Private/Firebase Deploy - friends-and-family-billing`)
2. Auto-detects the Firebase project from `.firebaserc`
3. Writes the key to a temp file (`umask 077`), sets `GOOGLE_APPLICATION_CREDENTIALS`
4. Runs `firebase deploy --non-interactive`
5. Cleans up credentials on exit

The only interactive step is the 1Password biometric prompt (Touch ID). No `firebase login` or browser prompts needed.

## First-Time Setup

Run once per machine to create the service account key and store it in 1Password:

```bash
op-firebase-setup friends-and-family-billing
```

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

## Secrets Management

- No API keys or secrets are committed to this repository.
- Service account credentials are stored exclusively in 1Password (`Private/Firebase Deploy - friends-and-family-billing`).
- For future secrets, use `op://Private/<item>/<field>` references in committed files and resolve them into gitignored runtime files with `op inject`. Never commit the resolved output.

## Key Rotation

The service account key does not expire. To rotate if compromised:

```bash
op-firebase-setup friends-and-family-billing
```

This generates a new key and updates 1Password automatically.
