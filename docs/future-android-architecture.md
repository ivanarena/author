# Future Android Architecture

The Android app should mirror the web architecture:

- Kotlin + Jetpack Compose for UI
- Room over SQLite for local storage
- A small repository layer that writes locally before network calls
- WorkManager for background sync
- The same Note, Notebook, Device fields from `packages/schema`
- The same push/pull payloads from `packages/api-types`
- The same base-version conflict rule from `packages/sync-spec`

Suggested modules:

```text
apps/android/
  app/
    data/room
    data/sync
    domain/model
    ui/editor
    ui/notebooks
```

Android can generate Kotlin DTOs from the TypeScript contracts later, but v1 should keep the protocol stable and hand-written.
