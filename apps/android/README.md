# Author Android

Native Android client for the Author local-first notes app.

## Build

```sh
./gradlew :app:assembleDebug
```

The default sync API URL is read at build time from Gradle properties,
environment variables, or the repo root `.env`. Prefer the canonical public API
setting and keep the aliases only for older build pipelines:

```env
AUTHOR_NOTES_API_URL=https://your-author-api.example.com
ANDROID_SYNC_API_URL=https://your-author-api.example.com
ANDROID_SYNC_SERVER_URL=https://your-author-api.example.com
NOTES_SYNC_SERVER_URL=https://your-author-api.example.com
```

For emulator development against the local web app, use
`AUTHOR_NOTES_API_URL=http://10.0.2.2:5173`. Turso credentials stay on the
server; the Android app talks to the API server, and the server mirrors to the
configured remote Turso database. Never point the Android sync URL at
`TURSO_DATABASE_URL`; that is a database endpoint, not the HTTP sync API.

## Emulator

```sh
aube run emulator:window
```

The emulator starts with a visible window and no boot animation. Set
`ANDROID_AVD` to choose a device. If unset, the script uses the first AVD under
`~/.android/avd`.

The app is implemented with Kotlin and Jetpack Compose. Local changes are saved
first in the on-device SQLite database, then pushed/pulled through the same sync
protocol as the web app.

## Release Validation

Release builds require an HTTPS Author API URL:

```sh
AUTHOR_NOTES_API_URL=https://notes.example.com ./gradlew :app:lintRelease :app:assembleRelease
```

Optional signing environment variables:

```env
ANDROID_RELEASE_KEYSTORE_PATH=/secure/path/author-release.jks
ANDROID_RELEASE_KEYSTORE_PASSWORD=change-this
ANDROID_RELEASE_KEY_ALIAS=author
ANDROID_RELEASE_KEY_PASSWORD=change-this
```

The GitHub signed APK workflow uses the same signing values from repository
secrets. Store the keystore as base64 in `ANDROID_RELEASE_KEYSTORE_BASE64`, then
set `ANDROID_RELEASE_KEYSTORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`, and
`ANDROID_RELEASE_KEY_PASSWORD`. The public production API endpoint belongs in
the `AUTHOR_NOTES_API_URL` repository variable.

CI validates debug compile/lint/unit/APK, release lint/unit/APK, and connected debug instrumentation tests. Run connected tests locally with an emulator booted:

```sh
./gradlew :app:connectedDebugAndroidTest
```

The full cross-app release checklist lives in `../../docs/production-readiness.md`.
