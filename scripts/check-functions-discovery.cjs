// Trusted runtime proof: no candidate imports or child processes.

const [source, cli] = process.argv.slice(1);
if (process.versions.node.split('.')[0] !== '24') throw Error('Node24 required');
for (const id of ['firebase-functions', 'firebase-functions/package.json']) {
  try { require.resolve(id, {paths: [source]}); throw Error('SDK resolves from staging ancestor/global path'); }
  catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
}
const cp = require('node:child_process');
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  cp[key] = () => { throw Error('CLI attempted a child process'); };
}
const Module = require('node:module');
const oldLoad = Module._load;
Module._load = function(id, parent, ...rest) {
  const file = Module._resolveFilename(id, parent);
  if (typeof file === 'string' && file.startsWith(source + '/')) throw Error('Candidate module import');
  return oldLoad.call(this, id, parent, ...rest);
};
const path = require('node:path');
const {Delegate} = require(path.resolve(path.dirname(cli), '../deploy/functions/runtimes/node'));
(async () => {
 const delegate = new Delegate('friends-and-family-billing', path.dirname(source), source, 'nodejs24');
 if (delegate.sdkVersion !== '') throw Error('Resolved SDK version');
 await delegate.validate(); await delegate.build();
 const build = await delegate.discoverBuild({}, {});
 if (!Object.keys(build.endpoints).length) throw Error('No manifest endpoints');
})().catch(e => { console.error(e.message); process.exitCode = 1; });

