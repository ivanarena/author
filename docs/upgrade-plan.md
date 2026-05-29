# Upgrade Plan

Author should become more reliable, safer, and more polished without becoming a
block editor, collaboration suite, or enterprise workspace. This plan is ordered
by data-safety value first.

## Non-Negotiables

- Keep the first screen the editor.
- Keep note content plain text: title plus body.
- Keep local writes ahead of network writes.
- Keep conflicts explicit; never silently overwrite changed user data.
- Keep sync and encryption behavior aligned across web, server, shared packages,
  and Android.

## Current Baseline

Already in place:

- Encrypted note titles, bodies, and notebook names before sync.
- Argon2id password-derived key material and SCRAM-style account proofs.
- AES-GCM envelopes with field-specific additional authenticated data.
- Account data-key keyrings with password wrapping and recovery-kit wrapping.
- Stable HMAC field hashes for encrypted-field comparison.
- Base-version sync conflicts and cursor-stable pull revisions.
- Web and Android repair diagnostics for missing encryption material, stale
  encryption audits, local sync metadata, conflicts, and pull cursor recovery.
- Local pull-cursor reset tooling that forces a revision-0 recovery pull without
  touching local notes.
- Remote notebook delete/remap handling clears or remaps local note assignments
  instead of leaving orphaned notebook links.
- Password-change interruption handling preserves the replacement session and
  records sync diagnostics when the final post-change sync fails on web and
  Android.
- Web, Node, Cloudflare, Docker, and Android release checks in CI.
- GitHub Actions are pinned to immutable commit SHAs with Renovate-managed
  version comments.
- Free CodeQL and OpenSSF Scorecard workflows run alongside the main release
  gates.
- A local `aube run release:verify` gate.
- Signed APK releases require green CI, Docker scan, and Cloudflare deploy runs
  for the exact release commit.
- A connected Android release gate exists for emulator/device-backed smoke
  checks when release hardware is available.

Remaining limitations:

- Hosted web code is mutable, so web-origin compromise can still read passwords,
  key material, and decrypted note content.
- Some sync metadata remains plaintext: ids, timestamps, versions, device ids,
  notebook assignments, and deletion markers.
- There is no independent crypto/security audit.
- There is no key transparency log, reproducible signed web app, or native
  desktop app.
- Operational production readiness still requires real staging credentials,
  backup restore drills, image scan review, signed release handling, and review
  of the free CodeQL/OpenSSF findings.

## Phase 1: Release Discipline

Goal: make every release candidate repeatable and boring.

- Use `aube run release:verify` for the default local gate.
- Use `aube run release:verify:local` before release candidates to include
  Android release lint/build validation with an HTTPS API URL.
- Use `aube run release:verify:connected` for release candidates when an
  Android emulator or physical device is available.
- Use `aube run docker:verify` before publishing a container.
- Review CodeQL, OpenSSF Scorecard, dependency audit, deprecation, and Trivy
  findings before releases.
- Use `aube run staging:verify` only with isolated staging credentials.
- Keep Docker scan failures, dependency audit failures, and deprecations as
  release blockers.
- Restore a fresh backup and run `db:check` before production upgrades.
- Publish releases only after CI, Docker, and Cloudflare Deploy are green for
  the exact release commit.

Acceptance:

- The release candidate passes local gates.
- Connected Android smoke passes when an emulator or device is available.
- Staging smoke passes against non-production data.
- A restored backup passes `db:check`.
- Docker scan artifacts are reviewed.
- CodeQL and OpenSSF Scorecard findings are reviewed or explicitly accepted.
- GitHub release automation rejects commits without green CI, Docker, and
  Cloudflare Deploy runs.

## Phase 2: E2EE Hardening

Goal: improve privacy claims without overstating the browser threat model.

- Keep the protocol-level crypto specification current before changing envelope
  formats again.
- Keep recovery-key tooling additive: recovery wraps must preserve local-first
  use and must not require rewriting note data in place.
- Prefer additive key records over rewriting note data in place.
- Evaluate a signed native desktop client or reproducible static web bundle for
  users who need stronger guarantees than mutable hosted JavaScript.
- Consider metadata minimization only after modeling sync costs and conflict
  handling. Relationship metadata must not be encrypted in a way that makes
  conflict repair or trash cleanup unsafe.
- Commission an external security review before claiming hardened
  zero-knowledge, audited crypto, or competitor-grade E2EE.
- Define the next crypto upgrade as a versioned migration with Android and web
  fixtures before changing envelope algorithms, metadata binding, or recovery
  records.

Acceptance:

- Threat model documents distinguish encrypted sync from hardened E2EE.
- New crypto formats have migration tests on web and Android.
- Old clients fail closed instead of corrupting encrypted data.
- Password changes rewrap the keyring and recovery tests prove the same data
  key is restored.

## Phase 3: Reliability and Recovery

Goal: make data-loss paths observable and recoverable.

- Keep password-change sync interruption coverage aligned across clients.
- Keep repair diagnostics current for stale local metadata, missing encryption
  material, and cursor reset recovery.
- Keep note/version history visible enough for users to recover from mistakes
  without adding rich-text history semantics.
- Keep import/export tests focused on Markdown/frontmatter portability.

Acceptance:

- Pending local records survive failed sync, failed password rotation, and remote
  mirror errors.
- Recovery behavior is tested in web and Android suites when shared contracts
  change.
  Web diagnostics and cursor-reset behavior have focused unit coverage; Android
  parity is verified through the debug compile/unit/lint release gate until the
  next connected-device smoke pass is available.

## Phase 4: Writing Experience

Goal: make the app feel better without adding conceptual weight.

- Improve keyboard navigation and focus behavior.
- Keep quick search focus available without changing the editor-first surface.
- Improve search speed and empty-state clarity.
- Keep typography controls small and predictable.
- Add note history/recovery only as plain-text versions.
- Avoid blocks, rich text storage, slash commands, public sharing, and
  collaboration primitives.

Acceptance:

- The editor remains the first screen.
- The note model remains title/body plain text.
- New UI keeps accessible labels, disabled states, and mobile behavior.

## Phase 5: Android Parity

Goal: keep Android a first-class client, not a sidecar.

- Keep shared contracts aligned with `packages/schema`, `packages/api-types`, and
  `packages/sync-spec`.
- Run debug and release Android verification before release candidates.
- Add connected-device smoke runs for release candidates when an emulator is
  available.
- Consider biometric app lock as a local unlock control without changing the
  sync encryption contract.

Acceptance:

- Android unit, lint, debug build, and release build checks pass.
- Shared behavior changes include Kotlin tests or focused Android test coverage.
