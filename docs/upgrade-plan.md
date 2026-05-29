# Upgrade Plan

Author should become more reliable, safer, and more polished without becoming a
block editor, collaboration suite, or enterprise workspace. The canonical
release checklist and production roadmap live in
`docs/production-readiness.md`; this file keeps the product upgrade sequence in
the same priority order.

## Non-Negotiables

- Keep the first screen the editor.
- Keep note content plain text: title plus body.
- Keep local writes ahead of network writes.
- Keep conflicts explicit; never silently overwrite changed user data.
- Keep sync and encryption behavior aligned across web, server, shared packages,
  and Android.
- Keep security copy honest: encrypted sync is supported; audited hardened
  zero-knowledge E2EE is not supported yet.

## Phase 0: Release Discipline

Goal: make release candidates repeatable and boring.

Required:

- Keep `aube run release:verify` green for the default local gate.
- Keep `aube run release:verify:local` green before release candidates.
- Keep `aube run release:verify:connected` green when an emulator or device is
  available.
- Keep `aube run docker:verify` green before publishing a container.
- Keep Android release metadata aligned: `versionName` must match the release
  tag and `versionCode` must increase from the previous Android release.
- Keep formatting scoped to source files so ignored runtime caches do not break
  local verification.
- Review dependency audit, deprecation, Trivy, CodeQL, and OpenSSF Scorecard
  findings before releases.
- Restore a fresh backup and run `db:check` before production upgrades.
- Publish release notes only after CI, Docker, and Cloudflare Deploy are green
  for the exact release commit.

Acceptance:

- Local release gates pass.
- Android release metadata cannot lag behind the latest published tag.
- Connected Android smoke passes when release hardware is available.
- Staging smoke passes against non-production data.
- A restored backup passes `db:check`.
- Docker scan artifacts and security workflow findings are reviewed.

## Phase 1: Data Safety And Recovery

Goal: make data-loss paths observable, tested, and recoverable.

Required:

- Keep pending local records through failed sync, failed password rotation,
  failed imports, remote mirror errors, and pull-cursor reset recovery.
- Keep focused coverage around controller action modules that can lose or move
  user data: editor, archive, library, sync, and account/session flows.
- Keep repair diagnostics current for stale local metadata, missing encryption
  material, denormalized notebook assignments, conflicts, and cursor reset
  recovery.
- Keep local note/version history as plain-text recovery, not rich-text history
  or collaboration state.
- Keep Markdown/frontmatter import/export portable and tested.

Acceptance:

- Browser reload recovery preserves unsaved editor text.
- Import/export success and failure do not block later local editing.
- Sync queued during import/export resumes instead of dropping pending records.
- Conflict resolution remains explicit across web, server, shared tests, and
  Android.
- Restore Previous Version recovers the newest encrypted local snapshot as a
  pending note edit and never revives permanently deleted note history.

## Phase 2: E2EE Hardening

Goal: improve privacy claims without overstating the browser threat model.

Required:

- Keep the protocol-level crypto specification current before changing envelope
  formats, field hashes, keyrings, or recovery records.
- Keep recovery-key tooling additive: recovery wraps must preserve local-first
  use and must not require rewriting note data in place.
- Prefer additive key records over rewriting note ciphertext in place.
- Evaluate a signed native desktop client or reproducible static web bundle for
  users who need stronger guarantees than mutable hosted JavaScript.
- Consider metadata minimization only after modeling sync costs and conflict
  repair. Relationship metadata must not be encrypted in a way that makes trash
  cleanup, duplicate checks, or repair unsafe.
- Commission an external security review before claiming audited crypto,
  hardened zero-knowledge, competitor-grade E2EE, or enterprise assurance.
- Define future crypto upgrades as versioned migrations with web and Android
  fixtures.

Acceptance:

- Threat-model documents distinguish encrypted sync from hardened E2EE.
- New crypto formats have migration tests on web and Android.
- Old clients fail closed instead of corrupting encrypted data.
- Password changes rewrap the keyring and recovery tests prove the same data key
  is restored.

## Phase 3: Android Parity

Goal: keep Android a first-class client.

Required:

- Keep Kotlin models, API paths, sync semantics, and encryption behavior aligned
  with `packages/schema`, `packages/api-types`, and `packages/sync-spec`.
- Run debug and release Android verification before release candidates.
- Run connected-device smoke for release candidates when an emulator or device
  is available.
- Add biometric or device-credential app lock as a local unlock control without
  changing the sync encryption contract.
- Keep sideloaded update notification checks documented and verified.

Acceptance:

- Android unit, lint, debug build, release build, and connected smoke checks
  pass.
- Shared behavior changes include Kotlin tests or focused Android smoke
  coverage.

## Phase 4: Operations And Observability

Goal: make production state visible without exposing sensitive data.

Required:

- Keep `/api/health` and authenticated `/api/metrics` useful for uptime, HTTP
  error/latency buckets, backup freshness, cleanup, and remote-sync state.
- Keep scheduled SQLite backups and Turso managed-export/restore paths drilled.
- Keep Cloudflare Cron cleanup enabled for Turso-primary deployments.
- Keep metrics, logs, config, and client bundles free of secrets, tokens,
  recovery codes, note contents, and Turso credentials.
- Keep exactly one app process pointed at each local SQLite database.

Acceptance:

- Operators can answer whether backups are fresh, cleanup is running, and
  remote sync is healthy after deploy.
- Every schema migration has a restore-before-upgrade path.

## Phase 5: Writing Experience

Goal: make the app feel better without adding conceptual weight.

Allowed:

- Improve keyboard navigation, focus behavior, quick search, search speed,
  empty-state clarity, typography controls, and accessible labels.
- Add browsable plain-text history beyond the current latest-snapshot restore.
- Polish settings where it reduces support burden.

Avoid unless product direction changes explicitly:

- Blocks, rich text storage, Markdown rendering, slash commands, public sharing,
  collaboration primitives, comments, or server-dependent typing.

Acceptance:

- The editor remains the first screen.
- The note model remains title/body plain text.
- New UI keeps accessible labels, disabled states, and mobile behavior.
