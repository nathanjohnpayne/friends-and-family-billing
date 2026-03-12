import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const scopeIndex = process.argv.indexOf('--scope');
const scope = scopeIndex >= 0 ? process.argv[scopeIndex + 1] : '';

const secretPatterns = [
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'OpenAI API key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Anthropic API key', regex: /\bsk-ant(?:-api\d{2})?-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g },
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Google OAuth access token', regex: /\bya29\.[A-Za-z0-9._-]+\b/g },
  { name: 'Private key block', regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

function getTrackedFiles() {
  const output = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf8' });
  return output
    .split('\0')
    .filter(Boolean)
    .filter((file) => !scope || file === scope || file.startsWith(`${scope}/`));
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function lineNumberForIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function findSecrets(file) {
  const absolutePath = path.join(repoRoot, file);
  const buffer = fs.readFileSync(absolutePath);
  if (isBinary(buffer)) {
    return [];
  }

  const text = buffer.toString('utf8');
  const findings = [];

  for (const pattern of secretPatterns) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      findings.push({
        file,
        line: lineNumberForIndex(text, match.index),
        type: pattern.name,
        value: match[0],
      });
    }
  }

  return findings;
}

const findings = getTrackedFiles().flatMap(findSecrets);

if (findings.length > 0) {
  console.error('Potential public secrets found in tracked files:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.type}) ${finding.value.slice(0, 80)}`);
  }
  process.exit(1);
}

console.log(`Secret scan passed for ${scope || 'repo'} tracked files.`);
