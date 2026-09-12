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
ROLLBACK / BASE: `8aab2070e067b2f203ce3e8b7ecb85a8d72538f1`.

### 2026-09-12 — functional Navidrome playlists UI
OWNER FEEDBACK: initial browser UI was visually present but functionally a shell; navigation and hero controls were dead placeholders. Product work must provide real behavior or clearly state that a feature is unfinished.
BRANCH: `feat/navidrome-playlists-ui-20260912`, stacked on the validated bootstrap/recovery branch.
PR: `#2` targeting `fix/bootstrap-workflow-security-20260912`.
IMPLEMENTED / NOT USER VALIDATED: working sidebar navigation; Library -> Playlists action; real `/api/playlists` fetch; real playlist cards; `/api/playlists/{playlist_id}` detail fetch; track rendering; loading/error/retry/refresh states; independent Navidrome health status.
UX RULE: Discovery and Imports may be navigable placeholders only when explicitly labelled unfinished; no silent fake buttons.
SECURITY: frontend only calls Waxloom `/api/*`; Navidrome credentials remain server-side.
NEXT TEST: wait for CI PASS, then exact-head dedicated product worktree with real `.env`; verify real playlist list + at least one playlist track list + clean shutdown.
