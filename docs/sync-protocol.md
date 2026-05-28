# Sync Protocol

The offline-first sync protocol is deliberately small.

1. Client saves all edits locally first so typing, notebook changes, import/export, and trash actions keep working offline.
2. On app open, the client pushes local pending changes in bounded batches. Browser sync runs under a Web Lock when available, with a local lease fallback, so multiple tabs do not push or pull the same IndexedDB workspace concurrently. If only the local device name changed, the client may send an otherwise empty push so the server can update device metadata.
3. The server accepts a change only when `baseVersion` matches the current remote version, or when the remote content is identical.
4. If the remote version changed, the remote row was hard-deleted after the client's base version, or a pushed notebook would duplicate an active notebook name, the server returns a conflict instead of overwriting.
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

Clients send at most 20 note/notebook changes in a single push request so
remote database round trips stay below Worker subrequest limits.
When server-side record limits are enabled, the server also estimates the
post-push active note/notebook counts for the authenticated user before
accepting a batch. A limit failure returns an explicit sync error and does not
drop local pending records; clients can retry after deleting/exporting data or
after the operator adjusts the configured budget.
`baseVersion` is the last remote version the client successfully synced. New local entities use `0`.
For notes, clients encrypt `title` and `body` into `enc:v3` string envelopes before storage
and push, then decrypt them after pull. Notebook names use the same envelope format before
storage and push. A value is preserved as encrypted only when its envelope is structurally valid
and decrypts with the active key material for that exact field context; literal text that merely
imitates an `enc:v3` envelope is encrypted again as normal plaintext. Encryption uses random
AES-GCM IVs with field-specific additional authenticated data, so a title envelope cannot be
silently moved into a body or another note field, and a notebook name envelope cannot be
silently moved to another notebook. Stable HMAC field hashes (`titleHash`,
`bodyHash`, and `nameHash`) let sync compare encrypted fields and check duplicate notebook names
without reusing nonces or exposing plaintext names. Sync metadata and notebook assignment remain
plain so versioning and relationship repair stay small.
Password-derived note key material is Argon2id-only `password:v4` material. Runtime clients do
not keep pre-Argon2 or pre-`enc:v3` compatibility paths; older installs must migrate through a
release that can republish data as `enc:v3` before running this version. If a current client sees
older note envelopes or old password key material, it stops instead of rewriting that ciphertext as
literal text. Current `enc:v3` envelopes also fail closed when the active key material or field
context cannot authenticate them, which prevents ciphertext from being republished as note text.
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
The client re-encrypts local notes and notebooks with the new password-derived material, syncs
those rotated ciphertexts with the replacement session, and only then clears the local session and
key material. If that final sync fails, the replacement session and new key material remain on the
device so the user can retry instead of stranding remote notes under the old key.

For self-hosted local SQLite with an optional Turso mirror, note reads, pulls, pushes, and trash
cleanup use the local primary immediately and queue mirror convergence in the background. Account
mutations still synchronize remote state first because they affect authentication and account
recovery rather than the typing path.

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

The response includes changed notes, notebooks, known devices, hard-delete IDs, `hasMore`, the server time to store as the next `lastPulledAt`, and the server revision to store as the next `lastPulledRevision`. When `hasMore` is true, `serverRevision` is the page cursor, not the end of all available changes.

## Ownership

Server-side notes, notebooks, device rows, tombstones, and revision changes are scoped to the authenticated username. The server stores device metadata under `(owner_username, device_id)` so shared browser device ids do not merge labels, sessions, or trusted-login state across accounts. Legacy bearer-token sync uses the `legacy-token` owner.

## Version Rule

The server owns accepted remote versions. When a pushed edit is accepted against an existing record, the server writes `remote.version + 1`.
Hard deletes create tombstones with their own next remote version, so a client
that only synced the deleted row's old version still conflicts until the user
explicitly resolves against the tombstone version.

## Notebook Names

Active notebook names are unique case-insensitively after trimming whitespace. The client blocks duplicates immediately, and the server reports a `duplicate_name` conflict if another device tries to push one.
When accepting notes, the server trims and deduplicates notebook references, then keeps only references that point to active notebooks owned by the same account, so a rejected or deleted notebook cannot make the note push fail.
