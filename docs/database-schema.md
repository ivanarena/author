# Database Schema

## Web Local IndexedDB

Dexie database: `author`, current schema version: 6.

Tables:

- `notes`
- `notebooks`
- `noteSnapshots`
- `devices`
- `secrets`
- `syncMeta`
- `conflicts`

Local notes and notebooks include the shared schema fields plus:

- `lastSyncedVersion`
- `lastSyncedAt`

Those fields are local-only and provide the base version used during sync.
Notes also keep `isFavorite` as shared note metadata so favorite filters sync
with the rest of the note record.

`noteSnapshots` stores local-only encrypted note snapshots before text edits,
Trash moves, and restore-from-history actions. Snapshots use the same note
field envelope context as the source note, are pruned to the newest 50
snapshots per note, and are deleted when a note is permanently deleted. They do
not sync or become API contract fields.

`secrets` stores local-only browser secrets that must not become shared API
fields. The current entry is the trusted-device secret used to prove this
browser during trusted-device sign-in. Legacy installs migrate that value out
of `localStorage`; it remains readable to same-origin JavaScript, so the web
threat model still treats XSS or a compromised deployed bundle as able to use
the active browser session.

## Server SQLite/libSQL

Server schema migrations are tracked through version 20 in
`apps/web/src/lib/server/db.ts`.

Tables:

- `devices`
- `users`
- `auth_sessions`
- `auth_rate_limits`
- `auth_challenges`
- `trusted_auth_devices`
- `signup_allowed_emails`
- `sync_meta`
- `schema_migrations`
- `notes`
- `notebooks`
- `entity_changes`
- `entity_tombstones`
- `note_versions`
- `notebook_versions`

`note_versions` and `notebook_versions` keep snapshots for accepted pushes,
conflicts, and cleanup. This gives v1 a recovery path without building a full
audit UI. Snapshots older than 365 days are pruned by cleanup so long-lived
sync accounts do not accumulate unbounded version rows.

Notes store `title` and `body` as `enc:v4` encrypted text envelopes after the client has
opened them once or synced with key material available. Notebooks store `name` as the same
envelope format. `title_hash`, `body_hash`, and `name_hash` store stable keyed HMAC hashes for
sync comparison and duplicate notebook checks while the encrypted text uses random IVs and
field-specific authenticated data. Clients validate that an existing envelope decrypts before
preserving it; spoofed prefix text is treated as plaintext and encrypted. Plaintext rows are
encrypted by the browser or Android app before normal reads and sync.
Markdown is not parsed or rendered.
Notes store `is_favorite` as a boolean integer on both `notes` and
`note_versions`, defaulting existing rows to `0`.

Devices are keyed by `(owner_username, id)` so two accounts using the same
browser- or Android-generated device id keep separate labels, trusted-device
records, and session metadata. Notes, notebooks, entity changes, tombstones,
and version snapshots also include `owner_username` so sync results are scoped
to the authenticated account. Legacy token data is stored under `legacy-token`.

Account E2EE keyrings are stored in `users.e2ee_keyring` as client-produced JSON. The server treats
this value as opaque ciphertext: it contains the account data-key keyring wrapped by
password-derived `password:v4` material and, when the user generated one, a recovery-code wrap. The server
does not store plaintext note keys or recovery codes. Existing `enc:v3` password-encrypted fields
remain migration-readable by current clients and are republished as `enc:v4` with key ids.

Password-derived client wrapping keys use Argon2id-only material, and runtime clients do not keep
pre-Argon2 or pre-`enc:v3` compatibility paths. Older installs must migrate through a release that
republishes data as at least `enc:v3` before running this version. Current clients fail closed when
they see older local or remote note envelopes, or when current envelopes cannot be authenticated
with the active key material and field context, rather than rewriting ciphertext as plaintext.
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

Server libSQL connections enable foreign keys and set a short SQLite
`busy_timeout`; write transactions are serialized and retried in-process for a
single Node/self-hosted app instance. This does not make one local SQLite file
safe for multiple Author server processes.

## Android Local SQLCipher

Database: `author.db`, current schema version: 3.

Android uses SQLCipher through `SQLiteOpenHelper`, not Room. A random database
key is generated locally and stored through Android secure preferences. On
startup, legacy plaintext `author.db` files are exported into a SQLCipher
database and the plaintext backup is removed after a successful migration. If
an encrypted database file survives but the local database key material is gone
or undecryptable, Android moves the unreadable `author.db` aside with an
`author.db.unreadable-*` suffix and starts a clean local database so a password
login can pull synced remote data again.

Tables:

- `notes`
- `notebooks`
- `devices`
- `sync_meta`
- `conflicts`

Android note and notebook rows mirror the shared entity fields plus local-only
`last_synced_version` and `last_synced_at`. Conflicts are stored as JSON
payloads in `conflicts`; note and notebook conflict payloads are encrypted
before local storage and decrypted only for display/resolution.

Android `sync_meta` stores the same local cursor and diagnostic keys used by
the web client, including `lastPulledRevision`, `lastPulledAt`, last sync pass
counts, last sync error details, local workspace owner, and pull-cursor reset
state. The database config sets `PRAGMA busy_timeout = 5000`; background sync
also closes repository handles when done so the encrypted database can be
reopened cleanly.

## Trash

Moving a note to Trash sets `trashedAt` and keeps the row syncable. Cleanup permanently removes notes whose `trashedAt` is older than 90 days, after writing a final snapshot and an `entity_tombstones` row. Tombstones let stale offline clients receive `deleted_remotely` conflicts instead of recreating cleaned-up rows.

The server starts a cleanup scheduler unless `NOTES_CLEANUP_ENABLED=false`. It
runs on startup by default and then every `NOTES_CLEANUP_INTERVAL_MINUTES`.
Cleanup also prunes version snapshots older than 365 days, scoped to the same
account when cleanup is invoked for a signed-in user.

## Migrations

Server schema upgrades are tracked in `schema_migrations`. Each migration has a forward-only implementation and rollback notes in `apps/web/src/lib/server/db.ts`. Rollback means restoring the pre-upgrade SQLite/Turso backup, then rerunning `aube -F @author/web run db:check` before sending traffic back to the app.
