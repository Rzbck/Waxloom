# Security policy

Waxloom is a public repository. Do not publish credentials, cookies, private keys, local provider databases, user library exports, downloaded media, or private configuration.

## Secret exposure

If a credential or secret is suspected to have been committed or pushed:

1. stop publication/promotion;
2. rotate or revoke the credential immediately;
3. remove it from the candidate and verify the tracked history/diff;
4. run `scripts/security-gate.ps1`;
5. document the incident without reproducing the secret value.

A secret that has reached a public Git host must be treated as compromised even if history is later rewritten.

## Local configuration

Real credentials belong only in ignored local configuration such as `.env`. Public examples must contain placeholders only.

The browser-facing application must never receive backend provider credentials. Secrets remain server-side.

## Reporting

Do not paste live credentials into public issues, pull requests, logs, screenshots, or discussions. Report security concerns without secret values and rotate any potentially exposed credential first.
