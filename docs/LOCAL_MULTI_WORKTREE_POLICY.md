# Waxloom — local multi-worktree policy

Waxloom may be worked on by several sessions/agents in parallel. A single checkout with repeated branch switching is not sufficient.

Permanent rule: **1 active chantier = 1 branch = 1 dedicated worktree**.

## Expected topology

Example only:

```text
E:\_Project\Waxloom\                       # historical/main checkout
E:\_Project\_WAXLOOM_WORKTREES\
    bootstrap-workflow-security-20260912\  # branch worktree
    discovery-...\                         # another chantier
    _validation\<sha-or-name>\            # temporary exact-SHA validation
```

Folder names are not authority. Branch + SHA + Git worktree registration are authority.

## Mandatory preflight

Before creating, switching, reusing, testing, or deleting a worktree:

```powershell
git fetch --all --prune
git worktree list --porcelain
git status --short
git branch --show-current
git rev-parse HEAD
```

Then explicitly classify the current checkout:

- repository path;
- worktree path;
- branch;
- HEAD;
- CLEAN or DIRTY;
- role: MAIN / ACTIVE CHANTIER / VALIDATION / UNKNOWN.

## Creating a chantier worktree

1. Fetch the remote branch/base.
2. Confirm the branch is not already attached to another worktree.
3. Create/reuse one dedicated worktree.
4. Confirm branch, HEAD, and CLEAN state in that worktree.
5. Only then modify or run candidate-specific tests.

Recommended pattern:

```powershell
$repo = 'E:\_Project\Waxloom'
$wtRoot = 'E:\_Project\_WAXLOOM_WORKTREES'
$branch = 'fix/example-YYYYMMDD'
$wt = Join-Path $wtRoot 'example-YYYYMMDD'

git -C $repo fetch origin
git -C $repo worktree list --porcelain
New-Item -ItemType Directory -Force -Path $wtRoot | Out-Null
git -C $repo worktree add $wt $branch

git -C $wt branch --show-current
git -C $wt rev-parse HEAD
git -C $wt status --short
```

Do not run this blindly if the branch is already attached; inventory first.

## Main worktree

The `main` worktree stays on `main` and is used to:

- inspect the published baseline;
- fetch/update the published baseline;
- create/checkpoint work branches;
- compare candidates.

It is not a shared development worktree.

## Validation worktrees

Exact-SHA validation may use a dedicated branch worktree or an explicitly detached temporary worktree. Before attributing a PASS to a candidate:

- worktree CLEAN;
- exact expected SHA known;
- local SHA equals remote candidate SHA;
- security gate and relevant tests run from that same worktree.

## Cleanup gate

Never delete a worktree from GitHub state alone. Local state is mandatory.

Classify:

- `SAFE_REMOVE` — CLEAN, durable work preserved, no active process/use;
- `ARCHIVE_THEN_REMOVE` — CLEAN but divergent/unpublished state needs a preservation decision;
- `HOLD_DIRTY` — DIRTY, do not remove;
- `HOLD_UNKNOWN` — identity/role/publication incomplete;
- `ACTIVE` — current chantier or permanent main worktree.

Forbidden cleanup shortcuts:

- `git reset --hard` to erase unknown work;
- `git clean -fd` / `git clean -fdx` as housekeeping;
- deleting a registered worktree folder before `git worktree remove`;
- force-push to make local history “match”.

For a safe registered worktree removal, use `git worktree remove <path>` only after the gate, then `git worktree prune` after rechecking the list.
