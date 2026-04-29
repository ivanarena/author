# Setup

## Requirements

- Node.js 24 or newer
- Aube

The server uses libSQL. In local development it writes to a SQLite file; in remote mode it connects to Turso with the same repository code.

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
NOTES_DB_PROVIDER=local
NOTES_DB_PATH=.data/notes.sqlite
NOTES_AUTH_TOKEN=change-this-local-token
NOTES_LOGIN_PASSWORD=change-this-local-password
NOTES_CLEANUP_ENABLED=true
NOTES_CLEANUP_RUN_ON_START=true
NOTES_CLEANUP_INTERVAL_MINUTES=1440
```

`NOTES_LOGIN_PASSWORD` is entered once in the web UI. The server returns `NOTES_AUTH_TOKEN`, which the browser stores in local storage for later sync requests.

## Self-Hosted Docker

The self-hosted default is a local SQLite/libSQL database mounted at `/data`.

```sh
cp .env.example .env
docker compose up -d --build
```

Important production values:

```env
NOTES_DB_PROVIDER=local
NOTES_DB_PATH=/data/notes.sqlite
NOTES_AUTH_TOKEN=use-a-long-random-token
NOTES_LOGIN_PASSWORD=use-a-long-random-password
NOTES_CLEANUP_ENABLED=true
NOTES_CLEANUP_RUN_ON_START=true
NOTES_CLEANUP_INTERVAL_MINUTES=1440
```

Back up the Docker volume or bind-mount `/data` somewhere you already back up.

## Remote Database

The best free fit for this app is Turso because it is SQLite-compatible and the app already uses libSQL. Keep local mode for development, then use Turso for the deployed API.

```sh
turso auth login
turso db create author-notes
turso db show --url author-notes
turso db tokens create author-notes
```

Then set:

```env
NOTES_DB_PROVIDER=turso
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-turso-token
NOTES_AUTH_TOKEN=change-this-server-token
NOTES_LOGIN_PASSWORD=change-this-login-password
NOTES_CLEANUP_ENABLED=true
```

Do not expose the Turso token to browser code. It belongs only in the SvelteKit server environment.

For a self-hosted app with a remote database, keep the app container on your server and set the Turso variables in `.env`. Only the server talks to Turso; browser sync still talks to your `/api/*` endpoints.

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
