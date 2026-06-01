# Production Readiness Roadmap

This is the launch and release roadmap for Author across the web app, API,
Docker image, Cloudflare/Turso deployment, and Android APK. The detailed setup
steps live in `docs/setup.md`, `docs/operations.md`, and
`apps/android/README.md`.

## Product Edge

Author should compete by staying narrow and trustworthy:

- Plain-text title/body notes, no blocks, no rich-text storage, no sharing, and
  no collaboration state.
- Local writes first: typing, notebook changes, import/export, and trash actions
  must keep working without the network.
- Encrypted sync fields with stable field hashes, explicit conflicts, local
  repair diagnostics, and pull-cursor recovery on web and Android.
- Self-hostable Node/SQLite, Cloudflare/Turso hosting, Docker image publishing,
  Android parity, and a small codebase operators can inspect.

Do not compete by overstating security. As of May 29, 2026, Standard Notes,
Obsidian Sync, Notesnook, and Joplin all publish E2EE/security documentation,
and Standard Notes and Obsidian publish independent audit claims or reports.
Author can honestly claim local-first encrypted sync with documented recovery
and a clear browser threat model. It cannot claim audited crypto, hardened
zero-knowledge E2EE, key transparency, reproducible signed web delivery, or
enterprise-grade assurance until the external work below is complete.

Before publishing marketing or security copy, re-check official competitor
pages:

- Standard Notes security and audit pages.
- Obsidian security, Sync security, and encryption-upgrade pages.
- Notesnook security/E2EE pages.
- Joplin E2EE documentation.

## Current Baseline

Already in place:

- Encrypted note titles, note bodies, and notebook names before sync.
- Account keyrings with password wrapping and recovery-kit wrapping.
- AES-GCM field envelopes with field-specific authenticated data.
- Stable HMAC field hashes for encrypted-field comparison.
- Client-side Argon2id password work and SCRAM-style account proofs.
- Base-version sync conflicts and cursor-stable pull revisions.
- Web and Android repair diagnostics for missing encryption material, stale
  encryption audits, invalid pull cursors, conflicts, and local sync metadata.
- Local pull-cursor reset that forces a revision-0 recovery pull without
  deleting pending records.
- Encrypted local note snapshots before edits and Trash/restore transitions,
  with a restore-previous-version action for the current note.
- Remote notebook delete/remap handling that avoids orphaned note assignments.
- Password-change interruption handling that preserves the replacement session
  and records diagnostics when final sync fails.
- Local, CI, Docker, Cloudflare, and Android release gates.
- GitHub Actions pinned to immutable SHAs, with Renovate-managed version
  comments.
- CodeQL, OpenSSF Scorecard, Trivy image scanning, SBOM/provenance generation,
  and Cosign image signing. CodeQL and Scorecard upload SARIF artifacts for
  private-repo review even when GitHub code scanning is not enabled.
- Signed Android release automation that requires green CI, Docker, and
  Cloudflare Deploy runs for the exact release commit.

Known limits:

- Hosted web code is mutable; XSS, a compromised origin, or a malicious deployed
  bundle can read passwords, local key material, and decrypted notes.
- Some sync metadata remains plaintext: ids, timestamps, versions, device ids,
  notebook assignments, deletion markers, and stable hashes.
- There is no independent security review.
- There is no key transparency log, reproducible signed web app, or native
  desktop distribution.
- Release readiness still depends on external drills: staging credentials,
  backup restores, SARIF review, release-key custody, and security-workflow
  review.

## Roadmap

### P0: Keep The Local Gate Boring

Goal: every release candidate should be repeatable from a clean checkout and
from an operator workstation that may contain ignored runtime artifacts.

Required:

- Keep `aube run release:verify` green.
- Keep `aube run release:verify:local` green before release candidates.
- Keep `aube run release:verify:connected` green whenever an emulator or device
  is available.
- Keep `aube run docker:verify` green before publishing a container.
- Keep Android `versionName` aligned with the release tag and `versionCode`
  strictly newer than the previous Android release.
