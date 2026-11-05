"""Security seams: archive verification, final consumer and installed CLI.

All credentials are fakes; these tests never build or deploy production code.
"""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("deploy", ROOT / "scripts/deploy-artifact.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
SHA = "a" * 40


def manifest():
    names = ["resolveShareToken", "requestShareLink", "submitDispute", "getEvidenceUrl", "submitDisputeDecision", "submitRefundConfirmation", "processMailQueue"]
    endpoints = {}
    for name in names:
        endpoint = {key: None for key in ["availableMemoryMb", "timeoutSeconds", "minInstances", "maxInstances", "ingressSettings", "concurrency", "serviceAccountEmail", "vpc"]}
        endpoint.update({"platform": "gcfv2", "entryPoint": name, "region": ["us-central1"], "labels": {}})
        if name == "processMailQueue":
            endpoint.update({"secretEnvironmentVariables": [{"key": "RESEND_API_KEY"}], "eventTrigger": {"eventType": "google.cloud.firestore.document.v1.created", "eventFilters": {"database": "(default)", "namespace": "(default)"}, "eventFilterPathPatterns": {"document": "mailQueue/{docId}"}, "retry": False}})
        else:
            endpoint["httpsTrigger"] = {}
        endpoints[name] = endpoint
    return {"specVersion": "v1alpha1", "endpoints": endpoints, "params": [{"type": "secret", "name": "RESEND_API_KEY"}], "extensions": {}, "requiredAPIs": []}


def fixture():
    files = {
        "functions/firebase.json": {"functions": {"source": "source", "runtime": "nodejs24", "codebase": "default"}},
        "functions/source/package.json": {"main": "index.js", "engines": {"node": "24"}},
        "functions/source/package-lock.json": {},
        "functions/source/functions.yaml": manifest(),
        "functions/source/index.js": "throw Error('CANDIDATE EXECUTED');",
        "functions/source/billing.js": "throw Error('CANDIDATE EXECUTED');",
        "hosting/firebase.json": {"hosting": {"public": "public"}},
        "hosting/public/index.html": "<html>production</html>",
        "hosting/public/firebase-config.local.js": 'window.__FIREBASE_CONFIG__ = {projectId: "friends-and-family-billing"};',
        "firestore-rules/firebase.json": {"firestore": {"rules": "firestore.rules"}},
        "firestore-rules/firestore.rules": "rules_version = '2';",
        "storage/firebase.json": {"storage": {"rules": "storage.rules"}},
        "storage/storage.rules": "rules_version = '2';",
    }
    return {key: (json.dumps(value) if isinstance(value, dict) else value).encode() for key, value in files.items()}


def archive(path, changes=None, extra=None, metadata_changes=None):
    files = fixture()
    files.update(changes or {})
    metadata = {"schema": 1, "repository": deploy.REPOSITORY, "sourceSha": SHA, "firebaseCli": "15.34.2", "functionsSdk": "7.4.0", "files": {k: deploy.digest(v) for k, v in files.items()}}
    metadata.update(metadata_changes or {})
    files["metadata.json"] = json.dumps(metadata).encode()
    with tarfile.open(path, "w", format=tarfile.USTAR_FORMAT) as tf:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            tf.addfile(member, io.BytesIO(data))
        if extra:
            tf.addfile(extra, io.BytesIO(b""))


class ArtifactBoundary(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = Path(self.tmp.name)
        self.tar = self.work / "artifact.tar"

    def tearDown(self):
        self.tmp.cleanup()

    def verify(self, **kwargs):
        archive(self.tar, **kwargs)
        return deploy.extract_verified(self.tar, self.work / "staging", SHA, "functions")

    def test_valid_all_targets_produce_only_data_and_preserve_exact_source(self):
        staging, _ = self.verify()
        self.assertEqual((staging / "source/index.js").read_text(), "throw Error('CANDIDATE EXECUTED');")
        self.assertFalse((staging / "source/node_modules").exists())

    def test_adversarial_archive_paths_and_links_are_refused(self):
        for name, kind in [("../outside", tarfile.REGTYPE), ("/outside", tarfile.REGTYPE), ("functions/source/link", tarfile.SYMTYPE), ("functions/source/index.js", tarfile.REGTYPE), ("functions/source/INDEX.js", tarfile.REGTYPE), ("functions/source/.env", tarfile.REGTYPE), ("functions/source/node_modules/x", tarfile.REGTYPE)]:
            with self.subTest(name=name):
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = "../../outside"
                archive(self.tar, extra=member)
                with self.assertRaises(ValueError):
                    deploy.extract_verified(self.tar, self.work / "staging", SHA, "functions")

    def test_identity_and_strict_json_fail_closed(self):
        for change in [{"schema": True}, {"sourceSha": "b" * 40}, {"repository": "other/repo"}, {"files": {}}]:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    self.verify(metadata_changes=change)
        with self.assertRaisesRegex(ValueError, "Duplicate JSON"):
            deploy.strict_json('{"functions":{},"functions":{}}')

    def test_hooks_widened_targets_and_manifest_file_reads_are_refused(self):
        cases = [
            {"functions/firebase.json": b'{"functions":{"source":"source","runtime":"nodejs24","codebase":"default","predeploy":["evil"]}}'},
            {"functions/firebase.json": b'{"functions":{"source":"source","runtime":"nodejs24","codebase":"default"},"hosting":{}}'},
            {"functions/source/functions.yaml": b'{"specVersion":"v1alpha1","endpoints":{"x":{"platform":"gcfv2","entryPoint":"x","dataConnectGraphqlTrigger":{"schemaFilePath":"/secret"}}}}'},
            {"functions/source/functions.yaml": b'{"specVersion":"v1alpha1","endpoints":{"x":{"platform":"gcfv2","entryPoint":"x"}},"lifecycleHooks":{}}'},
        ]
        for i, changes in enumerate(cases):
            with self.subTest(case=i):
                archive(self.tar, changes)
                with self.assertRaises(ValueError):
                    deploy.extract_verified(self.tar, self.work / str(i), SHA, "functions")

    def test_final_recheck_refuses_deleted_manifest_before_fake_credential(self):
        staging, _ = self.verify()
        hashes = {p.relative_to(staging).as_posix(): deploy.digest(p.read_bytes()) for p in staging.rglob('*') if p.is_file()}
        (staging / "source/functions.yaml").unlink()
        calls = []
        with self.assertRaises(ValueError):
            deploy.consume_verified(staging, "functions", {"node": "/fake/node", "op": "/fake/op", "python3": "/fake/python"}, self.work, hashes, acquire=lambda *args: calls.append("acquire"))
        self.assertEqual(calls, [])

    def test_exactly_one_fake_read_then_deploy_with_private_external_credentials(self):
        staging, _ = self.verify()
        # Use Hosting to exercise the consumer without requiring installed tools.
        staging = staging.parent / "hosting"
        hashes = {p.relative_to(staging).as_posix(): deploy.digest(p.read_bytes()) for p in staging.rglob('*') if p.is_file()}
        calls = []
        def acquire(argv, env, cwd, stream):
            calls.append("acquire")
            self.assertEqual(argv, ["/fake/op", "read", deploy.ADC_URI])
            self.assertFalse(list(cwd.iterdir()))
            stream.write('{"type":"authorized_user","client_id":"fake","client_secret":"fake","refresh_token":"fake"}')
        def invoke(argv, env, cwd, capture):
            calls.append("deploy")
            self.assertEqual(argv[1:4], [deploy.PROJECT, "--only", "hosting"])
            self.assertEqual(set(env), {"HOME", "PATH", "LANG", "TMPDIR", "GOOGLE_APPLICATION_CREDENTIALS"})
            credential = Path(env["GOOGLE_APPLICATION_CREDENTIALS"])
            self.assertNotIn(staging, credential.parents)
            self.assertEqual(credential.stat().st_mode & 0o777, 0o600)
            self.assertEqual(Path(env["HOME"]), self.work / "deploy-home")
        with mock.patch.dict(os.environ, {"GH_TOKEN": "canary", "GOOGLE_APPLICATION_CREDENTIALS": "/hostile", "NODE_OPTIONS": "--require=/hostile", "PYTHONPATH": "/hostile"}):
            deploy.consume_verified(staging, "hosting", {"node": "/fake/node", "op": "/fake/op", "python3": "/fake/python", "helper": "/trusted/helper"}, self.work, hashes, invoke, acquire)
        self.assertEqual(calls, ["acquire", "deploy"])
        self.assertFalse((self.work / "source-credential.json").exists())
        self.assertFalse((self.work / "credential-tmp").exists())

    def test_real_pinned_cli_discovers_manifest_without_candidate_import_or_spawn(self):
        node = Path('/opt/homebrew/opt/node@24/bin/node')
        cli = Path('/opt/homebrew/lib/node_modules/firebase-tools/lib/bin/firebase.js')
        if not node.exists() or not cli.exists():
            self.skipTest('Runtime delegate proof runs on the configured deployment host')
        staging, _ = self.verify()
        home = self.work / 'neutral-home'
        home.mkdir()
        tools = {"node": str(node), "firebase": str(cli)}
        deploy.check_discovery(staging, tools, deploy.child_environment(home, '/usr/bin:/bin'), self.work)
        ancestor_sdk = self.work / 'node_modules/firebase-functions'
        ancestor_sdk.mkdir(parents=True)
        (ancestor_sdk / 'package.json').write_text('{"name":"firebase-functions","version":"7.4.0","main":"index.js"}')
        (ancestor_sdk / 'index.js').write_text("throw Error('SDK IMPORTED');")
        with self.assertRaises(subprocess.CalledProcessError):
            deploy.check_discovery(staging, tools, deploy.child_environment(home, '/usr/bin:/bin'), self.work)


if __name__ == '__main__':
    from unittest import mock
    unittest.main()
