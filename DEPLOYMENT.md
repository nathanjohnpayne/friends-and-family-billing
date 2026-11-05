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

Only after artifact/config/source verification does an external, isolated Python consuming subprocess read the fixed approved keyless ADC source once:

`op://Private/c2v6emkwppjzjjaq2bdqk3wnlm/credential`

The accepted source is bounded `authorized_user` JSON for the existing service-account impersonation model. External-account/executable sources, service-account keys, caller-supplied credential paths/source URIs and source/service-account overrides are not accepted by this adapter. This preserves the repository's 1Password-first authentication model; it does not create IAM bindings or change who can deploy.

The subprocess writes the source into a private temporary file outside every project/upload directory and passes its explicit path only to the unchanged canonical helper. That helper validates the source token and constructs `impersonated_service_account` ADC for `firebase-deployer@friends-and-family-billing.iam.gserviceaccount.com`. The temporary impersonated ADC embeds the refresh-capable source credential; both files require the same private storage and cleanup. They are not merely short-lived access tokens. Source/helper/auth errors stop the attempt; there is no automatic fallback, refresh or retry.

The helper runs from an empty external CWD with isolated Python imports. Firebase receives a neutral HOME, trusted Node24/tool paths and only the explicit temporary ADC. Caller PATs, preflight markers, npm/Node/Python startup hooks, cached Firebase login and caller GAC do not cross the boundary. The selected staging hashes and Functions manifest/discovery are checked again before acquisition and at the Firebase launch boundary.

Never use `op-preflight --mode all`/deploy exports, `npm run deploy`, local predeploy hooks, direct `firebase deploy`, or a locally rebuilt candidate as this deployment boundary. Review credentials may be used only by the GitHub download/attestation subprocess; they are not passed to the deployment consumer.

## Functions guarantee and limits

Functions deployment uploads **attested source and a precomputed discovery manifest**, not a prebuilt container image. The verified extraction contains no `node_modules`, `.npmrc`, `.bin`, environment files or lifecycle scripts. Node24 SDK resolution is checked against source ancestors/global paths; any resolvable SDK is refused. The pinned CLI's local build is a no-op and its discover step reads the validated manifest instead of importing the candidate Functions module. Missing, changed or unreadable manifests fail closed before discovery fallback.

The trusted CLI re-zips validated source as data. Google then builds the container remotely from that uploaded source. The isolation guarantee covers local build/deploy separation and the attested uploaded source; it makes no claim that the provider's remote build account lacks provider credentials.

## Verification and failures

`npm test` includes the fake-credential archive/config/consumer security suite. The CI build emits an `isolation-proof-<SHA>` receipt after the actual production build and discovery proof. No security test deploys production or reads 1Password. Required application tests/lint and independent review remain required for the final PR head.

If verification fails, stop before acquiring deployment credentials. If acquisition, token validation or deployment fails, report that failure and preserve its non-secret receipt; do not switch identities/auth sources, widen targets, strip hooks ad hoc or rebuild under credentials. Rollback uses a separately approved, previously attested full main revision with the same explicit-target path.

After deployment, verify the selected production behavior and record exact revision, target and result on the owning issue. A merged implementation does not complete #602 until its required Functions deployment is verified.