- Keep format checks scoped to source files so ignored caches such as Trivy,
  Playwright, Gradle, SQLite, and `.data` never break release verification.
- Treat dependency audit failures, deprecations, Docker scan failures, release
  lint failures, and connected Android smoke failures as release blockers.

Acceptance:

- Local release verification passes on a normal developer machine.
- The Android release version check rejects stale build metadata before tags are
  published.
- Docker image scan reports zero high/critical OS or library findings.
- Connected Android instrumentation passes on release-candidate changes that
  touch Android, sync, storage, auth, encryption, or shared contracts.

### P0: Prove The Deployment

Goal: do not call a public deployment production-ready until the deployed system,
restored data, and release artifacts have been exercised outside local tests.

Required external blockers:

- Run Cloudflare/Turso staging smoke with isolated staging credentials.
- Restore a fresh SQLite or Turso backup into a separate environment and run
  `aube -F @author/web run db:check`.
- Review the Trivy SARIF uploaded by CI for the release commit.
- Review CodeQL and OpenSSF Scorecard SARIF artifacts, or code-scanning alerts
  if code scanning is enabled, for the release commit.
- Clear or explicitly accept remaining Scorecard findings before public release.
  As of this pass, repo-setting/practice findings such as branch protection,
  code-review enforcement, OpenSSF best-practices badge status, fuzzing coverage,
  Gradle wrapper binary review, and Docker npm-command pinning require either an
  admin/platform change or a written exception in release notes.
- Verify the release commit has successful `CI`, `Docker`, and
  `Cloudflare Deploy` workflow runs before publishing release notes.
- Verify Cosign-signed container images and protected Android release keys.
- Verify Android update notifications with the configured manifest URL or
  release URL before distributing a sideloaded APK.
- Confirm production has real `NOTES_LOGIN_PASSWORD` and `NOTES_SERVER_SECRET`,
  HTTPS, server-only Turso tokens, authenticated metrics, enabled backup or
  managed export flow, and the Cloudflare Cron cleanup trigger.

Acceptance:

- Staging smoke mutates only the dedicated staging account and passes pull,
  push, stale-write conflict, encrypted payload, login/session, and cleanup
  checks.
- A restored backup passes `db:check` before production upgrade traffic resumes.
- Release artifacts are signed and traceable to the exact commit whose gates
  passed.

### P1: Reduce Data-Loss Risk

Goal: make the most dangerous local workflows tested and recoverable before
adding new product surface.

Required:

- Keep focused tests for editor recovery, debounced save, import/export, sync
  queuing, conflict resolution, and account/session destructive actions.
- Add regression tests when changing controller action modules, especially
  editor, archive, library, sync, and account flows.
- Keep pending local records through failed sync, failed password rotation,
  failed imports, remote mirror errors, and cursor reset recovery.
- Keep local note/version history as plain-text recovery, not rich-text history
  or collaboration state.
- Keep Markdown/frontmatter import/export portable and covered.

Acceptance:

- A browser reload during unsaved typing restores draft text.
- Import/export never closes settings unexpectedly and never blocks local
  editing after completion or failure.
- Sync paused by import/export resumes without dropping pending changes.
- Conflict choices keep local, remote, newer/older, and duplicate-both behavior
  explicit.
- Restore Previous Version recovers the newest encrypted local snapshot as a
  pending note edit and never revives permanently deleted note history.

### P1: Tighten Security Claims And Assurance

Goal: improve privacy without promising more than the delivery model can prove.

Required:

- Keep `SECURITY.md`, privacy, terms, sync protocol, and production docs aligned
  on "encrypted sync, not hardened zero-knowledge."
- Commission an independent security review before claiming audited crypto,
  hardened zero-knowledge, competitor-grade E2EE, or enterprise assurance.
- Model any metadata-minimization work before implementation; do not encrypt
  relationship metadata in a way that breaks conflict repair, trash cleanup, or
  record-limit checks.
- Treat future crypto changes as versioned migrations with web and Android
  fixtures.
