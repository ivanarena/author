# Agent Guidelines

Author is a minimal local-first notes app. Keep changes small, boring, and aligned with the existing architecture.

## Core Intent

- Preserve the plain-text writing experience. Do not add blocks, rich text, Markdown rendering, sharing, or collaboration unless the product direction changes explicitly.
- Local writes come first. Network activity must never block typing, notebook changes, import/export, or trash actions.
- Treat sync and encryption as user-data safety code. Prefer explicit conflicts over silent overwrites.
- Keep web, server, shared packages, and Android behavior aligned when changing shared contracts.

## Useful Agent Skills

### Local-First Sync

Use this skill when editing `apps/web/src/lib/client/sync.ts`, `apps/web/src/lib/server/hono.ts`, `apps/web/src/lib/server/repository.ts`, `packages/sync-spec`, or Android sync code.

- Read `docs/sync-protocol.md` and `docs/conflict-handling.md` before changing behavior.
- Preserve the `baseVersion` rule: accepted updates advance from the current remote version; mismatches become conflicts.
- Pulls must be cursor-stable through `lastPulledRevision`/`serverRevision`.
- Never drop pending local records while resolving remote changes.
- Add or update tests in `packages/sync-spec` and the relevant web or Android test package for protocol changes.

### Client Storage and Encryption

Use this skill when editing IndexedDB, note encryption, login/session resume, import/export, or note persistence.

- Browser notes store encrypted `title` and `body` envelopes after they have been opened or synced with key material available.
- Stable field hashes support encrypted-field comparison; do not compare encrypted payload strings directly as content equality.
- Keep local-only metadata local: `lastSyncedVersion`, `lastSyncedAt`, sync debug state, and pending status should not become API contract fields by accident.
- If a signed-in browser has no encryption key material, require sign-in again instead of syncing unreadable note content.

### Web UI

Use this skill when editing Svelte components or note CSS under `apps/web/src/lib/components/notes`.

- Preserve the app-first surface: the first screen is the editor, not a landing page.
- Keep the interface quiet and efficient. Avoid decorative layouts, marketing copy, or extra instructional text in the app UI.
- Keep note actions reachable by keyboard and screen readers. Existing buttons and menus should retain useful labels, focus behavior, and disabled states.
- Test responsive changes against the existing `notes-*.css` split instead of creating unrelated styling islands.

### Android Parity

Use this skill when editing `apps/android`.

- Match shared data contracts from `packages/schema` and `packages/api-types`.
- Keep package names, API paths, and sync semantics aligned with the web app.
- For shared behavior changes, update corresponding Kotlin tests or add focused tests under `apps/android/app/src/test`.

### Operations and Deployment

Use this skill when editing Docker, Cloudflare, Turso/libSQL, auth, or cleanup behavior.

- Check `docs/setup.md`, `docs/operations.md`, and `docs/production-readiness.md`.
- Do not expose secrets through public config, metrics, logs, or client bundles.
- Self-hosted local SQLite may mirror to Turso; Cloudflare Workers use Turso directly. Keep that distinction intact.
- Account mutations should sync remote state first when remote sync is enabled.

## Commands

Use Aube. Do not add npm, pnpm, yarn, or bun lockfiles.

```sh
aube install
aube -F @author/web run dev
aube -F @author/web run check
aube -F @author/web run build
aube run test
aube run test:e2e
aube run quality
```

Prefer focused checks while developing, then run the narrowest command that proves the change. For sync or repository changes, run the relevant Vitest suite and consider `aube run test`.

## Code Style

- Follow existing Svelte, TypeScript, Kotlin, and CSS patterns before introducing new abstractions.
- Keep shared request/response shapes in `packages/api-types` and shared entities in `packages/schema`.
- Keep executable protocol expectations in `packages/sync-spec`; do not duplicate protocol logic only in prose.
- Do not rewrite unrelated files or normalize formatting outside the edited scope.
- Respect existing dirty worktrees. Never revert changes you did not make unless asked.

## Documentation

Update docs when changing:

- sync behavior: `docs/sync-protocol.md` or `docs/conflict-handling.md`
- persistence schema: `docs/database-schema.md`
- deployment, auth, or runtime config: `docs/setup.md`, `docs/operations.md`, or `docs/production-readiness.md`
- package-manager workflow: `docs/package-manager.md`
