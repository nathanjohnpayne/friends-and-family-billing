# Deployment Process

All deploys use `op-firebase-deploy` for non-interactive service account impersonation.

```bash
npm run deploy              # hosting + Firestore rules + Storage rules
npm run deploy:functions    # Cloud Functions only
npm run deploy:all          # everything
op-firebase-deploy --only firestore:rules   # any target combo
```

The predeploy hook runs `npm run build && node stamp-version.js` automatically — the three-step build pipeline (`build:react` → `build:legacy` → `build:assemble`) produces the `app/` directory, and `stamp-version.js` writes `version.json` before hosting deploy. The predeploy hook may fail under `op-firebase-deploy` (see DEPLOYMENT.md for the workaround: build locally, strip predeploy, deploy, restore).

See `DEPLOYMENT.md` for the 1Password-backed GCP ADC bootstrap, `gcloud` wrapper install, first-time impersonation setup, Firebase Hosting configuration, and secrets management.

- If credential preflight was run at session start (`scripts/op-preflight.sh --mode all`),
  deploy credentials are already cached in `GOOGLE_APPLICATION_CREDENTIALS`. No additional
  biometric prompt is needed for deployment.
