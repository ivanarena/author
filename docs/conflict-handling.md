# Conflict Handling

Conflicts are explicit. The app never silently overwrites remote data.

Conflict reasons include remote edits, remote deletes, version mismatches, and duplicate notebook names.

Conflict prompts show:

- local device name
- remote device name
- update time for each version
- preview text for each version

Available choices:

- keep newer version
- keep older version
- keep the local device version
- keep the remote device version
- duplicate both versions

When the local version wins, the client stores it as a new pending edit based on the current remote version and syncs again. When the remote version wins, the local record is replaced and marked synced. When both are duplicated, the remote keeps the original id and the local version becomes a new pending note.

For duplicate notebook-name conflicts, the client does not resubmit the same rejected name. Keeping the existing remote notebook removes the local duplicate and remaps local note assignments to the existing notebook. Keeping the local notebook creates a renamed pending copy and remaps local note assignments to that copy.

When a push conflict's remote version came from the same local device, the client treats it as an echo of an earlier accepted write. It advances the local base version and leaves the newer local edit pending for the next push instead of showing a conflict prompt.
