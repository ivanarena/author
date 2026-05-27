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
- `auth_challenges`
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

Notes store `title` and `body` as `enc:v3` encrypted text envelopes after the client has
opened them once or synced with key material available. Notebooks store `name` as the same
envelope format. `title_hash`, `body_hash`, and `name_hash` store stable keyed HMAC hashes for
sync comparison and duplicate notebook checks while the encrypted text uses random IVs and
field-specific authenticated data. Clients validate that an existing envelope decrypts before
preserving it; spoofed prefix text is treated as plaintext and encrypted. Plaintext rows are
encrypted by the browser or Android app before normal reads and sync.
Markdown is not parsed or rendered.

Devices are keyed by `(owner_username, id)` so two accounts using the same
browser- or Android-generated device id keep separate labels, trusted-device
records, and session metadata. Notes, notebooks, entity changes, tombstones,
and version snapshots also include `owner_username` so sync results are scoped
to the authenticated account. Legacy token data is stored under `legacy-token`.

Password-derived client encryption keys use Argon2id-only material, and runtime clients do not
keep pre-Argon2 or pre-`enc:v3` compatibility paths. Older installs must migrate through a release
that republishes data as `enc:v3` before running this version. Current clients fail closed when
they see older local or remote note envelopes, rather than rewriting old ciphertext as plaintext.
Server-side account password verifiers are Argon2id SCRAM-style
`argon2id-scram-sha256:v1` records. The browser or Android client runs Argon2id
and sends a challenge-bound proof; the server stores only the random salt,
Argon2id parameters, stored key, and server key, then verifies logins with
SHA-256/HMAC work. The current server migration refuses previous verifier rows
and removes the obsolete verifier iteration column instead of preserving dead
password metadata.

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

`auth_challenges` stores short-lived password proof challenge state. Challenges
are single-use and deleted during proof verification.

`signup_allowed_emails` is the server-side allow-list for remote account creation.
Signup only creates an account when the submitted email matches a row in this
table.

Active notebook names are treated as unique after trimming and case-folding. The client prevents duplicates locally; the server rejects duplicate-name pushes as sync conflicts.

The server keeps active-count indexes on `(owner_username, deleted_at, id)` for
notes and notebooks. These support sync payload checks and the optional
Turso-budget record-limit estimate without scanning the full note tables on
every push.

## Trash

Moving a note to Trash sets `trashedAt` and keeps the row syncable. Cleanup permanently removes notes whose `trashedAt` is older than 90 days, after writing a final snapshot and an `entity_tombstones` row. Tombstones let stale offline clients receive `deleted_remotely` conflicts instead of recreating cleaned-up rows.

The server starts a cleanup scheduler unless `NOTES_CLEANUP_ENABLED=false`. It runs on startup by default and then every `NOTES_CLEANUP_INTERVAL_MINUTES`.

## Migrations

Server schema upgrades are tracked in `schema_migrations`. Each migration has a forward-only implementation and rollback notes in `apps/web/src/lib/server/db.ts`. Rollback means restoring the pre-upgrade SQLite/Turso backup, then rerunning `aube -F @author/web run db:check` before sending traffic back to the app.
