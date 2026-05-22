# Setup

## Requirements

- Node.js 24 or newer
- Aube

The self-hosted server uses libSQL with a local SQLite file. When Turso is configured for self-hosting, the server treats it as a remote sync peer and reconciles both databases. Cloudflare Workers deployments use Turso directly as their primary database.

Recommended tool install:

```sh
curl https://mise.run | sh
mise use -g node@24
mise use -g aube@1.8.0
```

For fish:

```fish
curl https://mise.run/fish | sh
exec fish
mise use -g node@24
mise use -g aube@1.8.0
aube --version
```

## Environment

There are three checked-in env templates:

- `.env.example` at the repo root is the canonical production/self-host template. Android builds read only Android-relevant values from the ignored root `.env`, such as `AUTHOR_API_URL`, update URLs, and release signing settings; server and deploy tokens are ignored.
- `apps/web/.env.example` is the small local web-dev template used by Vite/SvelteKit.
- `apps/web/.dev.vars.example` is only for local Cloudflare Worker runs with Wrangler.

For local web development, copy `apps/web/.env.example` to `apps/web/.env`.

```env
NOTES_DB_PATH=.data/notes.sqlite
NOTES_LOGIN_USERNAME=owner
NOTES_LOGIN_PASSWORD=change-this-local-password
NOTES_AUTH_SESSION_DAYS=90
NOTES_TRUST_PROXY_HEADERS=false
NOTES_SERVER_SECRET=change-this-server-secret
NOTES_METRICS_PUBLIC=false
NOTES_REMOTE_SYNC_ENABLED=true
NOTES_CLEANUP_ENABLED=true
NOTES_CLEANUP_RUN_ON_START=true
NOTES_CLEANUP_INTERVAL_MINUTES=1440
NOTES_BACKUP_ENABLED=true
NOTES_BACKUP_RUN_ON_START=true
NOTES_BACKUP_INTERVAL_MINUTES=1440
NOTES_BACKUP_RETENTION_COUNT=14
```

`NOTES_LOGIN_USERNAME` and `NOTES_LOGIN_PASSWORD` bootstrap the first local user if it does not already exist. After login, the server returns a random session token in an HttpOnly cookie and in the JSON response for the current app session; browsers keep only account metadata in local storage.
`NOTES_SERVER_SECRET` encrypts server-side auth secrets such as TOTP seeds at rest. Set it to a long random value and keep it stable across deploys, backups, and restores. Production runtime fails closed for TOTP seed encryption when this value is missing.
When 2FA is enabled, a browser or Android install that has already completed a password login can request a new session with username plus TOTP code. The device must still have its local trusted-login secret and local encryption key material for encrypted note sync.
New account and bootstrap passwords must be at least 12 characters. In production, there is no fallback password; set `NOTES_LOGIN_PASSWORD` or create a user before expecting browser login to work.

Signup is email allow-list only when a remote database is configured. Allowed addresses are stored in the remote database table `signup_allowed_emails`; `NOTES_SIGNUP_ALLOWED_EMAILS` can seed that table on startup with a comma-separated list of lowercase email addresses.

`NOTES_AUTH_TOKEN` is no longer used by default. If an older client still depends on the old static bearer token, set `NOTES_LEGACY_AUTH_TOKEN_ENABLED=true` temporarily and rotate away from it.

Leave `NOTES_TRUST_PROXY_HEADERS=false` unless your reverse proxy strips incoming `X-Forwarded-For` / `X-Real-IP` headers and sets trusted ones itself. It only affects login throttling.

In Node/self-hosted runs, when Turso variables are present, the server keeps local SQLite active and mirrors local/remote records in both directions before reads and after writes. Set `NOTES_REMOTE_SYNC_ENABLED=false` to force local-only behavior temporarily.

For Node/self-hosted runs, `NOTES_BACKUP_ENABLED=true` writes periodic SQLite snapshots with `VACUUM INTO`. By default backups go next to the database under `backups/`, run once after startup when `NOTES_BACKUP_RUN_ON_START=true`, then every `NOTES_BACKUP_INTERVAL_MINUTES`, keeping `NOTES_BACKUP_RETENTION_COUNT` files. Set `NOTES_BACKUP_DIR` to place them in a bind mount or host backup path. Cloudflare/Turso-primary deployments should use Turso's managed backup/export flow instead.

