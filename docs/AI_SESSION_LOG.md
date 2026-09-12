# Waxloom — AI session log

### 2026-09-12 — bootstrap / Windows launcher / public-repo workflow
HEAD before: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
USER VALIDATED: `configure.ps1` detected Navidrome/library/AudioMuse and wrote ignored local `.env` without displaying the AudioMuse token.
IMPLEMENTED / NOT USER VALIDATED: initial FastAPI + React/Vite scaffold and Navidrome adapter.
BUG / BLOCKER: `dev.ps1` on main resolved npm but npm searched repository-root `package.json` instead of `apps/web/package.json`.
DECISION: adopt SIGNAL-style branch/worktree/handoff discipline; no more development writes directly to main.
SECURITY: repository is public; fail-closed tracked-secret gate and CI gate introduced; main currently observed unprotected and promotion-blocked by policy.
RECOVERY BRANCH: `fix/bootstrap-workflow-security-20260912`.
NEXT TEST: dedicated worktree, exact remote SHA, CLEAN, security gate, `dev.ps1`, API/UI readiness, Ctrl+C cleanup.
ROLLBACK / BASE: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.
