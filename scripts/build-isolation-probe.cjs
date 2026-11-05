// Preloaded in every Node build subprocess in the disposable CI container.
const fs = require('node:fs');
for (const key of Object.keys(process.env)) {
  // Public project identifiers are added solely for SDK manifest generation.
  if (['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT'].includes(key)) continue;
  if (/(TOKEN|PASSWORD|CREDENTIAL|SECRET|PAT$|^OP_|^GH_|^GITHUB_|^AWS_|^AZURE_|^CLOUDSDK_|^GOOGLE_)/i.test(key)) throw Error('Credential environment leaked to builder');
}
for (const file of ['/host-canary/credential', '/home/runner/.config/ffb-isolation-canary', '/Users/nathanpayne/.config/gcloud/application_default_credentials.json', '/var/run/docker.sock']) {
  if (fs.existsSync(file)) throw Error('Operator/cache filesystem leaked to builder');
}
fs.mkdirSync('/work', { recursive: true });
fs.writeFileSync('/work/probe-observed', 'isolation probe passed\n');
