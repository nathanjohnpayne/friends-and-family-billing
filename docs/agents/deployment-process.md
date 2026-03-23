# Deployment Process

All deploys use `op-firebase-deploy` for non-interactive service account impersonation.

```bash
npm run deploy              # hosting + Firestore rules + Storage rules
npm run deploy:functions    # Cloud Functions only
npm run deploy:all          # everything
op-firebase-deploy --only firestore:rules   # any target combo
```

The predeploy hook runs `npm run build && node stamp-version.js` automatically — Vite builds `src/` → `app/` and stamps `version.json` before hosting deploy.

See `DEPLOYMENT.md` for the 1Password-backed GCP ADC bootstrap, `gcloud` wrapper install, first-time impersonation setup, Firebase Hosting configuration, and secrets management.
