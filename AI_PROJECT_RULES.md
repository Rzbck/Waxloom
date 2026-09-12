# Waxloom — AI project rules

> Read before modifying the repository. `HANDOFF.md` is the routing entry point; this file contains permanent work rules.

## Core engineering rule

Understand current state first, then modify the smallest necessary scope.

Waxloom orchestrates multiple services and credentials. A local convenience change can affect startup, provider security, user data, or the public repository. Do not create hidden parallel sources of truth or bypass an existing adapter simply to make one screen work.

## Mandatory startup procedure for a work session

1. Fetch `main` and the work branch.
2. Identify repository, worktree, branch, HEAD, and CLEAN/DIRTY.
3. Read `HANDOFF.md` and `docs/AI_HANDOFF.md`.
4. Read `docs/GITHUB_WORKFLOW.md` and `docs/LOCAL_MULTI_WORKTREE_POLICY.md` before changing branches/worktrees.
5. Inspect the relevant code and tests.
6. Run the public-repository security gate before commit/push.

## Permanent Git rule

**1 active chantier = 1 branch = 1 dedicated worktree.**

- `main` is not a development scratchpad.
- Never write a new development change directly to `main`.
- Never let two agents/chantiers write into the same worktree.
- Never destroy a DIRTY worktree to “clean things up”.
- No force-push, destructive reset, blind `git clean`, or shared-history rewrite.
- Exact candidate tests require exact SHA attribution.

## Public repository security

The blocking rules in `HANDOFF.md` are mandatory.

Additional invariants:

- provider credentials stay server-side;
- frontend/public config endpoints return non-secret data only;
- logs must not print credentials, auth headers, cookie values, or full private configuration;
- example configuration uses placeholders only;
- local media/library/provider databases are never repository fixtures unless replaced by synthetic data;
- tests should prefer synthetic fixtures over copies of user data;
- if secret exposure is suspected, stop and rotate/revoke before continuing.

## Validation vocabulary

Use these labels exactly in handoffs/PRs:

- `USER VALIDATED`
- `AUTOMATED GATE PASS`
- `IMPLEMENTED / NOT USER VALIDATED`
- `BUG / LIMIT / BLOCKER`
- `EXPERIMENTAL / HYPOTHESIS`
- `NEXT TEST`

Do not call something fixed because it parses, builds, or exists in code.

## Change method

For non-trivial changes:

1. start from a known fetched base;
2. create/reuse the dedicated worktree;
3. make the smallest coherent change;
4. add a regression check when practical;
5. run security + syntax/build/tests appropriate to scope;
6. inspect final diff and tracked files;
7. publish only the work branch;
8. user validation happens on the exact candidate SHA;
9. promotion to `main` is separate and explicit.

## End of session

Before declaring a step complete, be able to state:

- exact branch and HEAD tested;
- what was changed;
- what remained untouched;
- what automated gates passed;
- what the user actually validated;
- current blockers;
- exact next test;
- rollback/base SHA;
- whether `docs/AI_HANDOFF.md` is current.