If you use direnv, put your live values in the ignored root `.env` file and run:

```sh
direnv allow
cd apps/web
tsx scripts/check-db-integration.ts
```

The committed `.envrc` loads root `.env` automatically and adds the repo's local Node binaries to `PATH`. Keep secrets in ignored live env files, not in the checked-in examples.

## Self-Hosted Docker

The self-hosted default is a local SQLite/libSQL database mounted at `/data`.

```sh
cp .env.example .env
docker compose up -d --build
```

Important production values:

```env
NOTES_DB_PATH=/data/notes.sqlite
NOTES_LOGIN_USERNAME=owner
NOTES_LOGIN_PASSWORD=use-a-long-random-password
NOTES_AUTH_SESSION_DAYS=90
NOTES_TRUST_PROXY_HEADERS=false
NOTES_SERVER_SECRET=use-a-long-random-server-secret
NOTES_METRICS_PUBLIC=false
NOTES_REMOTE_SYNC_ENABLED=true
NOTES_CLEANUP_ENABLED=true
NOTES_CLEANUP_RUN_ON_START=true
NOTES_CLEANUP_INTERVAL_MINUTES=1440
NOTES_BACKUP_ENABLED=true
NOTES_BACKUP_RUN_ON_START=true
NOTES_BACKUP_INTERVAL_MINUTES=1440
NOTES_BACKUP_RETENTION_COUNT=14
```

Back up the Docker volume or bind-mount `/data` somewhere you already back up. The built-in scheduler writes SQLite snapshots to `/data/backups` when backups are enabled.

Run exactly one app instance for a given SQLite database. The server has in-process write serialization and remote-sync queues; two containers pointed at the same local SQLite file can race those queues.

## Cloudflare Workers and Turso

For the fastest free hosted setup with the cleanest sync behavior, deploy the SvelteKit app to Cloudflare Workers and use Turso as the primary SQLite/libSQL database.

Create the Turso database:

```sh
turso auth login
turso db create author
turso db show --url author
turso db tokens create author
```

Set the Worker secrets:

```sh
cd apps/web
aube exec wrangler secret put TURSO_DATABASE_URL
aube exec wrangler secret put TURSO_AUTH_TOKEN
aube exec wrangler secret put NOTES_LOGIN_PASSWORD
aube exec wrangler secret put NOTES_SERVER_SECRET
```

`apps/web/wrangler.jsonc` sets `NOTES_DB_PROVIDER=turso`, so Cloudflare Workers use Turso directly as the primary database. The app initializes the Turso schema on first API access, using the same idempotent schema/migration code as local SQLite.

Then deploy:

```sh
cd apps/web
aube run cf:deploy
```

For GitHub Actions deploys, add these repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: an API token allowed to deploy Workers.
- `TURSO_DATABASE_URL`: the Turso database URL from `turso db show --url author`.
- `TURSO_AUTH_TOKEN`: the Turso database token from `turso db tokens create author`.
- `NOTES_LOGIN_PASSWORD`: the production login password.
- `NOTES_SERVER_SECRET`: the stable server secret used to encrypt 2FA seeds.
- `NOTES_AUTH_SESSION_DAYS`: optional session lifetime.
- `NOTES_METRICS_TOKEN`: optional bearer or `x-author-metrics-token` value for scraping `/api/metrics`.
- `NOTES_SIGNUP_ALLOWED_EMAILS`: optional comma-separated signup email allow list.
- `AUTHOR_API_URL`: optional public API URL override.

The workflow syncs the GitHub app secrets into Cloudflare Worker secrets with `wrangler secret bulk` before deploying the Worker. If you deploy manually, run the `wrangler secret put` commands above once before using the app.

The `Cloudflare Deploy` workflow only deploys from `main`. It runs on pushes to `main` that touch the web app, shared packages, or lockfile, and manual runs from other branches are skipped.

### Cloudflare Workers Builds

If you connect the repository directly in Cloudflare Workers Builds, use a
custom install/build command. Cloudflare's build image defaults to Node 22 and
does not install Aube projects automatically, so the dashboard must be pointed
at the repo's package manager and Node version.

In the Worker dashboard, go to `Settings > Build` and set:

