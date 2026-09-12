# Waxloom — AI session log

### 2026-09-12 — bootstrap / Windows launcher / public-repo workflow
HEAD before: `main@8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`
USER VALIDATED: `configure.ps1` detected Navidrome/library/AudioMuse and wrote ignored local `.env` without displaying the AudioMuse token.
USER VALIDATED: runtime candidate `1d774b5a87d8646d1dd30baea2745d8e4ac88dc9` reached API ready, UI ready/browser rendering, and clean Ctrl+C shutdown from the dedicated worktree.
AUTOMATED GATE PASS: public-repository security gate, PowerShell parser, API install/import, web build, direct Node/Vite smoke.
DECISION: adopt SIGNAL-style branch/worktree/handoff discipline; normal development remains off `main`.
OWNER POLICY: GitHub branch protection/rulesets are optional, not a promotion blocker. Do not push/merge to `main` by default; when the repository owner explicitly instructs `push/merge to main`, perform the promotion after security/build/diff gates. Owner authorization does not permit secrets, force-push, destructive history rewrite, or failed-gate bypass.
SECURITY: repository is public; fail-closed tracked-secret gate and CI gate remain mandatory.
RECOVERY BRANCH: `fix/bootstrap-workflow-security-20260912`.
NEXT PRODUCT TRANCHE AFTER OWNER-AUTHORIZED PROMOTION: real navigation + real Navidrome playlists in UI; dead/unimplemented controls must be disabled rather than fake-clickable.
ROLLBACK / BASE: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.
