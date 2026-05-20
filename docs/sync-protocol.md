# Sync Protocol

The sync protocol is deliberately small.

1. Client saves all edits locally first.
2. On app open, the client pushes local pending changes in bounded batches. If only the local device name changed, the client may send an otherwise empty push so the server can update device metadata.
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
`baseVersion` is the last remote version the client successfully synced. New local entities use `0`.
For notes, the browser encrypts `title` and `body` into `enc:v2` string envelopes before storage
and push, then decrypts them after pull. Notebook names use the same envelope format before
storage and push. Encryption uses random AES-GCM IVs with field-specific additional authenticated
data, so a title envelope cannot be silently moved into a body or another note field. Stable
HMAC field hashes (`titleHash`, `bodyHash`, and `nameHash`) let sync compare encrypted fields and
check duplicate notebook names without reusing nonces or exposing plaintext names. Sync metadata
and notebook assignment remain plain so versioning and relationship repair stay small.
Password-derived note key material uses PBKDF2-SHA-256. Sync-capable password key material is kept
in browser `sessionStorage` for the active session; unsigned local-only browsers generate random
local key material in `localStorage` so offline drafts still work without an account. New key
material can still decrypt older `enc:v1` SHA-256-derived envelopes so browsers can re-encrypt and
republish notes during normal sync. This avoids storing note plaintext remotely, but it is not a
hardened zero-knowledge design for weak passwords or compromised browsers.
Older local fallback envelopes remain decryptable so existing local data can be migrated.
Browsers with an old session token but no stored encryption key material must sign in again before
syncing encrypted notes.

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

Server-side notes, notebooks, tombstones, and revision changes are scoped to the authenticated username. Legacy bearer-token sync uses the `legacy-token` owner.

## Version Rule

The server owns accepted remote versions. When a pushed edit is accepted against an existing record, the server writes `remote.version + 1`.

## Notebook Names

Active notebook names are unique case-insensitively after trimming whitespace. The client blocks duplicates immediately, and the server reports a `duplicate_name` conflict if another device tries to push one.
When accepting notes, the server trims and deduplicates notebook references, then keeps only references that point to active notebooks owned by the same account, so a rejected or deleted notebook cannot make the note push fail.