```text
Root directory: /
Build command: npx -y @endevco/aube@1.8.0 install --frozen-lockfile && npx -y @endevco/aube@1.8.0 run cf:build
Deploy command: ./apps/web/node_modules/.bin/wrangler deploy --config apps/web/wrangler.jsonc
Non-production branch deploy command: ./apps/web/node_modules/.bin/wrangler versions upload --config apps/web/wrangler.jsonc
```

Add these build variables:

```text
NODE_VERSION=24
SKIP_DEPENDENCY_INSTALL=1
```

Do not use `npm run build` or `aube run build` for Workers Builds. Those build
the Node/self-hosted adapter output under `apps/web/build`; Workers need
`apps/web/.svelte-kit/cloudflare/_worker.js`, which is produced by
`cf:build`.

For local Cloudflare-style development:

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars
aube -F @author/web run cf:dev
```

The `.dev.vars` file should set `NOTES_DB_PROVIDER=turso` and keep `NOTES_REMOTE_SYNC_ENABLED=false`; that matches the Worker runtime where Turso is the primary database rather than a mirror. Do not expose the Turso token to browser code. It belongs only in the SvelteKit server or Cloudflare Worker environment.

## Remote Database

For Docker/self-hosted deployments, Turso can also be used as an optional remote mirror. The deployed Docker API keeps a local SQLite database active; Turso is reconciled before reads and after writes.

If you did not already create a Turso database for Cloudflare:

```sh
turso auth login
turso db create author
turso db show --url author
turso db tokens create author
```

Then set:

```env
NOTES_DB_PATH=/data/notes.sqlite
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-turso-token
NOTES_LOGIN_USERNAME=owner
NOTES_LOGIN_PASSWORD=change-this-login-password
NOTES_AUTH_SESSION_DAYS=90
NOTES_TRUST_PROXY_HEADERS=false
NOTES_SERVER_SECRET=change-this-server-secret
NOTES_METRICS_PUBLIC=false
NOTES_REMOTE_SYNC_ENABLED=true
NOTES_CLEANUP_ENABLED=true
NOTES_CLEANUP_RUN_ON_START=true
NOTES_CLEANUP_INTERVAL_MINUTES=1440
NOTES_BACKUP_ENABLED=true
NOTES_BACKUP_RUN_ON_START=true
NOTES_BACKUP_INTERVAL_MINUTES=1440
NOTES_BACKUP_RETENTION_COUNT=14
```

Do not expose the Turso token to browser code. It belongs only in the SvelteKit server environment.

For a self-hosted app with a remote database, keep the app container on your server and set the Turso variables in `.env`. Only the server talks to Turso; browser sync still talks to your `/api/*` endpoints.

Android sync follows the same rule: the APK talks to the Author HTTP API, and that server mirrors to Turso when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set. Configure the Android API endpoint at build time with:

```env
AUTHOR_API_URL=https://your-author-api.example.com
```

For local emulator development, use `AUTHOR_API_URL=http://10.0.2.2:5173`.
`ANDROID_SYNC_API_URL`, `ANDROID_SYNC_SERVER_URL`, and `NOTES_SYNC_SERVER_URL`
are still accepted as backwards-compatible aliases. Do not set this value to
`TURSO_DATABASE_URL`; Android never receives the Turso auth token and does not
talk directly to Turso.

## Android APK Update Notifications

The Android app is sideloaded, so it checks GitHub instead of relying on Play Store update delivery. On startup the app schedules a delayed background check, then recurring background checks after that; the network update check itself runs later in WorkManager and does not block app launch. The default startup delay is 10 minutes, and the default recurring interval is 12 hours.

The default check URL reads the latest GitHub release metadata and looks for an
Android APK asset:

```env
ANDROID_UPDATE_CHECK_URL=https://api.github.com/repos/ivanarena/author/releases/latest
ANDROID_UPDATE_DOWNLOAD_URL=https://github.com/ivanarena/author/releases/latest
ANDROID_UPDATE_STARTUP_DELAY_MINUTES=10
ANDROID_UPDATE_CHECK_INTERVAL_HOURS=12
```

When the remote `versionCode` is higher than the installed APK's `versionCode`,
or the latest GitHub Android release version is newer than the installed
`versionName`, the app posts a local notification. Tapping it opens the APK asset
URL when one is present, otherwise `ANDROID_UPDATE_DOWNLOAD_URL`.

For a private GitHub repo, prefer publishing a small public JSON manifest instead of embedding a GitHub token in the APK:

```json
{
  "versionCode": 2,
  "versionName": "1.1",
  "apkUrl": "https://github.com/ivanarena/author/releases/latest"
}
```

Point `ANDROID_UPDATE_CHECK_URL` at that JSON file. Clients need to launch the app once after installing this build and allow Android notifications; Android may delay periodic background work, so this is near-periodic notification rather than instant push.

## Users

Create or reset a DB-backed user with:

```sh
aube -F @author/web run user:create -- iarena --random
```

Use the printed password once in the web UI. Resetting a password revokes that user's existing sessions; sign in again on each browser after a reset.

## TLS Reverse Proxy

Terminate HTTPS before the app and proxy to the container over localhost or a private Docker network. The app sets CSP, Referrer-Policy, Permissions-Policy, X-Frame-Options, X-Content-Type-Options, and HSTS on secure requests.

Caddy:

```caddyfile
author.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name author.example.com;

  ssl_certificate /etc/letsencrypt/live/author.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/author.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Set `NOTES_TRUST_PROXY_HEADERS=true` only when the proxy strips untrusted incoming `X-Forwarded-*` / `X-Real-IP` headers and sets its own. This affects login/signup throttling and HSTS detection behind a proxy.

## Health and Metrics

- `/api/health` returns JSON liveness.
- `/api/metrics` returns Prometheus text for process uptime and remote-sync state. It requires a signed-in session by default. For Prometheus, set `NOTES_METRICS_TOKEN` and send it as `x-author-metrics-token` or a bearer token. Set `NOTES_METRICS_PUBLIC=true` only on a trusted private network.

Ship container stdout/stderr to your host logs. Remote sync failures and cleanup failures are logged without secrets; use the in-app sync debug panel for the last client-side sync error.

## Backup and Restore Drill

For local SQLite, stop writes first, then copy `/data/notes.sqlite` and any `-wal` / `-shm` siblings if present:

```sh
docker compose stop notes
cp /path/to/data/notes.sqlite ./backup/notes.sqlite
docker compose up -d notes
```

Restore into a fresh path and smoke-check before replacing production:

```sh
cp ./backup/notes.sqlite /path/to/restore/notes.sqlite
NOTES_DB_PATH=/path/to/restore/notes.sqlite aube -F @author/web run db:check
```

Practice this after schema migrations and before relying on a new release. Turso restores should use Turso's managed backup/export flow, then run `db:check` against an app pointed at the restored database.

Scheduled local backups are written as standalone `.sqlite` files under `NOTES_BACKUP_DIR` or, by default, the database directory's `backups/` folder. Restore them the same way as a manual copy: point `NOTES_DB_PATH` at a copied backup file and run `db:check` before replacing production.

## Cleanup Schedule

Trash cleanup runs inside the server process. By default it runs once shortly after startup and then every 1440 minutes.
When remote mirroring is enabled, successful cleanup runs immediately trigger a remote database sync so hard-delete tombstones are not left only in local SQLite.

Set `NOTES_CLEANUP_ENABLED=false` if you prefer an external cron job:

```sh
aube -F @author/web run cleanup
```

For the current-only AES/Argon2 release line, use the explicit cleanup task when
a database still contains pre-`enc:v3` note envelopes or pre-Argon2 account
verifiers. It writes backups first, tombstones active unsupported notes and
notebooks, purges unsupported version snapshots, deletes old verifier account
rows, and then applies pending schema migrations:

```sh
aube -F @author/web run cleanup:current-only -- --target=both --apply
```

## Development

```sh
aube install
aube -F @author/web run dev
```

The app works offline immediately because all note edits go to IndexedDB first.

## Seeding

```sh
aube -F @author/web run seed
```

This clears the configured server database, then seeds the deterministic fixture notebooks and notes.

## CI/CD

GitHub Actions includes:

- `.github/workflows/ci.yml`: install, check, unit tests, coverage, Playwright browser sync tests, Android debug/release validation, connected Android tests, build.
- `.github/workflows/docker.yml`: build and publish a GHCR image on pushes to `main`, attach SBOM/provenance, run Trivy scanning, and keylessly sign pushed images. Pull requests build and scan without publishing.
