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
- `auth_rate_limits`
- `trusted_auth_devices`
- `invitation_codes` (legacy, unused by current signup)
- `signup_allowed_emails`
- `schema_migrations`
- `notes`
- `notebooks`
- `entity_changes`
- `entity_tombstones`
- `note_versions`
- `notebook_versions`

`note_versions` and `notebook_versions` keep snapshots for accepted pushes, conflicts, and cleanup. This gives v1 a recovery path without building a full audit UI.

Notes store `title` and `body` as `enc:v2` encrypted text envelopes after the client has
opened them once or synced with key material available. Notebooks store `name` as the same
envelope format. `title_hash`, `body_hash`, and `name_hash` store stable keyed HMAC hashes for
sync comparison and duplicate notebook checks while the encrypted text uses random IVs and
field-specific authenticated data. Clients validate that an existing envelope decrypts before
preserving it; spoofed prefix text is treated as plaintext and encrypted. Legacy plaintext and
`enc:v1` rows are migrated by the browser or Android app before normal reads and sync.
Markdown is not parsed or rendered.

Notes, notebooks, entity changes, tombstones, and version snapshots include `owner_username` so
sync results are scoped to the authenticated account. Legacy token data is stored under
`legacy-token`.

Password-derived client encryption keys use Argon2id for new ciphertext. Existing PBKDF2-derived
and legacy SHA-256-derived password envelopes remain decryptable so clients can republish them
under the active key material during the normal encryption audit.

`trusted_auth_devices` records browsers or Android installs that completed a
password login for an account and presented a local device trust secret. The
server stores only a hash of that trust secret. Accounts with 2FA enabled can
later issue a new session from that device with username plus TOTP code while
the same local trust secret and encryption key material remain on the device.
TOTP seeds are stored in the users table as server-secret-encrypted `srvenc:v1`
envelopes. Keep `NOTES_SERVER_SECRET` stable across deployments and restores;
production deployments must set it explicitly.

`auth_rate_limits` stores temporary hashed login/signup throttle keys so rate
limits survive process restarts and multi-instance Worker execution without
persisting raw IP addresses or usernames.

`signup_allowed_emails` is the server-side allow-list for remote account creation.
Signup only creates an account when the submitted email matches a row in this
table.

Active notebook names are treated as unique after trimming and case-folding. The client prevents duplicates locally; the server rejects duplicate-name pushes as sync conflicts.

## Trash

Moving a note to Trash sets `trashedAt` and keeps the row syncable. Cleanup permanently removes notes whose `trashedAt` is older than 90 days, after writing a final snapshot and an `entity_tombstones` row. Tombstones let stale offline clients receive `deleted_remotely` conflicts instead of recreating cleaned-up rows.

The server starts a cleanup scheduler unless `NOTES_CLEANUP_ENABLED=false`. It runs on startup by default and then every `NOTES_CLEANUP_INTERVAL_MINUTES`.

## Migrations

Server schema upgrades are tracked in `schema_migrations`. Each migration has a forward-only implementation and rollback notes in `apps/web/src/lib/server/db.ts`. Rollback means restoring the pre-upgrade SQLite/Turso backup, then rerunning `aube -F @author/web run db:check` before sending traffic back to the app.
