# HANDOFF — Waxloom

This file is the single entry point for resuming work on Waxloom.

If a new session starts with `HANDOFF`, rebuild the current state from GitHub first. Never trust an old chat, local folder name, or remembered SHA as current authority.

## 1. Before any modification

1. Re-fetch `Rzbck/Waxloom`, `main`, and the active work branch.
2. Identify the exact repository, worktree path, branch, HEAD, and CLEAN/DIRTY state.
3. Run `git worktree list --porcelain` before creating, switching, or deleting a worktree.
4. Read this file, then `AI_PROJECT_RULES.md`, `docs/AI_HANDOFF.md`, `docs/GITHUB_WORKFLOW.md`, and `docs/LOCAL_MULTI_WORKTREE_POLICY.md`.
5. Inspect the relevant code and tests before editing.
6. For any candidate-specific test, require `local HEAD == remote branch HEAD == expected candidate SHA` and a CLEAN worktree.
7. Do not write directly to `main` for normal development work unless the repository owner explicitly instructs a push/merge to `main`.

Permanent rule: **1 active chantier = 1 branch = 1 dedicated worktree**.

## 2. PUBLIC REPOSITORY SECURITY GATE — BLOCKING

Waxloom is public. Treat every committed byte as immediately world-readable and permanently exposable.

Before every commit, push, pull request, release, or promotion:

1. **Never commit or print real secrets.** This includes `.env`, Navidrome passwords, AudioMuse tokens, API keys, browser cookies, session material, private keys, auth headers, local database files, or provider credentials.
2. **Never read ignored local secret files merely to “check” them.** Validate presence/ignore status only. If a task truly requires using a secret, keep it process-local and never echo it.
3. `.env` must remain ignored. `.env.example` may contain placeholders only.
4. No machine-specific personal paths, usernames, private hostnames, local IP inventory, library contents, listening history, or private metadata may be committed unless deliberately sanitized and required for public documentation.
5. No downloaded music, media files, cookies, provider caches, Navidrome database, AudioMuse database, logs containing credentials, or user library exports may enter Git.
6. Run `scripts/security-gate.ps1`. Any failure is **STOP / BLOCKED** until fixed.
7. Inspect `git status --short`, `git diff --check`, and the exact diff. Stage explicit paths only; no blind `git add -A`.
8. A suspected exposed credential is considered compromised. **STOP**, rotate/revoke it first, then remove it from the candidate. Rewriting Git history does not make an already published secret trustworthy again.
9. Provider integrations must keep credentials server-side. The browser must never receive Navidrome passwords, AudioMuse tokens, downloader cookies, or equivalent secrets.
10. Security gates are fail-closed: unknown provenance, unknown secret status, or an unexpected generated file means **do not push / do not promote**.

### Main protection / owner authority

GitHub branch protection or repository rulesets are recommended when the account/plan supports them, but they are **not a promotion blocker** for Waxloom.

The repository owner is the authority for promotion to `main`:

- default behavior: develop on dedicated branches/worktrees and do not push to `main`;
- if the owner explicitly says to **push/merge to `main`**, that is authorization to perform the promotion even when `main` is unprotected;
- explicit owner authorization does **not** bypass public-repository security checks, required build/test gates, diff inspection, or non-destructive Git rules;
- never infer promotion permission from silence, a successful test, or an earlier unrelated instruction.

## 3. Source of truth / status categories

Always distinguish:

- **USER VALIDATED** — the user actually ran/verified it;
- **AUTOMATED GATE PASS** — automated checks passed on the exact candidate;
- **IMPLEMENTED, NOT USER VALIDATED**;
- **BUG / LIMIT / BLOCKER**;
- **EXPERIMENTAL / HYPOTHESIS**;
- **NEXT TEST / NEXT CHANTIER**.

Code presence, parse success, CI success, or an assistant-authored commit never equals user validation.

## 4. Git / worktree discipline

- `main` is the published/testable line, not a shared development checkout.
- Development normally happens on dedicated branches/worktrees.
- Two agents/chantiers never write in the same worktree.
- Never assume the historical repo folder is the active worktree.
- No destructive reset, force-push, blind clean, or shared-branch rewrite to recover from mistakes.
- Use revert/new commits for published rollback.
- Before promotion, re-fetch `main`, verify the candidate is not behind, inspect the final diff, run relevant gates, and require explicit owner promotion approval.
- When the owner explicitly instructs `push/merge to main`, execute that promotion after the required gates rather than blocking on missing GitHub branch protection.

## 5. Current bootstrap incident / recovery point

Baseline `main` at the start of the recovery: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

Windows configuration already succeeded locally:

- Navidrome detected at the configured local endpoint;
- music library path detected;
- AudioMuse endpoint and token detected without displaying the token;
- `.env` generated locally and ignored.

Recovery branch:

`fix/bootstrap-workflow-security-20260912`

Bootstrap/runtime qualification has reached USER VALIDATED PASS on Windows for the exact runtime candidate recorded in the PR evidence, including API readiness, UI readiness, browser rendering, and clean Ctrl+C shutdown.

## 6. Promotion / next chantier

The bootstrap recovery may be promoted when:

1. security gate passes;
2. required CI/build gates pass;
3. final diff is inspected;
4. runtime behavior has the required user validation;
5. the repository owner explicitly instructs promotion to `main`.

Missing GitHub branch protection is not a blocker.

After promotion, start product work in a new dedicated branch/worktree. The next product tranche is expected to make navigation real and expose the existing Navidrome playlist API in the Waxloom UI.

## 7. End-of-session handoff rule

When the real next step, blocker, architecture, validation state, or security rule changes, update `docs/AI_HANDOFF.md` in the same work cycle. Keep it compact: decisions, exact SHA/branch, evidence, blockers, next test, rollback/checkpoint. Do not copy conversations into Git.

## Mental shortcut

`HANDOFF -> fetch -> repo/worktree/branch/HEAD/CLEAN -> security gate -> minimal change -> exact-head test -> evidence -> explicit owner promotion instruction -> main`
