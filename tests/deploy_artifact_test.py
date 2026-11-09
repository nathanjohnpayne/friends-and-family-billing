"""Security seams: archive verification, final consumer and installed CLI.

All credentials are fakes; these tests never build or deploy production code.
"""
import importlib.util
import io
import json
import os
import signal
import shutil
import sys
import time
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


MONEY_FILES = ("money.js", "money.mjs", "household-money.js", "household-money.mjs")


def fixture(schema=1):
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
    result = {key: (json.dumps(value) if isinstance(value, dict) else value).encode() for key, value in files.items()}
    if schema == 2:
        result.update({"functions/source/" + name: (ROOT / "functions" / name).read_bytes() for name in MONEY_FILES})
    return result


def archive(path, changes=None, extra=None, metadata_changes=None, schema=1, removed=()):
    files = fixture(schema)
    files.update(changes or {})
    for name in removed:
        del files[name]
    metadata = {"schema": schema, "repository": deploy.REPOSITORY, "sourceSha": SHA, "firebaseCli": "15.34.2", "functionsSdk": "7.4.0", "files": {k: deploy.digest(v) for k, v in files.items()}}
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

    def test_closed_legacy_and_current_variants_for_every_target(self):
        for schema in [1, 2]:
            for target in deploy.TARGETS:
                with self.subTest(schema=schema, target=target):
                    archive(self.tar, schema=schema)
                    dest = self.work / (str(schema) + target.replace(':', '-'))
                    _, metadata = deploy.extract_verified(self.tar, dest, SHA, target)
                    self.assertEqual(metadata['schema'], schema)
                    for name in MONEY_FILES:
                        packaged = dest / 'functions/source' / name
                        self.assertEqual(packaged.exists(), schema == 2)
                        if schema == 2:
                            self.assertEqual(packaged.read_bytes(), (ROOT / 'functions' / name).read_bytes())

    def test_unsupported_and_crossed_variants_fail_closed(self):
        for i, (schema, metadata) in enumerate([(1, {'schema': 2}), (2, {'schema': 1}),
                (1, {'schema': True}), (2, {'schema': 2.0}), (2, {'schema': 3}), (2, {'schema': '2'})]):
            with self.subTest(schema=schema, metadata=metadata):
                archive(self.tar, schema=schema, metadata_changes=metadata)
                with self.assertRaises(ValueError):
                    deploy.extract_verified(self.tar, self.work / str(i), SHA, 'functions')

    def test_missing_extra_and_digest_modified_modules_fail_for_unselected_target(self):
        cases = [{'removed': ['functions/source/' + name]} for name in MONEY_FILES]
        cases.append({'changes': {'functions/source/unregistered.mjs': b'export {};'}})
        hashes = {name: deploy.digest(data) for name, data in fixture(2).items()}
        cases += [{'changes': {'functions/source/' + name: b'changed'}, 'metadata_changes': {'files': hashes}} for name in MONEY_FILES]
        for i, case in enumerate(cases):
            with self.subTest(case=i):
                archive(self.tar, schema=2, **case)
                with self.assertRaises(ValueError):
                    deploy.extract_verified(self.tar, self.work / str(i), SHA, 'hosting')

    def test_staged_monetary_drop_add_and_modification_precede_credential_read(self):
        for i, (name, action) in enumerate([(name, action) for name in MONEY_FILES for action in ['drop', 'modify']] + [('extra.mjs', 'add')]):
            with self.subTest(name=name, action=action):
                work = self.work / str(i)
                work.mkdir()
                archive(self.tar, schema=2)
                staging, _ = deploy.extract_verified(self.tar, work / 'extracted', SHA, 'functions')
                hashes = {p.relative_to(staging).as_posix(): deploy.digest(p.read_bytes()) for p in staging.rglob('*') if p.is_file()}
                file = staging / 'source' / name
                if action == 'drop':
                    file.unlink()
                else:
                    file.write_text('changed')
                calls = []
                with self.assertRaises(ValueError):
                    deploy.consume_verified(staging, 'functions', {'node': '/fake/node', 'op': '/fake/op', 'python3': '/fake/python'}, work, hashes, acquire=lambda *args: calls.append('read'))
                self.assertEqual(calls, [])

    def test_main_binds_every_variant_source_byte_before_consumer_for_every_target(self):
        cases = [(1, 'functions', None), (2, 'functions', None)]
        cases += [(2, target, name) for target in deploy.TARGETS for name in MONEY_FILES]
        for i, (schema, target, changed) in enumerate(cases):
            with self.subTest(schema=schema, target=target, changed=changed):
                work = self.work / str(i)
                work.mkdir()
                originals = fixture(schema)
                reads = set()
                def read_blob(argv, **_kwargs):
                    self.assertTrue(argv[-1].startswith(SHA + ':'))
                    name = argv[-1].split(':', 1)[1]
                    reads.add(name)
                    if name == 'firebase.json':
                        return b'{"hosting":{"public":"public"}}'
                    path = name.replace('functions/', 'functions/source/', 1) if name.startswith('functions/') else {'firestore.rules': 'firestore-rules/firestore.rules', 'storage.rules': 'storage/storage.rules'}[name]
                    return originals[path]
                def external(argv, *_args):
                    if 'merge-base' in argv:
                        return ''
                    if '-p' in argv:
                        return '24'
                    if '--version' in argv:
                        return '15.34.2'
                    if 'api' in argv:
                        return json.dumps([{'workflow_runs': [{'id': 1, 'head_sha': SHA, 'head_branch': 'main', 'event': 'push', 'conclusion': 'success', 'status': 'completed'}]}])
                    if 'download' in argv:
                        name = 'ffb-deploy-' + SHA + '.tar'
                        tar = Path(argv[-1]) / name
                        archive(tar, schema=schema, changes={'functions/source/' + changed: b'changed but correctly rehashed'} if changed else None)
                        (tar.parent / 'SHA256SUMS').write_text(deploy.digest(tar.read_bytes()) + '  ' + name + '\n')
                        return ''
                    if 'attestation' in argv:
                        return ''
                    raise AssertionError(argv)
                args = ['deployer', '--sha', SHA, '--target', target, '--repository-dir', str(work), '--work-dir', str(work)]
                with mock.patch.object(sys, 'argv', args), mock.patch.dict(os.environ, {'FFB_TRUSTED_MAIN': SHA}), mock.patch.object(deploy, 'resolve_tools', return_value={name: '/trusted/' + name for name in ['git', 'node', 'firebase', 'gh']}), mock.patch.object(deploy, 'run', side_effect=external), mock.patch.object(deploy.subprocess, 'check_output', side_effect=read_blob), mock.patch.object(deploy, 'check_discovery'), mock.patch.object(deploy, 'run_consumer') as consumer:
                    if changed:
                        with self.assertRaisesRegex(ValueError, 'Packaged source differs'):
                            deploy.main()
                        consumer.assert_not_called()
                    else:
                        deploy.main()
                        consumer.assert_called_once()
                        expected = {'functions/' + name for name in deploy.FUNCTION_VARIANTS[schema] - {'functions.yaml'}}
                        self.assertEqual(reads, expected | {'firebase.json', 'firestore.rules', 'storage.rules'})

    def test_extracted_current_bundle_loads_actual_cjs_esm_seam(self):
        staging, _ = self.verify(schema=2)
        node = shutil.which('node')
        if node is None:
            self.skipTest('Node unavailable in Python-only verifier; isolated producer always proves extracted Node24 modules')
        env = {'HOME': str(self.work), 'PATH': '/usr/bin:/bin', 'FFB_ISOLATED_TEST': '1'}
        subprocess.run([node, str(ROOT / 'scripts/check-functions-modules.cjs'), str(staging / 'source')], env=env, cwd=self.work, check=True, timeout=30)

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

    def test_provenance_and_workflow_failures_happen_before_credential_consumer(self):
        for failure in ['workflow', 'attestation', 'archive']:
            with self.subTest(failure=failure):
                work = self.work / failure
                work.mkdir()
                events = []
                def external(argv, _env, _cwd, _capture=True):
                    if 'merge-base' in argv:
                        events.append('ancestor')
                        return ''
                    if '-p' in argv:
                        return '24'
                    if '--version' in argv:
                        return '15.34.2'
                    if 'api' in argv:
                        events.append('workflow')
                        runs = [] if failure == 'workflow' else [{'id': 1, 'head_sha': SHA, 'head_branch': 'main', 'event': 'push', 'conclusion': 'success', 'status': 'completed'}]
                        return json.dumps([{'workflow_runs': runs}])
                    if 'download' in argv:
                        events.append('download')
                        download = Path(argv[-1])
                        name = 'ffb-deploy-' + SHA + '.tar'
                        archive(download / name, metadata_changes={'repository': 'wrong/repo'} if failure == 'archive' else None)
                        (download / 'SHA256SUMS').write_text(deploy.digest((download / name).read_bytes()) + '  ' + name + '\n')
                        return ''
                    if 'attestation' in argv:
                        events.append('attestation')
                        if failure == 'attestation':
                            raise subprocess.CalledProcessError(1, argv)
                        return ''
                    raise AssertionError('Unexpected external command')
                args = ['deployer', '--sha', SHA, '--target', 'functions', '--repository-dir', str(work), '--work-dir', str(work)]
                with mock.patch.object(sys, 'argv', args), mock.patch.dict(os.environ, {'FFB_TRUSTED_MAIN': SHA}), mock.patch.object(deploy, 'resolve_tools', return_value={name: '/trusted/' + name for name in ['git', 'node', 'firebase', 'gh']}), mock.patch.object(deploy, 'run', side_effect=external), mock.patch.object(deploy, 'checked_process') as consumer:
                    with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                        deploy.main()
                    consumer.assert_not_called()
                self.assertEqual(events, ['ancestor', 'workflow'] if failure == 'workflow' else ['ancestor', 'workflow', 'download', 'attestation'])

    def test_source_copy_keeps_nested_app_but_excludes_root_build_and_local_config(self):
        source, dest = self.work / 'input', self.work / 'copy'
        (source / 'src/app').mkdir(parents=True)
        (source / 'app').mkdir()
        (source / 'src/app/main.jsx').write_text('real production entry')
        (source / 'app/old.js').write_text('stale build')
        (source / '.env.local').write_text('fake local credential')
        script = "require(" + repr(str(ROOT / 'scripts/build-deploy-artifact.cjs')) + ").copyTree(process.argv[1],process.argv[2]);"
        node = '/opt/homebrew/opt/node@24/bin/node' if Path('/opt/homebrew/opt/node@24/bin/node').exists() else shutil.which('node')
        if node is None:
            self.skipTest('Host Node unavailable; real source copy is exercised in the isolated production build')
        subprocess.run([node, '-e', script, str(source), str(dest)], check=True)
        self.assertEqual((dest / 'src/app/main.jsx').read_text(), 'real production entry')
        self.assertFalse((dest / 'app').exists())
        self.assertFalse((dest / '.env.local').exists())

    def test_unicode_component_and_pax_collisions_are_refused(self):
        extra = tarfile.TarInfo('hosting/public/cafe\u0301.txt')
        archive(self.tar, changes={'hosting/public/caf\u00e9.txt': b'one'}, extra=extra)
        with self.assertRaisesRegex(ValueError, 'collision'):
            deploy.extract_verified(self.tar, self.work / 'unicode', SHA, 'hosting')
        # A PAX header can override a seemingly safe member path. No PAX
        # overrides are needed by our deterministic USTAR producer.
        with tarfile.open(self.tar, 'w', format=tarfile.PAX_FORMAT) as tf:
            member = tarfile.TarInfo('safe')
            member.pax_headers = {'comment': 'unexpected override capability'}
            tf.addfile(member, io.BytesIO(b''))
        with self.assertRaisesRegex(ValueError, 'PAX'):
            deploy.extract_verified(self.tar, self.work / 'pax', SHA, 'hosting')

    def test_clean_exec_consumer_drops_parent_tokens_and_python_hooks(self):
        staging, _ = self.verify()
        staging = staging.parent / 'hosting'
        hashes = {p.relative_to(staging).as_posix(): deploy.digest(p.read_bytes()) for p in staging.rglob('*') if p.is_file()}
        marker = self.work / 'observed.json'
        op = self.work / 'fake-op'
        op.write_text("#!/bin/bash\nprintf '%s' '{\"type\":\"authorized_user\",\"client_id\":\"fake\",\"client_secret\":\"fake\",\"refresh_token\":\"fake\"}'\n")
        op.chmod(0o700)
        helper = self.work / 'fake-helper'
        helper.write_text('#!/bin/bash\npython3 -c ' + deploy.shlex.quote("import json,os,pathlib;pathlib.Path(" + repr(str(marker)) + ").write_text(json.dumps({'env':dict(os.environ),'cwd':os.getcwd(),'json':json.__file__}))") + '\n')
        helper.chmod(0o700)
        canary = self.work / 'hostile-python'
        canary.mkdir()
        (canary / 'json.py').write_text("raise Exception('HOSTILE PYTHON IMPORT')")
        tools = {'node': '/fake/node', 'op': str(op), 'helper': str(helper), 'python3': sys.executable}
        with mock.patch.dict(os.environ, {'GH_TOKEN': 'fake-PAT-canary', 'OP_PREFLIGHT_AUTHOR_PAT': 'fake-author-canary', 'GOOGLE_APPLICATION_CREDENTIALS': '/hostile', 'PYTHONPATH': str(canary), 'NODE_OPTIONS': '--require=/hostile'}):
            deploy.run_consumer(staging, 'hosting', tools, self.work, hashes)
        observed = json.loads(marker.read_text())
        env = observed['env']
        self.assertFalse(any(key.startswith(('GH_', 'OP_')) or key in ['PYTHONPATH', 'NODE_OPTIONS'] for key in env))
        self.assertEqual(env['HOME'], str(self.work / 'deploy-home'))
        self.assertEqual(Path(observed['cwd']).resolve(), (self.work / 'credentialed-cwd').resolve())
        self.assertNotIn('hostile-python', observed['json'])
        self.assertFalse((self.work / 'source-credential.json').exists())
        self.assertFalse((self.work / 'credential-tmp').exists())

    def test_reader_output_is_bounded_and_child_is_reaped(self):
        output = self.work / 'bounded'
        with output.open('wb') as stream:
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.checked_process([sys.executable, '-I', '-S', '-B', '-c', "import os,signal;signal.signal(signal.SIGXFSZ,signal.SIG_DFL);os.write(1,b'x'*100000);os.write(1,b'x')"], {}, self.work, capture=False, stdout=stream, output_limit=65536)
        self.assertLessEqual(output.stat().st_size, 65536)

    def test_public_entry_rejects_private_modes_and_target_widening(self):
        bad = [["--consume", "/tmp/payload"], ["--firebase", "/tmp/payload"], ["--check-archive", "/tmp/payload"], ["--sha", SHA, "--target", "all"], ["--sha", SHA, "--target", "functions,hosting"], ["--sha", SHA, "--target", "functions", "--except", "hosting"]]
        for args in bad:
            with self.subTest(args=args):
                result = subprocess.run([str(ROOT / "scripts/deploy-artifact.sh"), *args], capture_output=True)
                self.assertEqual(result.returncode, 2)
                # Direct Python invocation also has only the public parser.
                result = subprocess.run([sys.executable, "-I", "-S", str(ROOT / "scripts/deploy-artifact.py"), *args], capture_output=True)
                self.assertEqual(result.returncode, 2)

    def test_bad_acquisition_or_helper_error_never_retries_and_cleans(self):
        for label in ["reader", "shape", "helper"]:
            with self.subTest(label=label):
                work = self.work / label
                work.mkdir()
                archive(self.tar)
                staging, _ = deploy.extract_verified(self.tar, work / "staged", SHA, "hosting")
                hashes = {p.relative_to(staging).as_posix(): deploy.digest(p.read_bytes()) for p in staging.rglob('*') if p.is_file()}
                calls = []
                def acquire(_argv, _env, _cwd, stream):
                    calls.append("read")
                    if label == "reader":
                        raise OSError("Fake reader failed")
                    stream.write('{"type":"service_account"}' if label == "shape" else '{"type":"authorized_user","client_id":"fake","client_secret":"fake","refresh_token":"fake"}')
                def invoke(*_args):
                    calls.append("helper")
                    raise OSError("Fake helper token check failed")
                with self.assertRaises((ValueError, OSError)):
                    deploy.consume_verified(staging, "hosting", {"node": "/fake/node", "op": "/fake/op", "python3": sys.executable, "helper": "/fake/helper"}, work, hashes, invoke, acquire)
                self.assertEqual(calls, ["read", "helper"] if label == "helper" else ["read"])
                self.assertFalse((work / "source-credential.json").exists())
                self.assertFalse((work / "credential-tmp").exists())

    def test_hup_int_term_clean_credentials_and_wait_for_fake_child(self):
        for signum in [signal.SIGHUP, signal.SIGINT, signal.SIGTERM]:
            with self.subTest(signal=signum):
                work = self.work / str(signum)
                work.mkdir()
                archive(self.tar)
                staging, _ = deploy.extract_verified(self.tar, work / "staged", SHA, "hosting")
                hashes = {p.relative_to(staging).as_posix(): deploy.digest(p.read_bytes()) for p in staging.rglob('*') if p.is_file()}
                helper = work / 'fake-helper'
                marker = work / 'helper-pid'
                helper.write_text('#!/bin/bash\necho $$ > ' + str(marker) + '\nexec /bin/sleep 30\n')
                helper.chmod(0o700)
                harness = work / 'harness.py'
                harness.write_text("import importlib.util, json\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('d', " + repr(str(ROOT / 'scripts/deploy-artifact.py')) + ");d=importlib.util.module_from_spec(s);s.loader.exec_module(d)\nd.install_signal_handlers()\ndef acquire(a,e,c,stream):stream.write('{\"type\":\"authorized_user\",\"client_id\":\"fake\",\"client_secret\":\"fake\",\"refresh_token\":\"fake\"}')\nd.consume_verified(" + repr(str(staging)) + ", 'hosting', " + repr({"node": "/fake/node", "op": "/fake/op", "python3": sys.executable, "helper": str(helper)}) + ", " + repr(str(work)) + ", " + repr(hashes) + ", acquire=acquire)\n")
                process = subprocess.Popen([sys.executable, '-I', '-S', '-B', str(harness)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    deadline = time.monotonic() + 5
                    while not marker.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(marker.exists(), 'Fake helper must begin before signal')
                    child = int(marker.read_text())
                    os.kill(process.pid, signum)
                    self.assertNotEqual(process.wait(timeout=8), 0)
                    self.assertFalse((work / 'source-credential.json').exists())
                    self.assertFalse((work / 'credential-tmp').exists())
                    with self.assertRaises(ProcessLookupError):
                        os.kill(child, 0)
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait()

    def test_nested_repeated_cancellation_reaps_stubborn_helper_before_wiping_credentials(self):
        staging, _ = self.verify()
        staging = staging.parent / 'hosting'
        hashes = {p.relative_to(staging).as_posix(): deploy.digest(p.read_bytes()) for p in staging.rglob('*') if p.is_file()}
        reader = self.work / 'fake-op'
        reads = self.work / 'reads'
        reader.write_text("#!/bin/sh\necho read >> " + str(reads) + "\nprintf '%s' '{\"type\":\"authorized_user\",\"client_id\":\"fake\",\"client_secret\":\"fake\",\"refresh_token\":\"fake\"}'\n")
        reader.chmod(0o700)
        helper = self.work / 'stubborn-helper'
        marker, heartbeat = self.work / 'helper-pid', self.work / 'heartbeat'
        helper.write_text('#!/bin/sh\ntrap "" TERM\necho $$ > ' + str(marker) + '\nwhile :; do echo tick >> ' + str(heartbeat) + '; /bin/sleep .05; done\n')
        helper.chmod(0o700)
        tools = {'node': '/fake/node', 'op': str(reader), 'helper': str(helper), 'python3': sys.executable}
        harness = self.work / 'nested.py'
        harness.write_text("import importlib.util\ns=importlib.util.spec_from_file_location('d'," + repr(str(ROOT / 'scripts/deploy-artifact.py')) + ");d=importlib.util.module_from_spec(s);s.loader.exec_module(d);d.install_signal_handlers();d.run_consumer(" + repr(str(staging)) + ",'hosting'," + repr(tools) + "," + repr(str(self.work)) + "," + repr(hashes) + ")\n")
        process = subprocess.Popen([sys.executable, '-I', '-S', '-B', str(harness)], env={'HOME': str(self.work), 'PATH': '/usr/bin:/bin'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        helper_pid = None
        try:
            deadline = time.monotonic() + 5
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(marker.exists(), 'Credentialed fake helper must begin before cancellation')
            helper_pid = int(marker.read_text())
            self.assertTrue((self.work / 'source-credential.json').exists())
            os.kill(process.pid, signal.SIGTERM)
            # Repeated cancellation must not interrupt either level's cleanup.
            for signum in [signal.SIGHUP, signal.SIGINT, signal.SIGTERM]:
                time.sleep(.1)
                os.kill(process.pid, signum)
            self.assertNotEqual(process.wait(timeout=10), 0)
            self.assertEqual(reads.read_text().splitlines(), ['read'])
            self.assertFalse((self.work / 'source-credential.json').exists())
            self.assertFalse((self.work / 'credential-tmp').exists())
            before = heartbeat.stat().st_size
            time.sleep(.15)
            self.assertEqual(heartbeat.stat().st_size, before)
            with self.assertRaises(ProcessLookupError):
                os.kill(helper_pid, 0)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            if helper_pid:
                try:
                    os.killpg(helper_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_real_pinned_cli_discovers_manifest_without_candidate_import_or_spawn(self):
        node = Path(shutil.which('node') or '/opt/homebrew/opt/node@24/bin/node')
        cli = Path(os.environ.get('FFB_TEST_FIREBASE_CLI', '/opt/homebrew/lib/node_modules/firebase-tools/lib/bin/firebase.js'))
        if not node.exists() or not cli.exists():
            self.skipTest('Runtime delegate proof also runs in the isolated production build')
        home = self.work / 'neutral-home'
        home.mkdir()
        tools = {"node": str(node), "firebase": str(cli)}
        env = deploy.child_environment(home, '/usr/bin:/bin')
        version = subprocess.check_output([str(node), str(cli), '--version'], env=env, cwd=self.work, text=True, timeout=30)
        self.assertEqual(version.strip(), deploy.CLI_VERSION)
        for schema in [1, 2]:
            archive(self.tar, schema=schema)
            staging, _ = deploy.extract_verified(self.tar, self.work / str(schema), SHA, 'functions')
            # Every candidate module is a tripwire, including unused schema2 files.
            for file in (staging / 'source').iterdir():
                if file.suffix in ['.js', '.mjs']:
                    file.write_text("throw Error('CANDIDATE EXECUTED');")
            deploy.check_discovery(staging, tools, env, self.work)
        ancestor_sdk = self.work / 'node_modules/firebase-functions'
        ancestor_sdk.mkdir(parents=True)
        (ancestor_sdk / 'package.json').write_text('{"name":"firebase-functions","version":"7.4.0","main":"index.js"}')
        (ancestor_sdk / 'index.js').write_text("throw Error('SDK IMPORTED');")
        with self.assertRaises(subprocess.CalledProcessError):
            deploy.check_discovery(staging, tools, deploy.child_environment(home, '/usr/bin:/bin'), self.work)


if __name__ == '__main__':
    from unittest import mock
    unittest.main()
