# Security Policy

Author is an offline-first personal notes app. It encrypts note fields before
sync so routine server storage does not need plaintext note titles or bodies,
but it is not designed or marketed as a hardened zero-knowledge system.

## Security Claims

Current supported claim: Author encrypts synced note fields and account keyrings
on the client, supports recovery-kit, operator recovery, and encrypted local
previous-version recovery flows, and keeps sync conflict handling explicit.

Claims that are not supported yet: independently audited crypto, hardened
zero-knowledge security, enterprise-grade E2EE assurance, reproducible signed
web delivery, or protection from malicious deployed web JavaScript. Those claims
require third-party review and release-distribution hardening beyond the current
repository checks.

## Reporting

Please report security issues privately to the project maintainer instead of
opening a public issue. Include reproduction steps, affected commit or release,
and whether the issue affects web, server, Android, or sync. Operators of forks
should also notify their own users and upstream a report when the issue applies
to Author itself.

Preferred channel:

- GitHub private vulnerability report:
  https://github.com/ivanarena/author/security/advisories/new

If that form is unavailable, contact the repository maintainer privately through
the GitHub profile listed on the repository owner account. Do not include
exploit details in public issues, pull requests, screenshots, logs, or comments
until a fix and disclosure plan are agreed.

Expected handling:

- Initial acknowledgement target: within 7 calendar days.
- Triage target: within 14 calendar days after enough reproduction detail is
  available.
- Critical issues affecting confidentiality, authentication, sync integrity, or
  release signing should receive a fix or mitigation plan before the next
  release.
- Public disclosure should wait until a patched release, mitigation, or written
  non-applicability decision is available.

Supported surface:

- Latest `main` and the latest published release are the only supported security
  targets.
- Older releases may need to upgrade through the documented migration path before
  receiving fixes.
- Security reports about generated dependency code, Gradle wrapper binaries, or
  platform services should include the upstream version and why the issue is
  reachable from Author.

## Current Threat Model

- Local editing and offline access take priority over network availability.
- Signed-in devices keep the material needed to decrypt local synced notes so
  users can continue working after ordinary browser or app restarts.
- Server databases, remote mirrors, local browser profiles, Android devices, and
  backups should still be treated as sensitive.
- Android stores its local workspace in SQLCipher with key material held through
  Android secure preferences, and its optional app lock is a local device
  unlock control. It is not a substitute for protecting the signed-in device or
  sync account.
- Sync conflicts must be explicit. The server must not silently overwrite
  changed user data when `baseVersion` no longer matches.
- `NOTES_SERVER_SECRET`, auth tokens, Turso credentials, release signing keys,
  and database backups must never be exposed in public config, logs, metrics, or
  client bundles.

## Hardening Checklist

- Run the commands in `docs/production-readiness.md` before release.
- Deploy immutable tagged releases rather than a moving development branch.
- Scan complete Git history with the Gitleaks command in
  `docs/publication-checklist.md` before making any fork or repository public.
- Use HTTPS in production.
- Keep `NOTES_SERVER_SECRET` stable and private across restores.
- Back up and restore-test SQLite/libSQL data before upgrades.
- Keep exactly one self-hosted Node process pointed at a local SQLite file.
- Review CodeQL, OpenSSF Scorecard, dependency audit, deprecation, and Trivy
  findings before releases.
- Keep GitHub Actions pinned to full commit SHAs; Renovate tracks the readable
  version comments.
