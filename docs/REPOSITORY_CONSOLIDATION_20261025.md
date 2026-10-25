# Waxloom repository consolidation — 2026-10-25

## Canonical code and deployed versions

- GitHub `main` advances by fast-forward from September baseline `35bb87dbc06b1ec8166d24218a9204e5b45adba9` to the source of the running Web `82eddfc8fe114dfe855cbb0dd98b97ab5ea28718`, followed only by repository maintenance documentation.
- Deployed API source is `6b1fe4505b15aa6ec21441d57709769c4930e010`, which is included in the Web commit's ancestry. These are distinct Docker images and remain unchanged by this GitHub housekeeping.
- Record browser and iPhone UX as `IMPLEMENTED / NOT USER VALIDATED` pending physical Safari/PWA Back and audio testing; do not mistake Chromium mobile emulation for device acceptance.

## Durable GitHub checkpoints

- `waxloom-preconsolidation-main-20261025` — former `main` tip before consolidation.
- `waxloom-api-live-20261025` — exact API source running on consolidation date.
- `waxloom-web-live-20261025` — exact Web source running on consolidation date.

Do not move, repoint or delete those tags. Reverting Git history or deploying from a tag requires a separate reviewed release; this housekeeping does not restart containers, mutate media or update runtime manifests.

## Historical pull requests and branches

The September/October implementation PRs were stacked on other topic branches instead of directly on `main`. Their code is already in the deployed Web commit. Once `main` contains their commit SHAs, close their PRs as **superseded by canonical main history**, not as newly merged with GitHub's merge button. Preserve their commit history in `main` and immutable tags. Remove only remote topic branches verified as ancestors of `main` and not needed as current release or dirty/divergent work.

**Hold, no automatic deletion:** native Apple Watch divergent branches; the independent `fix/global-fluidity-shuffle-20261020` documentation-only commit; any remote branch referenced by an uncommitted local worktree; the deployed Web release branch until validation and transition are documented. Local dirty worktrees are never reset, switched, cleaned or removed by repository housekeeping.

## Next development and release policy

1. Read `HANDOFF.md` and `AI_PROJECT_RULES.md`; verify the private `CURRENT_RUNTIME.json` using its adjacent read-only `CHECK_RUNTIME.ps1` before touching production.
2. Base new work on current `main` and create one worktree/branch per task. Record runtime Web/API commits separately, since a newer repository documentation commit does not imply a deployment.
3. Run security gate, source-specific QA, Docker exact-SHA staging, and record device validation before a distinct deployment. Never merge divergent native work by ancestry alone.
4. Do not publish `.env`, provider credentials, user library data, runtime manifests, media or machine-specific private settings.