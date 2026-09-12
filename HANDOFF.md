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
7. Do not write directly to `main` for development work.

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

### Server-side main protection

Project policy requires `main` to be protected by GitHub branch protection or a repository ruleset before normal promotion begins. Until this is confirmed active, **promotion to `main` is blocked by policy** even if a candidate passes local tests.

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
- Development happens on dedicated branches/worktrees.
- Two agents/chantiers never write in the same worktree.
- Never assume the historical repo folder is the active worktree.
- No destructive reset, force-push, blind clean, or shared-branch rewrite to recover from mistakes.
- Use revert/new commits for published rollback.
- Before promotion, re-fetch `main`, verify the candidate is not behind, inspect the final diff, run relevant gates, and require explicit human promotion approval.

## 5. Current bootstrap incident / recovery point

Baseline `main` at the start of the recovery: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

Windows configuration already succeeded locally:

- Navidrome detected at the configured local endpoint;
- music library path detected;
- AudioMuse endpoint and token detected without displaying the token;
- `.env` generated locally and ignored.

`main@8aab207` is **NOT USER VALIDATED** as a working Waxloom launch. The last observed blocker is frontend dependency installation resolving `package.json` from the repository root instead of `apps/web`.

Recovery branch:

`fix/bootstrap-workflow-security-20260912`

This branch must:

- resolve repository/application paths canonically;
- run npm from `apps/web` itself, not depend on `--prefix` parsing;
- keep API/UI logs in the current console;
- add the blocking public-repository security gate;
- add durable workflow/worktree/handoff rules;
- remain unpromoted until exact-head Windows validation passes.

## 6. Exact next validation

Use a dedicated local worktree for `fix/bootstrap-workflow-security-20260912` after inventorying existing worktrees. Require branch/HEAD/CLEAN confirmation, then run:

1. `./scripts/security-gate.ps1`
2. `./scripts/dev.ps1`
3. confirm API readiness;
4. confirm Vite UI readiness;
5. confirm the browser opens Waxloom;
6. confirm `/api/health` reports without exposing secrets;
7. stop with `Ctrl+C` and confirm both child processes terminate.

A PASS must be attributed to the exact tested SHA. Do not promote based on a PASS from another SHA.

## 7. End-of-session handoff rule

When the real next step, blocker, architecture, validation state, or security rule changes, update `docs/AI_HANDOFF.md` in the same work cycle. Keep it compact: decisions, exact SHA/branch, evidence, blockers, next test, rollback/checkpoint. Do not copy conversations into Git.

## Mental shortcut

`HANDOFF -> fetch -> repo/worktree/branch/HEAD/CLEAN -> security gate -> minimal change -> exact-head test -> evidence -> human validation -> explicit promotion`
