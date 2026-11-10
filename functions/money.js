// Node 24 supports synchronous require(ESM); money.mjs must have no top-level
// await. Source-only seam: artifact registration is required before activation.
module.exports = require('./money.mjs');