- Evaluate a signed native desktop app or reproducible static web bundle for
  users who need stronger protection from mutable hosted JavaScript.

Acceptance:

- Threat-model text distinguishes encrypted sync from immutable-client E2EE.
- Old clients fail closed instead of corrupting encrypted data.
- Password changes rewrap the account keyring without rotating note ciphertext.
- Recovery-kit and operator-assisted recovery drills prove the same data key is
  restored and existing sessions/trusted-device login are revoked.

### P2: Bring Android To First-Class Release Quality

Goal: Android should be a peer client, not a sidecar.

Required:

- Keep Kotlin models, API paths, and sync semantics aligned with
  `packages/schema`, `packages/api-types`, and `packages/sync-spec`.
- Keep debug unit/lint/build, release lint/build, and connected instrumentation
  in the release gate.
- Keep SQLCipher database storage, Keystore-backed database keys, Android backup
  exclusions, HTTPS release URL enforcement, and server-only Turso credentials.
- Add biometric or device-credential app lock as a local unlock control without
  changing sync encryption contracts.
- Keep Android update notification checks documented and smoke-tested.

Acceptance:

- Android passes unit, lint, debug, release, and connected smoke checks for
  release candidates.
- Shared sync/encryption changes include Kotlin tests or connected smoke
  coverage.
- App lock protects casual local access while preserving offline-first writes
  after unlock.

### P2: Make Operations Observable

Goal: operators should know whether sync, cleanup, backup, and auth are healthy
without reading database rows by hand.

Required:

- Keep `/api/health` public and small.
- Keep `/api/metrics` authenticated by default and free of secrets, tokens, note
  content, recovery codes, and Turso credentials.
- Monitor HTTP counts/errors/duration buckets, scheduled backup freshness,
  cleanup state, and remote-sync state.
- Keep login/signup throttles database-backed and hashed.
- Keep logs useful for scheduler and remote mirror failures without leaking
  sensitive values.

Acceptance:

- A production deploy can answer whether the app is alive, whether sync is
  failing, whether backups are stale, and whether cleanup runs.
- Operators have a documented restore path before every schema migration.

### P3: Polish The Writing Experience Without Expanding Scope

Goal: improve daily feel while preserving the plain-text surface.

Allowed:

- Better keyboard navigation, focus behavior, search responsiveness, empty
  states, typography controls, and accessible labels.
- Browsable plain-text note history beyond the current latest-snapshot restore.
- Small settings improvements that reduce support burden.

Not allowed without a product-direction change:

- Blocks, rich text storage, Markdown rendering, slash commands, public sharing,
  collaborative editing, comments, presence, or server-dependent typing.

Acceptance:

- The editor remains the first screen.
- The note model remains title plus body.
- New controls retain keyboard and screen-reader affordances.

## Required Commands

Run from the repo root unless noted:

```sh
aube run deps:check
aube run release:version:check
aube run quality
aube audit --prod
aube audit --audit-level high
aube deprecations --transitive --exit-code
aube run test:coverage
aube run test:e2e
aube -F @author/web run build
aube -F @author/web run cf:build
aube run android:verify
aube run android:verify:release
aube run android:verify:connected
aube run docker:verify
```

When staging credentials exist:

```sh
aube run staging:verify
```

If Playwright has not been installed on the machine:

```sh
aube -F @author/web exec -- playwright install chromium
```

## Release Decision

Ready for a private or self-hosted release when:

- P0 local and deployment gates pass.
- Restore drills and staging smoke pass.
- Docs accurately describe current security limits.
- No high/critical dependency, image, CodeQL, or Scorecard issue is unresolved
  without a written exception.
- Android release artifacts are signed and update notifications are verified if
  the APK is distributed.

Ready for a public competitor-grade security claim only when:

- An independent security review has been completed and remediations are
  tracked.
- Distribution hardening addresses mutable web-code risk for the target claim.
- The claim has matching docs, tests, migration fixtures, and recovery drills.
