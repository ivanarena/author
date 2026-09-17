# Author Android

Native Android client for the Author offline-first notes app.

The Android client must be built for a specific Author HTTPS API and signed by
the service operator. An APK built for the upstream service is not automatically
suitable for another self-hosted domain or fork.

## Build

```sh
./gradlew :app:assembleDebug
```

The default sync API URL is read at build time from Gradle properties,
environment variables, or the repo root `.env`. Prefer the canonical public API
setting and keep the aliases only for older build pipelines:

```env
AUTHOR_API_URL=https://your-author-api.example.com
AUTHOR_SYNC_API_URL=https://your-author-api.example.com
ANDROID_SYNC_API_URL=https://your-author-api.example.com
ANDROID_SYNC_SERVER_URL=https://your-author-api.example.com
NOTES_SYNC_SERVER_URL=https://your-author-api.example.com
```

For emulator development against the local web app, use
`AUTHOR_API_URL=http://10.0.2.2:5173`. Turso credentials stay on the
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
first in an on-device SQLCipher database, then pushed/pulled through the same
sync protocol as the web app. The database key is generated locally and stored
through Android Keystore-backed secure preferences; note fields remain encrypted
for sync before leaving the device. The current local database schema is version
3 and stores notes, notebooks, devices, sync metadata, favorites, and encrypted
conflict payloads. Plaintext-to-SQLCipher migration validates and upgrades a
current-schema candidate before atomically installing it; interrupted migration artifacts are
recovered without deleting the last usable database.

Manual sync runs under the repository mutex. Background sync runs through
WorkManager, closes its repository/database handle after each run, and treats a
busy local database as a skipped background pass instead of data loss. Pending
local records remain queued for the next manual or scheduled sync.

## Local App Lock

Author includes an optional device-credential app lock under Account settings.
When enabled, leaving the app locks the Compose surface until Android confirms
the device screen lock again. This protects casual local access without changing
the sync encryption contract or requiring network access after unlock.

## Release Validation

Release builds require HTTPS Author API and update URLs:

```sh
AUTHOR_API_URL=https://author.example.com ./gradlew :app:lintRelease :app:assembleRelease
```

If `ANDROID_UPDATE_CHECK_URL` or `ANDROID_UPDATE_DOWNLOAD_URL` is set for a
release build, use HTTPS. APK links discovered from an update feed must stay on
the configured update origin, or a subdomain of it.

Optional signing environment variables:

```env
ANDROID_RELEASE_KEYSTORE_PATH=/secure/path/author-release.jks
ANDROID_RELEASE_KEYSTORE_PASSWORD=change-this
ANDROID_RELEASE_KEY_ALIAS=author
ANDROID_RELEASE_KEY_PASSWORD=change-this
```

The GitHub signed APK workflow uses the same signing values from repository
secrets. Store the keystore as base64 in `ANDROID_RELEASE_KEYSTORE_BASE64`, then
set `ANDROID_RELEASE_KEYSTORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`,
`ANDROID_RELEASE_KEY_PASSWORD`, and the normalized expected signing certificate
fingerprint in `ANDROID_RELEASE_CERT_SHA256`. The workflow rejects a validly
signed APK if its certificate does not match. The public production API endpoint belongs in
the `AUTHOR_API_URL` repository variable.

A manual `test` dispatch builds the current `main` commit against
`STAGING_AUTHOR_API_URL`, verifies the production signing certificate, and
uploads a private 14-day workflow artifact without creating a tag or GitHub
release. It requires successful exact-commit CI, Docker, Security, and Remote
Staging Smoke runs. Use this artifact for upgrade and device smoke testing.
A `production` dispatch requires the version tag and successful production
Cloudflare deployment before attaching the APK to a GitHub release.

CI validates debug compile/lint/unit/APK, release lint/unit/APK, and connected debug instrumentation tests. Run connected tests locally with an emulator booted:

```sh
./gradlew :app:connectedDebugAndroidTest
```

The full cross-app release checklist lives in
[`../../docs/production-readiness.md`](../../docs/production-readiness.md).
Self-hosted operators should also follow
[`../../docs/self-hosting.md`](../../docs/self-hosting.md) and keep their APK
signing key, certificate fingerprint, API URL, update URL, and rollback APK under
their own control.

## License

The Android client is part of Author and is distributed under the repository's
[MIT License](../../LICENSE). AndroidX and other dependencies retain their own
licenses; see [Third-Party Notices](../../THIRD_PARTY_NOTICES.md).
