# Conflict Handling

Conflicts are explicit. The app never silently overwrites remote data.

Conflict reasons include remote edits, remote deletes, version mismatches, and duplicate notebook names.

Conflict prompts show:

- local device name
- remote device name
- update time for each version
- preview text for each version

Local conflict records stay local until the user resolves them. Browser
conflicts live in IndexedDB; Android conflicts live in SQLCipher. Note and
notebook conflict payloads are encrypted before local storage and decrypted for
the prompt, so the prompt can show useful previews without syncing a separate
conflict document.

Available choices:

- keep newer version
- keep older version
- keep the local device version
- keep the remote device version
- duplicate both versions

When the local version wins, the client stores it as a new pending edit based on the current remote version and syncs again. When the remote version wins, the local record is replaced and marked synced. When both are duplicated, the remote keeps the original id and the local version becomes a new pending note.

For remote-delete conflicts, the tombstone version is the current remote version.
After the user explicitly keeps the local version, the server may accept that
pending record over the tombstone because the client is no longer stale.
When a remote notebook tombstone wins, clients remove that notebook id from
local note assignments and queue those note metadata changes instead of leaving
orphaned notebook links. When both sides of a generic notebook conflict are
duplicated, note assignments that pointed at the local notebook follow the new
local copy.

For duplicate notebook-name conflicts, the client does not resubmit the same rejected name. Keeping the existing remote notebook removes the local duplicate and remaps local note assignments to the existing notebook. Keeping the local notebook creates a renamed pending copy and remaps local note assignments to that copy.

When a push conflict's remote version came from the same local device, the client treats it as an echo of an earlier accepted write. It advances the local base version and leaves the newer local edit pending for the next push instead of showing a conflict prompt.
