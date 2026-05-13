# Database Schema

## Local IndexedDB

Dexie database: `author`

Tables:

- `notes`
- `notebooks`
- `devices`
- `syncMeta`
- `conflicts`

Local notes and notebooks include the shared schema fields plus:

- `lastSyncedVersion`
- `lastSyncedAt`

Those fields are local-only and provide the base version used during sync.

## Server SQLite/libSQL

Tables:

- `devices`
- `users`
- `auth_sessions`
- `invitation_codes`
- `schema_migrations`
- `notes`
- `notebooks`
- `entity_changes`
- `entity_tombstones`
- `note_versions`
- `notebook_versions`

`note_versions` and `notebook_versions` keep snapshots for accepted pushes, conflicts, and cleanup. This gives v1 a recovery path without building a full audit UI.

Notes store `title` and `body` as `enc:v1` encrypted text envelopes after the client has
opened them once. `title_hash` and `body_hash` store stable keyed hashes for sync comparison while
the encrypted text uses random IVs. Legacy plaintext rows are migrated by the browser before normal reads and sync.
Markdown is not parsed or rendered.

Notes, notebooks, entity changes, tombstones, and version snapshots include `owner_username` so
sync results are scoped to the authenticated account. Legacy token data is stored under
`legacy-token`.

Active notebook names are treated as unique after trimming and case-folding. The client prevents duplicates locally; the server rejects duplicate-name pushes as sync conflicts.

## Trash

Moving a note to Trash sets `trashedAt` and keeps the row syncable. Cleanup permanently removes notes whose `trashedAt` is older than 90 days, after writing a final snapshot and an `entity_tombstones` row. Tombstones let stale offline clients receive `deleted_remotely` conflicts instead of recreating cleaned-up rows.

The server starts a cleanup scheduler unless `NOTES_CLEANUP_ENABLED=false`. It runs on startup by default and then every `NOTES_CLEANUP_INTERVAL_MINUTES`.

## Migrations

Server schema upgrades are tracked in `schema_migrations`. Each migration has a forward-only implementation and rollback notes in `apps/web/src/lib/server/db.ts`. Rollback means restoring the pre-upgrade SQLite/Turso backup, then rerunning `aube -F @author/web run db:check` before sending traffic back to the app.
