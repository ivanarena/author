# Setup

## Requirements

- Node.js 24 or newer
- Aube

The server uses libSQL. It always writes to a local SQLite file; when Turso is configured, the server treats it as a remote sync peer and reconciles both databases.

Recommended tool install:

```sh
curl https://mise.run | sh
mise use -g node@24
mise use -g aube@1.4.0
```

For fish:

```fish
curl https://mise.run/fish | sh
exec fish
mise use -g node@24
mise use -g aube@1.4.0
aube --version
```

## Environment

Copy `apps/web/.env.example` to `apps/web/.env`.

```env
NOTES_DB_PATH=.data/notes.sqlite
NOTES_LOGIN_USERNAME=owner
NOTES_LOGIN_PASSWORD=change-this-local-password
NOTES_AUTH_SESSION_DAYS=90
NOTES_TRUST_PROXY_HEADERS=false
NOTES_REMOTE_SYNC_ENABLED=true
NOTES_SIGNUP_ENABLED=false
NOTES_CLEANUP_ENABLED=true
NOTES_CLEANUP_RUN_ON_START=true
NOTES_CLEANUP_INTERVAL_MINUTES=1440
```

`NOTES_LOGIN_USERNAME` and `NOTES_LOGIN_PASSWORD` bootstrap the first local user if it does not already exist. After login, the server returns a random session token, which the browser stores in local storage for later sync requests.
In production, there is no fallback password; set `NOTES_LOGIN_PASSWORD` or create a user before expecting browser login to work.

Signup is disabled by default. For a personal deployment, keep `NOTES_SIGNUP_ENABLED=false` and create users with `aube -F @author/web run user:create -- username --random`. If you intentionally want browser signup, set `NOTES_SIGNUP_ENABLED=true`; for invite-only signup, leave that false and set `NOTES_SIGNUP_INVITE_CODES` to a comma-separated list of invite codes.

`NOTES_AUTH_TOKEN` is no longer used by default. If an older client still depends on the old static bearer token, set `NOTES_LEGACY_AUTH_TOKEN_ENABLED=true` temporarily and rotate away from it.

Leave `NOTES_TRUST_PROXY_HEADERS=false` unless your reverse proxy strips incoming `X-Forwarded-For` / `X-Real-IP` headers and sets trusted ones itself. It only affects login throttling.

When Turso variables are present, the server keeps local SQLite active and mirrors local/remote records in both directions before reads and after writes. Set `NOTES_REMOTE_SYNC_ENABLED=false` to force local-only behavior temporarily.

If you use direnv, put your live values in the ignored root `.env` file and run:

```sh
direnv allow
cd apps/web
tsx scripts/check-db-integration.ts
```

The committed `.envrc` loads root `.env` automatically and adds the repo's local Node binaries to `PATH`.

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
NOTES_REMOTE_SYNC_ENABLED=true
NOTES_SIGNUP_ENABLED=false
NOTES_CLEANUP_ENABLED=true
NOTES_CLEANUP_RUN_ON_START=true
NOTES_CLEANUP_INTERVAL_MINUTES=1440
```

Back up the Docker volume or bind-mount `/data` somewhere you already back up.

Run exactly one app instance for a given SQLite database. The server has in-process write serialization and remote-sync queues; two containers pointed at the same local SQLite file can race those queues.

## Remote Database

The best free fit for this app is Turso because it is SQLite-compatible and the app already uses libSQL. The deployed API still keeps a local SQLite database active; Turso is an optional remote copy that is reconciled before reads and after writes.

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
NOTES_REMOTE_SYNC_ENABLED=true
NOTES_CLEANUP_ENABLED=true
```

Do not expose the Turso token to browser code. It belongs only in the SvelteKit server environment.

For a self-hosted app with a remote database, keep the app container on your server and set the Turso variables in `.env`. Only the server talks to Turso; browser sync still talks to your `/api/*` endpoints.

Android sync follows the same rule: the APK talks to the Author HTTP API, and that server mirrors to Turso when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set. Configure the Android API endpoint at build time with:

```env
AUTHOR_NOTES_API_URL=https://your-author-api.example.com
```

For local emulator development, use `AUTHOR_NOTES_API_URL=http://10.0.2.2:5173`.
`ANDROID_SYNC_API_URL`, `ANDROID_SYNC_SERVER_URL`, and `NOTES_SYNC_SERVER_URL`
are still accepted as backwards-compatible aliases. Do not set this value to
`TURSO_DATABASE_URL`; Android never receives the Turso auth token and does not
talk directly to Turso.

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
notes.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name notes.example.com;

  ssl_certificate /etc/letsencrypt/live/notes.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/notes.example.com/privkey.pem;

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
- `/api/metrics` returns Prometheus text for process uptime and remote-sync state.

Ship container stdout/stderr to your host logs. Remote sync failures and cleanup failures are logged without secrets; use the in-app sync debug panel for the last client-side sync error.

## Backup and Restore Drill

For local SQLite, stop writes first, then copy `/data/notes.sqlite` and any `-wal` / `-shm` siblings if present:

```sh
docker compose stop author
cp /path/to/data/notes.sqlite ./backup/notes.sqlite
docker compose up -d author
```

Restore into a fresh path and smoke-check before replacing production:

```sh
cp ./backup/notes.sqlite /path/to/restore/notes.sqlite
NOTES_DB_PATH=/path/to/restore/notes.sqlite aube -F @author/web run db:check
```

Practice this after schema migrations and before relying on a new release. Turso restores should use Turso's managed backup/export flow, then run `db:check` against an app pointed at the restored database.

## Cleanup Schedule

Trash cleanup runs inside the server process. By default it runs once shortly after startup and then every 1440 minutes.

Set `NOTES_CLEANUP_ENABLED=false` if you prefer an external cron job:

```sh
aube -F @author/web run cleanup
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
- `.github/workflows/docker.yml`: build and publish a GHCR image on pushes to `main` and version tags, attach SBOM/provenance, run Trivy scanning, and keylessly sign pushed images.
