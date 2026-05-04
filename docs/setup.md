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
NOTES_CLEANUP_ENABLED=true
NOTES_CLEANUP_RUN_ON_START=true
NOTES_CLEANUP_INTERVAL_MINUTES=1440
```

`NOTES_LOGIN_USERNAME` and `NOTES_LOGIN_PASSWORD` bootstrap the first local user if it does not already exist. After login, the server returns a random session token, which the browser stores in local storage for later sync requests.
In production, there is no fallback password; set `NOTES_LOGIN_PASSWORD` or create a user before expecting browser login to work.

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
NOTES_CLEANUP_ENABLED=true
NOTES_CLEANUP_RUN_ON_START=true
NOTES_CLEANUP_INTERVAL_MINUTES=1440
```

Back up the Docker volume or bind-mount `/data` somewhere you already back up.

## Remote Database

The best free fit for this app is Turso because it is SQLite-compatible and the app already uses libSQL. The deployed API still keeps a local SQLite database active; Turso is an optional remote copy that is reconciled before reads and after writes.

```sh
turso auth login
turso db create author-notes
turso db show --url author-notes
turso db tokens create author-notes
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

## Users

Create or reset a DB-backed user with:

```sh
aube -F @author/web run user:create -- iarena --random
```

Use the printed password once in the web UI. Resetting a password revokes that user's existing sessions; sign in again on each browser after a reset.

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

- `.github/workflows/ci.yml`: install, check, unit tests, Playwright browser sync tests, build.
- `.github/workflows/docker.yml`: build and publish a GHCR image on pushes to `main` and version tags.
