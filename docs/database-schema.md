# Database Schema

## Local IndexedDB

Dexie database: `author-notes`

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
- `notes`
- `notebooks`
- `note_versions`
- `notebook_versions`

`note_versions` and `notebook_versions` keep snapshots for accepted pushes, conflicts, and cleanup. This gives v1 a recovery path without building a full audit UI.

Notes store `title` and `body` as `enc:v1` encrypted text envelopes after the client has
opened them once. Legacy plaintext rows are migrated by the browser before normal reads and sync.
Markdown is not parsed or rendered.

Active notebook names are treated as unique after trimming and case-folding. The client prevents duplicates locally; the server rejects duplicate-name pushes as sync conflicts.

## Trash

Moving a note to Trash sets `trashedAt` and keeps the row syncable. Cleanup permanently removes notes whose `trashedAt` is older than 90 days, after writing a final snapshot.

The server starts a cleanup scheduler unless `NOTES_CLEANUP_ENABLED=false`. It runs on startup by default and then every `NOTES_CLEANUP_INTERVAL_MINUTES`.
