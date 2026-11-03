# Agent Operating Rules

This file is this repo's local overlay. The fleet-wide rules (1Password authentication failures, bug fix escalation, secret handling, and the rest) live in [Shared Agent Operating Rules](shared-operating-rules.md); read that file first.

## PR-body requirements

Before opening a PR, include `Authoring-Agent: <your-agent>` and a `## Self-Review` section covering correctness, regression risk, style, test coverage, and security/dependency hygiene. Use the identity-checked author path governed by [REVIEW_POLICY.md](../../REVIEW_POLICY.md#phase-1-authoring), with the session-supported transports and capable-session handback described in [Cloud Agent Environments](cloud-environments.md). Do not use bare GitHub writes. Delegating CLAUDE.md to the AGENTS.md reading order preserves these requirements.

Read in this order before taking any action:

1. `README.md` — understand the project
2. `AGENTS.md` — load behavioral instructions (index pointing to this directory)
3. `rules/repo_rules.md` — load binding constraints
4. Relevant `specs/` files — understand intended behavior
5. `DEPLOYMENT.md` — deploy process and credential setup
6. `.ai_context.md` — load supplemental context

If any required file is missing, flag the gap before proceeding.

Conflict resolution:

- If code conflicts with `specs/`: flag the conflict, update spec or
  tests first, then update code. Do not silently modify behavior.
- If a proposed change violates `rules/repo_rules.md`: stop and flag
  the violation. Do not proceed without resolution.
- If a tool folder contains instructions that conflict with `AGENTS.md`
  or these sub-files: follow the canonical docs and flag the duplication
  for removal.
- If `AGENTS.md` or its sub-files are missing required sections: flag
  the gap and do not assume behavior for missing sections.

## Worktree lifecycle

Worktrees created for a task must be removed immediately after the corresponding
branch is merged or deleted from the remote. Never leave a worktree checked out
for a branch that is `[gone]` on the remote.

**After merging a PR whose branch had a worktree:**

```bash
git worktree remove --force .claude/worktrees/<name>
git worktree prune
```

**To find stale worktrees:**

```bash
git worktree list   # all worktrees and their branches
git branch -vv      # [gone] next to branches whose remote was deleted
```

If a worktree directory exists but `git worktree list` no longer shows it
(orphaned after `--force` removal), run `git worktree prune` to clean up
the git metadata, then `rm -rf` the leftover directory.
