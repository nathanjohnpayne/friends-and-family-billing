# Deployment Process

Production artifacts are built in the credential-free GitHub-hosted container in `.github/workflows/build-artifact.yml`. A separate runner attests successful main output. Pull requests publish only build proof, not deployment material. Public Firebase/Logo.dev Actions variables supply real client configuration; production never uses E2E stubs or operator-local ignored config.

From reviewed current main, invoke the trusted entrypoint directly:

```bash
./scripts/deploy-artifact.sh --sha <full-main-revision> --target functions --verify-only
# Only after exact revision/target approval:
./scripts/deploy-artifact.sh --sha <approved-full-main-revision> --target functions
```

Choose exactly one target: `functions`, `hosting`, `firestore:rules`, or `storage`. No default/all target, npm deploy alias or predeploy build is supported. The first #602 rollout is Functions only; later Hosting/rules work retains its own gates.

The adapter verifies repository/revision/workflow provenance, hashes, archive safety, original source and target config before a consuming subprocess reads the fixed 1Password keyless ADC source once. Only that consumer receives deploy auth and invokes the unchanged pinned canonical helper. It does not inherit caller PATs, preflight exports, cached GAC or startup hooks. Source and impersonated ADC files stay private outside upload trees and are cleaned.

Functions uploads attested source plus a precomputed manifest. The trusted CLI packages those bytes without importing candidate code or rebuilding locally; Google performs its remote container build afterward. Missing manifests or resolvable SDKs in source ancestors fail closed. See [DEPLOYMENT.md](../../DEPLOYMENT.md) for exact tool pins, public inputs, authentication, artifact format, verification and failure handling. Never use `op-preflight --mode all` as deployment setup.

Artifact schema 2 explicitly includes the four monetary modules alongside the
original five files; retained schema 1 keeps exactly the original set. Both remain
byte-bound to their source revision. The extracted monetary-module loading proof
runs only in credential-free build/tests; deploy discovery still forbids candidate
imports. Admission does not activate public writers or clear the #629 release gates.
