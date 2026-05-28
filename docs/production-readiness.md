# Production Readiness

Use this page as the pre-release gate for the web app, API, Docker image, and
Android APK. The focused setup details stay in `docs/setup.md`,
`docs/operations.md`, and `apps/android/README.md`.

## Web and API

Run these from the repo root:

```sh
aube run release:verify
```

That command runs the main local release gate: dependency graph check, format,
lint, Svelte typecheck, production and high-severity audits, deprecation check,
sync-spec and web coverage, browser e2e, Node and Cloudflare builds, and Android
format/compile/unit/debug/lint checks. For targeted troubleshooting, the same
gate expands to:

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
aube run android:verify
```

For release-candidate builds from a local workstation, also run:

```sh
aube run release:verify:local
aube run docker:verify
```

For deployments with staging credentials, run:

```sh
aube run staging:verify
```

Review the Docker image scan results from CI before publishing.

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
workflow or run locally with staging credentials. Scheduled staging smoke fails
when required secrets are missing unless the repository variable
`AUTHOR_REMOTE_STAGING_ALLOW_SKIP=true` is set explicitly.

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
API responses are served with `Cache-Control: no-store, private` and vary on
`Authorization`/`Cookie`. The production CSP uses nonce-bound scripts and keeps
inline style permission narrowed to dynamic style attributes used by the app UI.

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
- Confirm Cloudflare deploys keep the Worker Cron trigger enabled so Turso
  primary trash cleanup runs without manual API calls.
- If 2FA is enabled, keep `NOTES_SERVER_SECRET` with restore credentials and
  still treat database files, mirrors, and backups as sensitive auth material.
- Review `/api/health` and authenticated `/api/metrics` after deploy,
  including HTTP error/latency buckets, backup freshness, and remote-sync state.
- Verify the web app opens once while online, then reloads while offline. The
  service worker caches the app shell and static assets after first load, while
  API requests remain network-only.
- Keep the staging Turso database and `author-remote-test` seeded account
  separate from production, and run remote staging smoke after deploy-relevant
  sync, auth, encryption, or Cloudflare workflow changes.
- Treat the browser threat model honestly: client-side Argon2 proofs keep
  Workers CPU low and avoid raw-password API requests, but XSS or a malicious
  deployed web bundle can still read passwords, local key material, and
  decrypted notes. Use session-only browser key storage on devices where restart
  unlock should require an explicit sign-in.
- Verify account E2EE recovery before launch: signup returns a wrapped keyring,
  password change rewraps that keyring without rotating note ciphertext, and a
  downloaded recovery kit plus recovery code restores the same key material.
  Operator recovery drills should also confirm `e2ee:recover` resets the
  password verifier and revokes existing sessions/trusted-device login.
- Keep exactly one app process pointed at each local SQLite database.
- Treat Docker image scan failures as release blockers. The CI workflow scans
  before publishing, then uploads a SARIF artifact for review.
- Verify Android update notifications with a manifest URL or release URL before
  distributing a sideloaded APK.

## External Assurance

For a public service or competitor-grade release, green local checks are not
enough. Treat these as release blockers outside the repo:

- Run the Cloudflare/Turso staging smoke against isolated staging credentials.
- Restore a fresh backup into a separate environment and run `db:check` before
  upgrading production.
- Build and scan the Docker image, then review the uploaded Trivy SARIF before
  publishing.
- Keep release images signed with Cosign and Android APKs signed with protected
  release keys.
- Commission an independent security review before claiming hardened
  zero-knowledge security, audited crypto, or enterprise-grade assurance.

## Code Health

- Keep dependency ranges explicit; do not use `latest` in package manifests.
- Prefer shared contracts in `packages/schema`, `packages/api-types`, and
  `packages/sync-spec` over duplicating request or sync shapes.
- Keep notes UI presentation contracts in
  `apps/web/src/lib/components/notes/controller/models.ts` and shared
  controller copy/metadata helpers in
  `apps/web/src/lib/components/notes/controller/copy.ts`; avoid adding new
  display-only types or text formatting to the page controller.
- Keep generated caches out of git (`node_modules`, `.svelte-kit`, `.gradle`,
  `.kotlin`, `build`, `coverage`, `test-results`, `.data`).
- Treat very large modules as refactor candidates when changing nearby behavior.
  Current hotspots are the web notes page controller, server repository, Hono
  API module, and Android notes repository/controller.
- Android stores the local notes database through SQLCipher with the database
  key held in Android Keystore-backed secure preferences. Crypto hardening
  beyond that, such as content-key rotation or hardware-bound unlock policy,
  remains versioned migration work rather than formatting work.
