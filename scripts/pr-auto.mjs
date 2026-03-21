import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const defaultTemplatePath = path.join(repoRoot, '.github', 'pull_request_template.md');

function parseArgs(argv) {
  const options = {
    autoMerge: true,
    base: 'main',
    draft: false,
    dryRun: false,
    mergeMethod: 'merge',
    templatePath: defaultTemplatePath,
    title: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--title') {
      options.title = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--title=')) {
      options.title = arg.slice('--title='.length);
    } else if (arg === '--base') {
      options.base = argv[index + 1] || options.base;
      index += 1;
    } else if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
    } else if (arg === '--template') {
      options.templatePath = path.resolve(repoRoot, argv[index + 1] || '');
      index += 1;
    } else if (arg.startsWith('--template=')) {
      options.templatePath = path.resolve(repoRoot, arg.slice('--template='.length));
    } else if (arg === '--draft') {
      options.draft = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-auto-merge') {
      options.autoMerge = false;
    } else if (arg === '--merge' || arg === '--rebase' || arg === '--squash') {
      options.mergeMethod = arg.slice(2);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run pr:auto -- [options]

Options:
  --title <text>        PR title. Defaults to the latest commit subject.
  --base <branch>       Base branch. Defaults to main.
  --template <path>     PR body template. Defaults to .github/pull_request_template.md.
  --draft               Create the PR as a draft and skip enabling auto-merge.
  --no-auto-merge       Create or update the PR without enabling auto-merge.
  --merge               Use merge commits when enabling auto-merge (default).
  --rebase              Use rebase when enabling auto-merge.
  --squash              Use squash when enabling auto-merge.
  --dry-run             Print the GitHub and git commands without running them.
  --help                Show this message.
`);
}

function quote(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : JSON.stringify(value);
}

function formatCommand(command, args) {
  return [command, ...args].map(quote).join(' ');
}

function read(command, args, { allowFailure = false } = {}) {
  try {
    return execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch (error) {
    if (allowFailure) {
      return null;
    }
    throw error;
  }
}

function run(command, args, { capture = true } = {}) {
  if (options.dryRun) {
    console.log(`$ ${formatCommand(command, args)}`);
    return '';
  }

  if (capture) {
    return execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  }

  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  return '';
}

function getCurrentBranch() {
  return read('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function ensureFeatureBranch(branch) {
  if (!branch || branch === 'HEAD') {
    throw new Error('Detached HEAD is not supported. Check out a branch first.');
  }
  if (branch === 'main' || branch === 'master') {
    throw new Error('Run this helper from a feature branch, not from main/master.');
  }
}

function ensureTemplateExists(templatePath) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`PR template not found: ${templatePath}`);
  }
}

function getTitle(explicitTitle) {
  return explicitTitle || read('git', ['log', '-1', '--pretty=%s']);
}

function listOpenPrs(branch) {
  const output = read('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,title,isDraft']);
  return JSON.parse(output || '[]');
}

function hasUpstreamBranch() {
  return read('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true }) !== null;
}

function pushBranch(branch) {
  if (hasUpstreamBranch()) {
    run('git', ['push'], { capture: false });
    return;
  }

  run('git', ['push', '--set-upstream', 'origin', branch], { capture: false });
}

function createPr({ branch, title, base, draft, templatePath }) {
  const templateArg = path.relative(repoRoot, templatePath);
  const args = ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--template', templateArg];
  if (draft) {
    args.push('--draft');
  }
  run('gh', args);
  return options.dryRun
    ? 'https://github.com/nathanjohnpayne/friends-and-family-billing/pull/DRY-RUN'
    : read('gh', ['pr', 'view', '--head', branch, '--json', 'url', '--jq', '.url']);
}

function enableAutoMerge(prUrl, method) {
  run('gh', ['pr', 'merge', prUrl, '--auto', `--${method}`], { capture: false });
}

const options = parseArgs(process.argv.slice(2));
const branch = getCurrentBranch();

ensureFeatureBranch(branch);
ensureTemplateExists(options.templatePath);

const title = getTitle(options.title);
if (!title) {
  throw new Error('Could not determine a PR title. Pass one with --title.');
}

pushBranch(branch);

const [existingPr] = listOpenPrs(branch);
const prUrl = existingPr ? existingPr.url : createPr({
  base: options.base,
  branch,
  draft: options.draft,
  templatePath: options.templatePath,
  title,
});

if (existingPr) {
  console.log(`Using existing PR: ${prUrl}`);
} else {
  console.log(`Created PR: ${prUrl}`);
}

if (options.autoMerge && !options.draft) {
  enableAutoMerge(prUrl, options.mergeMethod);
  console.log(`Enabled auto-merge (${options.mergeMethod}) for ${prUrl}`);
} else if (options.draft) {
  console.log('PR left as draft; auto-merge was not enabled.');
} else {
  console.log('PR created without auto-merge.');
}
