# Sync Protocol

The offline-first sync protocol is deliberately small.

1. Client saves all edits locally first so typing, notebook changes, import/export, and trash actions keep working offline.
2. On app open, the client pushes local pending changes in bounded batches. Browser sync runs under a Web Lock when available, with an IndexedDB transactional lease and fencing checks as fallback, so multiple tabs do not commit the same workspace concurrently. If only the local device name changed, the client may send an otherwise empty push so the server can update device metadata.
3. The server accepts a change only when `baseVersion` matches the current remote version, or when the remote content is identical.
4. If the remote version changed, the remote row was hard-deleted after the client's base version, or a pushed notebook would duplicate an active notebook name, the server returns a conflict instead of overwriting.
   Local SQLite writes are serialized inside the server process. Turso/libSQL-primary writes rely on remote database transactions instead; they must not wait on a JavaScript promise shared between Cloudflare Worker requests, because cancellation of one waiting request could strand later sync attempts. Concurrent remote pushes remain atomic and produce an acceptance or an explicit conflict through the same `baseVersion` rule.
5. Client pulls changes since `lastPulledRevision`, falling back to revision `0` for a full recovery pull. Pull responses may be paged; the client keeps pulling until `hasMore` is false.
6. Pulled remote changes merge only into clean local records. Pending local records become conflicts if the remote version changed.

## Push Payload

Each changed entity is sent as:

```ts
{
  record: Note | Notebook,
  baseVersion: number
}
```

Clients send at most 20 note/notebook changes in a single push request. The server also enforces UTF-8 byte limits for every identifier, field, hash, timestamp, device label, and assignment list; binds a device to its authenticated session; caps accounts at 50 devices; rate-limits pushes; and checks active plus auxiliary snapshot/change storage inside the write transaction.
When server-side record limits are enabled, the server estimates post-push active note/notebook counts, active bytes, devices, version snapshots, tombstones, and revision metadata for the authenticated user inside the accepting transaction. An already-over-limit account can bypass that limit only when every change is a version-matched deletion of a currently active record; stale/conflict-only or content-shrinking updates do not qualify. A limit failure returns an explicit sync error and does not
drop local pending records; clients can retry after deleting/exporting data or
after the operator adjusts the configured budget.
`baseVersion` is the last remote version the client successfully synced. New local entities use `0`.
For notes, clients encrypt `title` and `body` into `enc:v4` string envelopes before storage
and push, then decrypt them after pull. Notebook names use the same envelope format before
storage and push. The v4 envelope carries a data-key id, random AES-GCM IV, ciphertext, and
field-specific additional authenticated data, so a title envelope cannot be silently moved into a
body or another note field, and a notebook name envelope cannot be silently moved to another
notebook. A value is preserved as encrypted only when its envelope is structurally valid and
decrypts with the active key material for that exact field context. The complete `enc:v<integer>:` namespace is reserved: malformed current envelopes, retired versions, and unknown future versions fail closed instead of being treated as literal note text.

Sync-capable accounts use a local `keyring:v1` material blob. The active random 256-bit data key
encrypts note fields, while the server stores only an `e2eeKeyring` JSON wrapper: the keyring
encrypted by password-derived `password:v4` material and, when available, by a recovery code.
Password changes rewrap this keyring and do not rewrite note ciphertext. Existing `enc:v3`
password-encrypted fields remain readable through legacy key material recorded during migration
and are republished as `enc:v4` when touched by the current clients. Stable HMAC field hashes
(`titleHash`, `bodyHash`, and `nameHash`, currently `hash:v3`) let sync compare encrypted fields
and check duplicate notebook names without reusing nonces or exposing plaintext names. Sync
metadata and notebook assignment remain plain so versioning and relationship repair stay small.

Runtime clients do not keep pre-Argon2 or pre-`enc:v3` compatibility paths; older installs must
migrate through a release that can republish data as at least `enc:v3` before running this
version. If a current client sees an older, malformed, or unknown future note envelope or old password key material, it stops instead of rewriting that ciphertext as literal text. Current envelopes also fail closed when the active key material or field context cannot authenticate them, which prevents ciphertext from being republished as note text.
Sync-capable browser key material is stored on the signed-in browser by default
so users can keep working offline and survive normal browser restarts without a
password prompt. The account settings for the current browser can switch that
material to session-only storage; after a browser restart the user must sign in
again before encrypted notes can sync or decrypt. Unsigned local-only browsers
generate random local key material in `localStorage` so offline drafts still work
without an account. This avoids storing note plaintext remotely by default, but
Author is intentionally not a hardened zero-knowledge system: account recovery
and offline usability are allowed to take priority over making every server or
browser compromise unrecoverable.
Account authentication also runs Argon2id on the client, using a separate
SCRAM-style challenge/proof verifier from the note encryption key material.
This keeps Worker request CPU low and avoids sending raw passwords to the API,
but it does not protect against JavaScript that runs on the app origin.
Browsers with an old session token but no stored encryption key material must sign in again before
syncing encrypted notes.

