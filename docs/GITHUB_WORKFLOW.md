# Waxloom — GitHub workflow

This workflow is mandatory for repository changes.

## 1. Source of truth

- GitHub branch/commit state beats chat memory.
- `/HANDOFF.md` routes the session.
- `docs/AI_HANDOFF.md` records the current recovery point.
- `main` is the published/testable line, not a development scratchpad.

## 2. Branch/worktree discipline

Permanent rule: **1 chantier = 1 branch = 1 dedicated worktree**.

Before local modification:

1. `git fetch --all --prune`
2. `git worktree list --porcelain`
3. identify repo/worktree/branch/HEAD/CLEAN-DIRTY
4. reuse the existing worktree for that branch if safe, otherwise create a dedicated one
5. never share one writable worktree between concurrent chantiers

Detailed policy: `docs/LOCAL_MULTI_WORKTREE_POLICY.md`.

## 3. Public-repository security gate

Before every commit/push/PR/release:

1. `./scripts/security-gate.ps1`
2. `git status --short`
3. `git diff --check`
4. inspect exact diff
5. stage explicit paths only

Any security gate failure blocks publication.

Never commit `.env`, credentials, cookies, tokens, private keys, local databases, user library data, downloaded media, or machine-specific private configuration.

## 4. Candidate validation

A test only validates the SHA actually tested.

For candidate-specific validation require:

- dedicated worktree;
- CLEAN worktree;
- explicit branch;
- `HEAD local == HEAD origin/<branch> == expected candidate SHA`;
- relevant security/build/test gate;
- exact SHA recorded in handoff/PR evidence.

A PASS on another SHA does not validate the candidate unless the later commits are explicitly classified as documentation-only/non-runtime and the promotion evidence says so.

## 5. Promotion

Promotion is separate from implementation and testing.

GitHub branch protection/rulesets are recommended but **not required** when the repository/account plan does not provide them.

Before promotion to `main`:

- re-fetch `main` and candidate;
- candidate must not be behind/diverged unexpectedly;
- security gate PASS;
- required build/test gates PASS on the candidate/runtime-equivalent SHA;
- user validation completed when UX/runtime behavior is involved;
- final diff inspected;
- `docs/AI_HANDOFF.md` current;
- **explicit repository-owner instruction to push/merge to `main`**.

Default behavior is **do not push to `main`**. If the owner explicitly says to push/merge to `main`, perform the promotion after the gates above even if `main` is unprotected.

Owner authorization does not permit force-push, destructive history rewrite, secret publication, or bypassing failed security/build gates.

## 6. Recovery / rollback

- no `git reset --hard` to erase shared history;
- no force-push;
- no blind `git clean -fdx`;
- rollback published changes with revert/new commit;
- DIRTY worktrees are held until explicitly inventoried.

## 7. Commit hygiene

- coherent commits;
- explicit paths;
- no blind `git add -A`;
- no generated caches/logs/media/secrets;
- no false PASS claims;
- handoff changes travel with workflow/state changes.
