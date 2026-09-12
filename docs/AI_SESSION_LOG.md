# Waxloom — AI session log

### 2026-09-12 — bootstrap / Windows launcher / public-repo workflow
HEAD before: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
USER VALIDATED: `configure.ps1` detected Navidrome/library/AudioMuse and wrote ignored local `.env` without displaying the AudioMuse token.
USER VALIDATED on `918a7fa08e30e0cb9f7cacd69339f2d677daa11f`: exact-SHA/CLEAN gate PASS, security PASS, Python bootstrap PASS, npm install PASS, API startup PASS, `/api/health` HTTP 200 PASS.
BUG / BLOCKER on `918a7fa`: Vite did not start because `cmd.exe` stripped quoting around `C:\Program Files\nodejs\npm.cmd`; UI readiness FAIL, cleanup executed.
FIX CANDIDATE: Vite now launches directly through `node.exe` + `node_modules/vite/bin/vite.js`; Windows CI smokes this exact launch path.
LOCAL STATE: historical `E:\_Project\Waxloom` remains `HOLD_DIRTY` because old launcher generated untracked `apps/api/uv.lock`; no reset/clean/delete.
DECISION: SIGNAL-style branch/worktree/handoff discipline; no development writes directly to main.
SECURITY: repo public; fail-closed security gate + CI; main observed unprotected, so promotion remains blocked by policy.
RECOVERY BRANCH: `fix/bootstrap-workflow-security-20260912`.
NEXT TEST: fresh remote HEAD, dedicated CLEAN worktree, security PASS, full `dev.ps1`, API+UI readiness, browser render, Ctrl+C cleanup.
ROLLBACK / BASE: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.