When an account password changes, the server returns a replacement session for the same device.
The client rewraps the E2EE keyring with the new password verifier, preserves the note data key,
and syncs with the replacement session. If that final sync fails, the replacement session and
unchanged key material remain on the device so the user can retry instead of stranding remote
notes under a different key. Clients record that interrupted final sync in local diagnostics.

For self-hosted local SQLite with an optional Turso mirror, note reads, pulls, pushes, and trash
cleanup use the local primary immediately and queue mirror convergence in the background. Mirror
writes preserve source versions; if the higher-version record returns to the same logical content
as the lower-version record, both sides converge on that higher version instead of silently
retaining different lineage. Account mutations still synchronize remote state first because they
affect authentication and account recovery rather than the typing path.

Android foreground/manual sync runs under a repository mutex, while background
sync is scheduled through WorkManager. The background worker opens its own
repository, skips successfully when there is no stored session or no encryption
key material, and closes the encrypted database handle when done. If the local
SQLCipher database is busy or locked, the worker records a warning and retries
with WorkManager backoff for a small bounded number of attempts. If the database
stays busy after that cap, the run is skipped so foreground edits remain
unblocked; the next scheduled or manual sync can converge the same pending local
records.

## Pull Payload

Pull accepts a revision cursor. `since` is retained for old clients, but the
server treats a missing or invalid `sinceRevision` as revision `0` so recovery
pulls stay cursor-stable:

```ts
{
  since: string | null;
  sinceRevision: number | null;
  limit: number | null;
}
```

The response includes changed notes, notebooks, known devices, hard-delete IDs, `hasMore`, the server time to store as the next `lastPulledAt`, and the server revision to store as the next `lastPulledRevision`. Pages are bounded by both revision count and serialized bytes; web and Android also enforce an independent response-read ceiling. When `hasMore` is true, `serverRevision` is the page cursor, not the end of all available changes.

## Local Recovery Diagnostics

Web and Android clients expose local repair diagnostics in Sync settings. The
diagnostics are intentionally local-only and do not upload note contents,
tokens, key material, or database rows. They check for:

- a signed-in session without encryption key material,
- stored encryption key material that cannot unlock local encrypted records,
- an incomplete local encryption audit,
- stale or invalid pull cursor metadata,
- queued local changes and explicit conflicts,
- inconsistent local record versions/sync states, and
- denormalized notebook assignments.

If a pull cursor is stale or invalid, the user can reset it locally. Resetting
sets `lastPulledRevision` to `0`, clears `lastPulledAt`, records
`lastPullCursorResetAt`, and leaves notes/notebooks untouched. The next sync
then performs a revision-0 recovery pull and still preserves pending local
records and explicit conflicts.

Android repair diagnostics also expose a local device sync reset when stored
session or encryption material is missing or cannot unlock the local workspace.
Resetting clears the saved session, trusted-login secret, and last pushed device
signature on that install only. It removes the active note key material from
normal sync use but keeps a local reset copy until the next password sign-in, so
local drafts written during the broken-key window can be re-encrypted into the
restored account key when possible. It leaves notes, notebooks, conflicts, pull
cursors, API configuration, and workspace owner metadata in place so the next
password sign-in can unlock the account keyring and resume normal conflict-safe
sync.

## Ownership

Server-side notes, notebooks, device rows, tombstones, and revision changes are scoped to the authenticated username. The server stores device metadata under `(owner_username, device_id)` so shared browser device ids do not merge labels, sessions, or trusted-login state across accounts. Legacy bearer-token sync uses the `legacy-token` owner.

## Version Rule

The server owns accepted remote versions. When a pushed edit is accepted against an existing record, the server writes `remote.version + 1`.
Hard deletes create tombstones with their own next remote version, so a client
that only synced the deleted row's old version still conflicts until the user
explicitly resolves against the tombstone version. Trash retention starts from
the server-observed acceptance time, not a device-supplied timestamp, so clock
skew cannot make a new trash action immediately permanent.

## Notebook Names

Active notebook names are unique case-insensitively after trimming whitespace. The client blocks duplicates immediately, and the server reports a `duplicate_name` conflict if another device tries to push one.
When accepting notes, the server trims and deduplicates notebook references, then keeps only references that point to active notebooks owned by the same account, so a rejected or deleted notebook cannot make the note push fail.
Clients also repair notebook references locally after a remote notebook delete
has safely applied. The cleanup runs after remote note merges, removes the
deleted notebook id from local note metadata, and leaves those note metadata
updates pending so the next push converges without orphaned assignments.
