#!/usr/bin/env python3
"""Trusted post-build verification and explicit-target Firebase deployment.

Stdlib only; executed with -I -S from an external runtime materialized from
current main. Artifact files are inert data, never imports or executable hooks.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import shlex
import unicodedata
import subprocess
import tarfile

REPOSITORY = "nathanjohnpayne/friends-and-family-billing"
PROJECT = "friends-and-family-billing"
WORKFLOW = "build-artifact.yml"
CLI_VERSION = "15.34.2"
SDK_VERSION = "7.4.0"
HELPER_SHA256 = "d9bcfade8ffdac647dd7dbbeab799545749198ba63a3b2a9100d5b3cd7d4fbff"
ADC_URI = "op://Private/c2v6emkwppjzjjaq2bdqk3wnlm/credential"
TARGETS = {"functions": "functions", "hosting": "hosting", "firestore:rules": "firestore-rules", "storage": "storage"}
BANNED = {".npmrc", ".bin", "node_modules", ".git", ".firebaserc"}
FORBIDDEN_KEYS = {"predeploy", "postdeploy", "lifecycleHooks", "extensions", "frameworksBackend", "configDir", "schemaFilePath", "baseImageUri", "command", "args", "dataConnectGraphqlTrigger"}
FUNCTION_FILES = {"index.js", "billing.js", "package.json", "package-lock.json", "functions.yaml"}


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def no_hooks(value):
    if isinstance(value, dict):
        require(not FORBIDDEN_KEYS.intersection(value), "Deployment hooks/frameworks/extensions are forbidden")
        for child in value.values():
            no_hooks(child)
    elif isinstance(value, list):
        for child in value:
            no_hooks(child)


def validate_config(root, target):
    """Validate target-only config and precomputed Functions discovery data."""
    config = strict_json((root / "firebase.json").read_bytes())
    no_hooks(config)
    key = "firestore" if target == "firestore:rules" else target
    require(isinstance(config, dict) and set(config) == {key}, "Config may declare only the selected target")
    value = config[key]
    require(isinstance(value, dict), "Target config must be one object")
    if target == "functions":
        require(value == {"source": "source", "runtime": "nodejs24", "codebase": "default"}, "Unexpected Functions configuration")
        source = root / "source"
        require({p.name for p in source.iterdir()} == FUNCTION_FILES, "Unexpected Functions source files")
        package = strict_json((source / "package.json").read_bytes())
        require(isinstance(package, dict) and package.get("main") == "index.js" and package.get("engines") == {"node": "24"}, "Functions must use index.js/nodejs24")
        require(not package.get("scripts"), "Functions package scripts are forbidden")
        manifest = strict_json((source / "functions.yaml").read_bytes())
        # SDK7.4.0 emits empty extensions plus a declared secret parameter.
        require(isinstance(manifest, dict) and set(manifest) == {"specVersion", "endpoints", "params", "requiredAPIs", "extensions"}, "Unsupported Functions manifest fields")
        require(manifest["extensions"] == {} and manifest["requiredAPIs"] == [], "Extensions/API widening forbidden")
        require(manifest["params"] == [{"type": "secret", "name": "RESEND_API_KEY"}], "Unexpected manifest parameters")
        no_hooks(manifest["endpoints"])
        expected_names = {"resolveShareToken", "requestShareLink", "submitDispute", "getEvidenceUrl", "submitDisputeDecision", "submitRefundConfirmation", "processMailQueue"}
        require(isinstance(manifest.get("endpoints"), dict) and set(manifest["endpoints"]) == expected_names, "Unexpected Functions endpoints")
        require(manifest.get("specVersion") == "v1alpha1", "Unexpected Functions manifest version")
        for name, endpoint in manifest["endpoints"].items():
            reset = {key: None for key in ["availableMemoryMb", "timeoutSeconds", "minInstances", "maxInstances", "ingressSettings", "concurrency", "serviceAccountEmail", "vpc"]}
            expected = {**reset, "platform": "gcfv2", "entryPoint": name, "region": ["us-central1"], "labels": {}}
            if name == "processMailQueue":
                expected.update({"secretEnvironmentVariables": [{"key": "RESEND_API_KEY"}], "eventTrigger": {"eventType": "google.cloud.firestore.document.v1.created", "eventFilters": {"database": "(default)", "namespace": "(default)"}, "eventFilterPathPatterns": {"document": "mailQueue/{docId}"}, "retry": False}})
            else:
                expected["httpsTrigger"] = {}
            require(endpoint == expected, "Unexpected Functions endpoint configuration")
    elif target == "hosting":
        allowed = {"public", "ignore", "redirects", "headers", "rewrites", "cleanUrls", "trailingSlash", "appAssociation", "i18n"}
        require(set(value) <= allowed and value.get("public") == "public", "Unexpected Hosting configuration")
        require((root / "public/index.html").is_file() and (root / "public/firebase-config.local.js").is_file(), "Missing production Hosting output")
        bridge = (root / "public/firebase-config.local.js").read_text()
        require(PROJECT in bridge and "e2e-test" not in bridge, "Wrong project or E2E Hosting config")
    else:
        file = "firestore.rules" if target == "firestore:rules" else "storage.rules"
        require(value == {"rules": file} and (root / file).is_file(), "Unexpected rules configuration")
    return config


def extract_verified(archive, destination, sha, target):
    """Bounded, no-link extraction; exact metadata/hash/target checks before use."""
    require(target in TARGETS, "An explicit supported target is required")
    require(re.fullmatch(r"[0-9a-f]{40}", sha) is not None, "Full source revision required")
    destination = Path(destination)
    require(not destination.exists(), "Staging destination must be fresh")
    with tarfile.open(archive, "r:") as tf:
        members = tf.getmembers()
        require(len(members) <= 20000, "Too many archive entries")
        seen, files, total = set(), {}, 0
        for member in members:
            name = member.name
            parts = PurePosixPath(name).parts
            require(name and not name.startswith("/") and "\\" not in name and "\x00" not in name, "Unsafe archive path")
            require(".." not in parts and "." not in parts and not BANNED.intersection(parts), "Forbidden archive path")
            canonical = unicodedata.normalize("NFC", name).casefold()
            require(name == "/".join(parts) and canonical not in seen, "Duplicate, case/Unicode collision or noncanonical archive path")
            require(not member.pax_headers, "PAX overrides are forbidden")
            require(not any(part.startswith(".env") or part == ".runtimeconfig.json" for part in parts), "Environment files are forbidden")
            require(member.isfile() or member.isdir(), "Archive links/devices are forbidden")
            seen.add(canonical)
            if member.isfile():
                total += member.size
                require(member.size <= 64 * 1024 * 1024 and total <= 512 * 1024 * 1024, "Archive is too large")
                files[name] = member
        require("metadata.json" in files, "Missing artifact metadata")
        require(files["metadata.json"].size <= 4 * 1024 * 1024, "Metadata is too large")
        metadata = strict_json(tf.extractfile(files["metadata.json"]).read())
        require(set(metadata) == {"schema", "repository", "sourceSha", "firebaseCli", "functionsSdk", "files"}, "Unexpected artifact metadata fields")
        require(type(metadata["schema"]) is int and metadata["schema"] == 1 and metadata["repository"] == REPOSITORY and metadata["sourceSha"] == sha, "Artifact identity mismatch")
        require(metadata["firebaseCli"] == CLI_VERSION and metadata["functionsSdk"] == SDK_VERSION, "Artifact tool version mismatch")
        hashes = metadata["files"]
        require(isinstance(hashes, dict) and set(hashes) == set(files) - {"metadata.json"}, "Artifact file allowlist mismatch")
        for name, member in files.items():
            if name != "metadata.json":
                require(name.split("/")[0] in TARGETS.values(), "Unknown target root")
                require(digest(tf.extractfile(member).read()) == hashes[name], "Artifact file digest mismatch")
            require(not any(str(parent) in files for parent in PurePosixPath(name).parents if str(parent) != "."), "Archive file/directory collision")
        destination.mkdir(mode=0o700)
        for name, member in files.items():
            output = destination / name
            output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(tf.extractfile(member).read())
    for selected, directory in TARGETS.items():
        validate_config(destination / directory, selected)
    return destination / TARGETS[target], metadata


def child_environment(home, path):
    """No caller tokens, loader hooks or credential pointers reach children."""
    return {"HOME": str(home), "PATH": path, "LANG": "C.UTF-8"}


def run(argv, env, cwd, capture=True):
    result = subprocess.run(argv, cwd=cwd, env=env, check=True, capture_output=capture, text=capture, timeout=1800)
    return result.stdout if capture else ""


def resolve_tools(repository):
    safe = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    tools = {}
    for name in ["git", "gh", "python3", "node", "firebase", "op"]:
        found = shutil.which(name, path=safe)
        require(found is not None, f"Missing trusted tool: {name}")
        path = Path(found).resolve()
        require(repository not in path.parents, f"Tool resolves into repository: {name}")
        if "node_modules" in path.parts:
            require(name == "firebase" and "/lib/node_modules/firebase-tools/lib/bin/firebase.js" in str(path), "Repository dependency tools forbidden")
        tools[name] = str(path)
    node24 = Path("/opt/homebrew/opt/node@24/bin/node")
    require(node24.is_file(), "Install the trusted Node24 runtime")
    tools["node"] = str(node24.resolve())
    helper = Path.home() / ".local/bin/op-firebase-deploy"
    require(helper.is_file() and digest(helper.read_bytes()) == HELPER_SHA256, "Canonical deploy helper differs from reviewed pin")
    require(repository not in helper.resolve().parents, "Canonical helper resolves into candidate repository")
    tools["helper"] = str(helper.resolve())
    return tools


# Run against the pinned, globally installed CLI. All spawn methods and candidate
# module imports are tripwires; this is also a runtime proof of its no-op build
# and precomputed-manifest discovery path, not an emulated SDK implementation.
DISCOVERY_PROOF = Path(__file__).with_name("check-functions-discovery.cjs").read_text()


def check_discovery(staging, tools, env, cwd, invoke=run):
    validate_config(staging, "functions")
    invoke([tools["node"], "-e", DISCOVERY_PROOF, str(staging / "source"), tools["firebase"]], env, cwd)


def verify_staging(staging, target, hashes):
    staging = Path(staging)
    require(staging.is_dir() and not staging.is_symlink(), "Missing immutable staging")
    actual = {p.relative_to(staging).as_posix(): p for p in staging.rglob("*") if p.is_file()}
    require(set(actual) == set(hashes), "Staging file allowlist changed")
    for name, path in actual.items():
        require(not path.is_symlink() and digest(path.read_bytes()) == hashes[name], "Staging bytes changed")
    require(not any(p.is_symlink() for p in staging.rglob("*")), "Staging link inserted")
    validate_config(staging, target)


def consume_verified(staging, target, tools, work, hashes, invoke=run, acquire=None):
    """Final consumer: reverify -> one fixed ADC read -> unchanged helper.

    Every child receives a neutral HOME, empty external cwd and narrow env.
    Credentials remain outside project/upload trees and are always removed.
    """
    work, staging = Path(work), Path(staging)
    require(target in TARGETS, "Explicit target required")
    cwd = work / "credentialed-cwd"
    cwd.mkdir(mode=0o700)
    home = work / "deploy-home"
    home.mkdir(mode=0o700)
    bin_dir = work / "trusted-bin"
    bin_dir.mkdir(mode=0o700)
    for name in ["node", "op"]:
        (bin_dir / name).symlink_to(tools[name])
    python_wrapper = bin_dir / "python3"
    python_wrapper.write_text('#!/bin/bash -p\nexec ' + shlex.quote(tools["python3"]) + ' -I -S "$@"\n')
    python_wrapper.chmod(0o500)
    env = child_environment(home, str(bin_dir) + ":/usr/bin:/bin")
    temp = work / "credential-tmp"
    temp.mkdir(mode=0o700)
    env["TMPDIR"] = str(temp)
    verify_staging(staging, target, hashes)
    if target == "functions":
        check_discovery(staging, tools, env, cwd, invoke)
    # The launcher repeats the manifest/hash/resolution guard at Firebase's
    # execution boundary, including after the helper's credential checks.
    launch = work / "firebase-launch.json"
    launch.write_text(json.dumps({"staging": str(staging), "target": target, "tools": tools, "hashes": hashes}))
    firebase = bin_dir / "firebase"
    firebase.write_text('#!/bin/bash -p\nexec ' + shlex.quote(tools["python3"]) + ' -I -S ' + shlex.quote(str(Path(__file__).resolve())) + ' --firebase ' + shlex.quote(str(launch)) + ' "$@"\n')
    firebase.chmod(0o500)
    bin_dir.chmod(0o500)
    credential = work / "source-credential.json"
    try:
        fd = os.open(credential, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            if acquire is None:
                subprocess.run([tools["op"], "read", ADC_URI], cwd=cwd, env=child_environment(Path.home(), str(bin_dir) + ":/usr/bin:/bin"), stdout=stream, check=True, timeout=60)
            else:
                acquire([tools["op"], "read", ADC_URI], env, cwd, stream)
        require(credential.stat().st_size <= 65536, "ADC source too large")
        source = strict_json(credential.read_bytes())
        require(isinstance(source, dict) and source.get("type") == "authorized_user", "Expected approved keyless ADC source")
        require(set(source) <= {"type", "client_id", "client_secret", "refresh_token", "quota_project_id", "universe_domain", "account"} and all(isinstance(source.get(k), str) and source[k] for k in ["client_id", "client_secret", "refresh_token"]), "Invalid ADC source shape")
        env["GOOGLE_APPLICATION_CREDENTIALS"] = str(credential)
        invoke([tools["helper"], PROJECT, "--only", target, "--config", str(staging / "firebase.json")], env, cwd, False)
    finally:
        credential.unlink(missing_ok=True)
        shutil.rmtree(temp, ignore_errors=True)


def launch_firebase(payload, argv):
    staging, target, tools = Path(payload["staging"]), payload["target"], payload["tools"]
    verify_staging(staging, target, payload["hashes"])
    # Canonical helper also uses firebase for its harmless project lookup. The
    # final deployment command remains strictly the selected config/target.
    if argv and argv[0] == "deploy":
        require(argv == ["deploy", "--project", PROJECT, "--non-interactive", "--only", target, "--config", str(staging / "firebase.json")], "Unexpected Firebase deployment arguments")
    else:
        require(argv == ["projects:list", "--json"], "Unexpected Firebase command")
    env = child_environment(Path(os.environ["HOME"]), os.environ["PATH"])
    env["GOOGLE_APPLICATION_CREDENTIALS"] = os.environ["GOOGLE_APPLICATION_CREDENTIALS"]
    if target == "functions":
        check_discovery(staging, tools, child_environment(Path(os.environ["HOME"]), os.environ["PATH"]), Path.cwd())
    os.execve(tools["node"], [tools["node"], tools["firebase"], *argv], env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=TARGETS)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--repository-dir", required=True, type=Path)
    parser.add_argument("--work-dir", required=True, type=Path)
    args = parser.parse_args()
    require(re.fullmatch(r"[0-9a-f]{40}", args.sha) is not None, "Use a full source SHA")
    work = args.work_dir
    tools = resolve_tools(args.repository_dir.resolve())
    base = child_environment(work / "home", "/usr/bin:/bin")
    git = [tools["git"], "-C", str(args.repository_dir), "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "credential.helper="]
    git_env = {**base, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0"}
    main_sha = os.environ["FFB_TRUSTED_MAIN"]
    run(git + ["merge-base", "--is-ancestor", args.sha, main_sha], git_env, work)
    require(run([tools["firebase"], "--version"], base, work).strip() == CLI_VERSION, "Wrong global Firebase CLI version")
    gh_env = dict(base)
    for name in ["GH_TOKEN", "GH_CONFIG_DIR"]:
        if os.environ.get(name):
            gh_env[name] = os.environ[name]
    gh_env["GH_PROMPT_DISABLED"] = "1"
    gh = [tools["gh"]]
    pages = run(gh + ["api", "--paginate", "--slurp", f"repos/{REPOSITORY}/actions/workflows/{WORKFLOW}/runs?head_sha={args.sha}&branch=main&per_page=100"], gh_env, work)
    runs = [r for page in strict_json(pages) for r in page["workflow_runs"] if r["head_sha"] == args.sha and r["head_branch"] == "main" and r["event"] in ["push", "workflow_dispatch"] and r["conclusion"] == "success" and r["status"] == "completed"]
    require(runs, "No successful main artifact build for that full SHA")
    selected = max(runs, key=lambda r: r["id"])
    name = "ffb-deploy-" + args.sha
    download = work / "download"
    download.mkdir(mode=0o700)
    run(gh + ["run", "download", str(selected["id"]), "--repo", REPOSITORY, "--name", name, "--dir", str(download)], gh_env, work)
    archive = download / (name + ".tar")
    require({p.name for p in download.iterdir()} == {archive.name, "SHA256SUMS"}, "Unexpected downloaded artifact files")
    require(all(p.is_file() and not p.is_symlink() for p in download.iterdir()), "Downloaded files must be regular")
    expected = digest(archive.read_bytes()) + "  " + archive.name + "\n"
    require((download / "SHA256SUMS").read_text() == expected, "Archive digest/manifest mismatch")
    run(gh + ["attestation", "verify", str(archive), "--repo", REPOSITORY, "--signer-workflow", REPOSITORY + "/.github/workflows/" + WORKFLOW, "--source-ref", "refs/heads/main", "--source-digest", args.sha, "--deny-self-hosted-runners", "--cert-oidc-issuer", "https://token.actions.githubusercontent.com"], gh_env, work)
    staging, metadata = extract_verified(archive, work / "extracted", args.sha, args.target)
    # Source/rules files are byte-bound to git, not merely trusted build outputs.
    source_files = {"functions/source/" + name: "functions/" + name for name in FUNCTION_FILES - {"functions.yaml"}}
    source_files.update({"firestore-rules/firestore.rules": "firestore.rules", "storage/storage.rules": "storage.rules"})
    for output, original in source_files.items():
        require((work / "extracted" / output).read_bytes() == run(git + ["cat-file", "blob", args.sha + ":" + original], git_env, work).encode(), "Packaged source differs from reviewed git source")
    # Only the selected target is copied into the final project/upload tree.
    selected_stage = work / "selected"
    shutil.copytree(staging, selected_stage)
    hashes = {p.relative_to(selected_stage).as_posix(): digest(p.read_bytes()) for p in selected_stage.rglob("*") if p.is_file()}
    staging = selected_stage
    for path in selected_stage.rglob("*"):
        path.chmod(0o500 if path.is_dir() else 0o400)
    selected_stage.chmod(0o500)
    if args.target == "functions":
        check_discovery(staging, tools, base, work)
    if args.verify_only:
        print(json.dumps({"verified": True, "sourceSha": args.sha, "target": args.target, "credentialAcquired": False}))
        return
    # Credential acquisition exists only in the final consuming subprocess.
    consumer_env = child_environment(Path.home(), "/usr/bin:/bin")
    payload = work / "consumer.json"
    payload.write_text(json.dumps({"staging": str(staging), "target": args.target, "tools": tools, "work": str(work), "hashes": hashes}))
    run([tools["python3"], "-I", "-S", str(Path(__file__).resolve()), "--consume", str(payload)], consumer_env, work, False)


if __name__ == "__main__":
    try:
        import sys
        if len(sys.argv) == 6 and sys.argv[1] == "--check-archive":
            extract_verified(sys.argv[2], Path(sys.argv[3]), sys.argv[4], sys.argv[5])
            print("Archive/config verification passed; no credentials acquired.")
        elif len(sys.argv) >= 3 and sys.argv[1] == "--firebase":
            launch_firebase(strict_json(Path(sys.argv[2]).read_bytes()), sys.argv[3:])
        elif len(sys.argv) == 3 and sys.argv[1] == "--consume":
            consume_verified(**strict_json(Path(sys.argv[2]).read_bytes()))
        else:
            main()
    except (ValueError, OSError, subprocess.SubprocessError, json.JSONDecodeError, tarfile.TarError) as error:
        raise SystemExit("Deployment refused: " + str(error))
