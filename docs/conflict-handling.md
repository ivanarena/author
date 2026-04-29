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
