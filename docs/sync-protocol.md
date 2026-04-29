# Sync Protocol

The sync protocol is deliberately small.

1. Client saves all edits locally first.
2. On app open, the client pushes local pending changes.
3. The server accepts a change only when `baseVersion` matches the current remote version, or when the remote content is identical.
4. If the remote version changed, or if a pushed notebook would duplicate an active notebook name, the server returns a conflict instead of overwriting.
5. Client pulls changes since `lastPulledAt`.
6. Pulled remote changes merge only into clean local records. Pending local records become conflicts if the remote version changed.

## Push Payload

Each changed entity is sent as:

```ts
{
  record: Note | Notebook,
  baseVersion: number
}
```

`baseVersion` is the last remote version the client successfully synced. New local entities use `0`.

## Pull Payload

Pull accepts an optional timestamp:

```ts
{
  since: string | null
}
```

The response includes changed notes, notebooks, known devices, and the server time to store as the next `lastPulledAt`.

## Version Rule

The server owns accepted remote versions. When a pushed edit is accepted against an existing record, the server writes `remote.version + 1`.

## Notebook Names

Active notebook names are unique case-insensitively after trimming whitespace. The client blocks duplicates immediately, and the server reports a `duplicate_name` conflict if another device tries to push one.
