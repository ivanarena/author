# Production Readiness

Use this page as the pre-release gate for the web app, API, Docker image, and
Android APK. The focused setup details stay in `docs/setup.md`,
`docs/operations.md`, and `apps/android/README.md`.

## Web and API

Run these from the repo root:

```sh
aube run deps:check
aube run quality
aube audit --prod
aube audit --audit-level high
aube deprecations --transitive --exit-code
aube run test
aube run test:coverage
aube run test:e2e
aube -F @author/web run build
aube -F @author/web run cf:build
docker build .
```

If Playwright has not been used on the machine before, install Chromium first:

```sh
aube -F @author/web exec -- playwright install chromium
```

For Cloudflare Workers, also run:

```sh
cd apps/web
aube run cf:dev
aube run cf:deploy
```

For the separate staging Worker/Turso pair, run the `Remote Staging Smoke`
workflow or run locally with staging credentials:

```sh
aube run remote:test:seed
aube run remote:test
```

Production web deployments must set real `NOTES_LOGIN_PASSWORD` and
`NOTES_SERVER_SECRET` values, keep Turso tokens server-side only, run behind
HTTPS, and keep `NOTES_TRUST_PROXY_HEADERS` disabled unless a trusted reverse
proxy overwrites forwarding headers.
Treat a missing `NOTES_SERVER_SECRET` as a release blocker; production TOTP
seed encryption fails closed without it.

## Android

Run these from `apps/android`:

```sh
./gradlew spotlessCheck
./gradlew :app:compileDebugKotlin :app:testDebugUnitTest :app:assembleDebug
./gradlew :app:lintDebug
AUTHOR_API_URL=https://author.example.com ./gradlew :app:lintRelease :app:assembleRelease
./gradlew :app:connectedDebugAndroidTest
```

Release APKs must use an HTTPS `AUTHOR_API_URL`. The Android app talks to
the Author HTTP API only; Turso credentials never belong in the APK. For signed
releases, set the `ANDROID_RELEASE_*` variables documented in
`apps/android/README.md`. GitHub release builds also require
`ANDROID_RELEASE_KEYSTORE_BASE64` plus the signing password and alias secrets.

## Operational Checks

- Back up and restore `notes.sqlite` before upgrades, then smoke-check the
  restored file with `aube -F @author/web run db:check`.
- Confirm scheduled SQLite backups are enabled for self-hosted Node
  deployments, and that `NOTES_BACKUP_DIR` is on storage you retain.
- If 2FA is enabled, keep `NOTES_SERVER_SECRET` with restore credentials and
  still treat database files, mirrors, and backups as sensitive auth material.
- Review `/api/health` and authenticated `/api/metrics` after deploy.
- Keep the staging Turso database and `author-remote-test` seeded account
  separate from production, and run remote staging smoke after deploy-relevant
  sync, auth, encryption, or Cloudflare workflow changes.
- Keep exactly one app process pointed at each local SQLite database.
- Treat Docker image scan failures as release blockers. The CI workflow scans
  before publishing, then uploads a SARIF artifact for review.
- Verify Android update notifications with a manifest URL or release URL before
  distributing a sideloaded APK.

## Code Health

- Keep dependency ranges explicit; do not use `latest` in package manifests.
- Prefer shared contracts in `packages/schema`, `packages/api-types`, and
  `packages/sync-spec` over duplicating request or sync shapes.
- Keep notes UI presentation contracts in
  `apps/web/src/lib/components/notes/notes-controller-models.ts` and shared
  controller copy/metadata helpers in `notes-controller-copy.ts`; avoid adding
  new display-only types or text formatting to the page controller.
- Keep generated caches out of git (`node_modules`, `.svelte-kit`, `.gradle`,
  `.kotlin`, `build`, `coverage`, `test-results`, `.data`).
- Treat very large modules as refactor candidates when changing nearby behavior.
  Current hotspots are the web notes page controller, server repository, Hono
  API module, and Android notes repository/controller.
- Crypto and Android storage hardening remain versioned migration work, not
  formatting work. If the threat model expands beyond encrypted note fields and
  disabled Android backups, plan an explicit content-key/KDF migration and
  evaluate SQLCipher or equivalent full-database encryption for Android
  metadata defense in depth.
