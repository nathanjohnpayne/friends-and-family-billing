/** BUILD/TEST ONLY: imports candidate bytes inside a credential-free container. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

async function check(source) {
  assert(process.env.FFB_ISOLATED_BUILD === '1' || process.env.FFB_ISOLATED_TEST === '1', 'Isolated build/test required');
  assert.equal(process.versions.node.split('.')[0], '24', 'Node24 required');
  const root = path.resolve(source);
  const load = createRequire(path.join(root, 'package.json'));
  for (const name of ['money', 'household-money']) {
    const cjs = load('./' + name + '.js');
    const esm = await import(pathToFileURL(path.join(root, name + '.mjs')).href);
    assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
    for (const key of Object.keys(esm)) assert.equal(cjs[key], esm[key]);
  }
  const money = load('./money.js');
  assert.equal(money.quantizeDollarsToCents(money.divideExact(money.exactNumber(1.15), money.exactNumber(2))), 58);
  assert.equal(load('./household-money.js').toExactCents(0.005), 1);
  console.log('Extracted Functions financial modules load through Node24 CJS/ESM.');
}
check(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
