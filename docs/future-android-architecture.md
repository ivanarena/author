# Android Architecture

The Android app now mirrors the web architecture with hand-written Kotlin
contracts and a small local-first repository layer.

- Kotlin + Jetpack Compose for UI
- SQLCipher `SQLiteOpenHelper` for encrypted local storage
- Android secure preferences for the local database key, trusted-device secret,
  session token, and note key material
- A small repository layer that writes locally before network calls
- WorkManager for background sync, with manual sync guarded by a repository
  mutex
- The same Note, Notebook, Device fields from `packages/schema`
- The same push/pull payloads from `packages/api-types`
- The same base-version conflict rule from `packages/sync-spec`

Current modules:

```text
apps/android/
  app/
    src/main/java/com/author/core      storage, crypto, JSON, sync, imports
    src/main/java/com/author/ui        Compose app, screens, state, theme
    src/test/java/com/author           unit tests
    src/androidTest/java/com/author    instrumented storage/sync/UI tests
```

Android can generate Kotlin DTOs from the TypeScript contracts later, but the
current app keeps the protocol stable and hand-written. Shared behavior changes
should update Kotlin models/tests alongside `packages/schema`,
`packages/api-types`, and `packages/sync-spec`.
