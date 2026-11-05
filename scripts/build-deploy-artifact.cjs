/** Run only inside the credential-free CI container; never on the operator host. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function requireCondition(ok, message) { if (!ok) throw new Error(message); }
function copyTree(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    requireCondition(!entry.isSymbolicLink(), 'Source links are forbidden');
    if (['.git', 'node_modules', 'app', 'firebase-config.local.js'].includes(entry.name) || entry.name.startsWith('.env')) continue;
    const input = path.join(source, entry.name);
    const output = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(input, output);
    else { requireCondition(entry.isFile(), 'Source devices are forbidden'); fs.copyFileSync(input, output); }
  }
}
function command(program, args, cwd, extra = {}) {
  execFileSync(program, args, { cwd, env: { ...process.env, ...extra }, stdio: 'inherit', timeout: 600000 });
}
function build() {
  requireCondition(process.env.FFB_ISOLATED_BUILD === '1' && process.env.HOME === '/work/home', 'Use the isolated CI workflow');
  requireCondition(process.versions.node.split('.')[0] === '24', 'Node24 required');
  requireCondition(/^[0-9a-f]{40}$/.test(process.env.SOURCE_SHA || ''), 'Full source SHA required');
  // All callers use an env allowlist; fail closed if a credential somehow arrives.
  for (const key of Object.keys(process.env)) {
    requireCondition(!/(TOKEN|PASSWORD|CREDENTIAL|SECRET|PAT$|^OP_|^GH_|^GITHUB_|^AWS_|^AZURE_|^CLOUDSDK_|^GOOGLE_)/i.test(key), 'Credential environment forbidden');
  }
  const config = JSON.parse(process.env.PUBLIC_FIREBASE_CONFIG || '{}');
  const fields = { apiKey: 'API_KEY', authDomain: 'AUTH_DOMAIN', projectId: 'PROJECT_ID', storageBucket: 'STORAGE_BUCKET', messagingSenderId: 'MESSAGING_SENDER_ID', appId: 'APP_ID', measurementId: 'MEASUREMENT_ID' };
  requireCondition(Object.keys(config).every(k => k in fields), 'Unexpected public Firebase input');
  for (const key of Object.keys(fields).filter(k => k !== 'measurementId')) requireCondition(typeof config[key] === 'string' && config[key].length > 0, 'Missing public Firebase input');
  requireCondition(config.projectId === 'friends-and-family-billing' && !JSON.stringify(config).includes('e2e-test'), 'Production Firebase project required');
  requireCondition(typeof process.env.PUBLIC_LOGODEV_KEY === 'string' && process.env.PUBLIC_LOGODEV_KEY.length > 0, 'Public Logo.dev input required');
  for (const value of [...Object.values(config), process.env.PUBLIC_LOGODEV_KEY]) requireCondition(!/[\r\n]/.test(value), 'Invalid multiline public input');
  fs.mkdirSync('/work/home', { recursive: true });
  copyTree('/input', '/work/source');
  const source = '/work/source';
  const env = Object.entries(config).map(([key, value]) => `VITE_FIREBASE_${fields[key]}=${JSON.stringify(value)}`).join('\n');
  fs.writeFileSync(path.join(source, '.env.local'), env + '\nVITE_LOGODEV_KEY=' + JSON.stringify(process.env.PUBLIC_LOGODEV_KEY) + '\n', { mode: 0o600 });
  // Install lifecycle scripts run only in this credential-free disposable container.
  command('npm', ['ci'], source);
  command('npm', ['ci'], path.join(source, 'functions'));
  command('npm', ['run', 'build'], source);
  command('node', ['stamp-version.js'], source);
  const functionSource = path.join(source, 'functions');
  requireCondition(JSON.parse(fs.readFileSync(path.join(functionSource, 'node_modules/firebase-functions/package.json'))).version === '7.4.0', 'SDK pin mismatch');
  command('node', [path.join(functionSource, 'node_modules/firebase-functions/lib/bin/firebase-functions.js')], functionSource, { FUNCTIONS_CONTROL_API: 'true', FUNCTIONS_MANIFEST_OUTPUT_PATH: path.join(functionSource, 'functions.yaml'), GCLOUD_PROJECT: config.projectId, GOOGLE_CLOUD_PROJECT: config.projectId });
  const bundle = '/work/bundle';
  fs.mkdirSync(bundle);
  const write = (name, data) => { const dest = path.join(bundle, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data); };
  const json = (name, value) => write(name, JSON.stringify(value) + '\n');
  json('functions/firebase.json', { functions: { source: 'source', runtime: 'nodejs24', codebase: 'default' } });
  for (const name of ['index.js', 'billing.js', 'package.json', 'package-lock.json', 'functions.yaml']) write('functions/source/' + name, fs.readFileSync(path.join(functionSource, name)));
  const original = JSON.parse(fs.readFileSync(path.join(source, 'firebase.json')));
  requireCondition(!original.hosting.predeploy && !original.hosting.postdeploy, 'Remove local deploy hooks');
  json('hosting/firebase.json', { hosting: { ...original.hosting, public: 'public' } });
  fs.cpSync(path.join(source, 'app'), path.join(bundle, 'hosting/public'), { recursive: true, dereference: false });
  json('firestore-rules/firebase.json', { firestore: { rules: 'firestore.rules' } });
  write('firestore-rules/firestore.rules', fs.readFileSync(path.join(source, 'firestore.rules')));
  json('storage/firebase.json', { storage: { rules: 'storage.rules' } });
  write('storage/storage.rules', fs.readFileSync(path.join(source, 'storage.rules')));
  // Prove the actual pinned runtime delegate using source-only extraction.
  command('npm', ['install', '--prefix', '/work/tooling', '--ignore-scripts', '--no-audit', '--no-fund', 'firebase-tools@15.34.2'], '/work');
  command('node', ['-e', fs.readFileSync('/input/scripts/check-functions-discovery.cjs', 'utf8'), path.join(bundle, 'functions/source'), '/work/tooling/node_modules/firebase-tools/lib/bin/firebase.js'], '/work');
  const hashes = {};
  function hashTree(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      requireCondition(!entry.isSymbolicLink(), 'Output links forbidden');
      if (entry.isDirectory()) hashTree(file);
      else { requireCondition(entry.isFile(), 'Output devices forbidden'); hashes[path.relative(bundle, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
    }
  }
  hashTree(bundle);
  json('metadata.json', { schema: 1, repository: 'nathanjohnpayne/friends-and-family-billing', sourceSha: process.env.SOURCE_SHA, firebaseCli: '15.34.2', functionsSdk: '7.4.0', files: hashes });
  const name = 'ffb-deploy-' + process.env.SOURCE_SHA + '.tar';
  // Explicit file entries avoid ./ names and directory metadata portability.
  command('tar', ['--format=ustar', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-cf', '/output/' + name, ...Object.keys(hashes).sort(), 'metadata.json'], bundle);
  fs.writeFileSync('/output/SHA256SUMS', crypto.createHash('sha256').update(fs.readFileSync('/output/' + name)).digest('hex') + '  ' + name + '\n');
  requireCondition(fs.existsSync('/work/probe-observed'), 'Isolation probe did not run');
  fs.writeFileSync('/output/isolation-proof.json', JSON.stringify({ sourceSha: process.env.SOURCE_SHA, productionBuild: true, manifestDiscovery: true, candidateImportedDuringDeploy: false, credentialEnvironmentDenied: true, operatorFilesystemDenied: true }) + '\n');
}
if (require.main === module) build();
module.exports = { copyTree, build };
