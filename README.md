# Author Notes

A super minimal local-first notes app for personal use.

The web app opens directly into a blank note, writes instantly to IndexedDB, and syncs to a small Hono API running inside SvelteKit. The self-hosted default is local SQLite/libSQL on disk; Turso/libSQL is available as an optional remote database. The data contracts live in shared packages so a future Kotlin Android app can implement the same model and sync protocol.

## Quick Start

Install Node.js 24 or newer and Aube first. The recommended path is `mise`:

```sh
curl https://mise.run | sh
mise use -g node@24
mise use -g aube@1.4.0
aube --version
```

Then run the app:

```sh
cp apps/web/.env.example apps/web/.env
aube install
aube -F @author/web run dev
```

Open the URL printed by Vite. The default local login password is `local-dev-password` and the default token is `local-dev-token`; change both in `apps/web/.env` for real use.

## Scripts

```sh
aube -F @author/web run dev    # SvelteKit web app and API
aube -F @author/web run seed   # Seed the SQLite database
aube run mock:browser          # Open a persistent browser profile filled with mock notes
aube run test                  # Backend, sync, and conflict tests
aube run test:e2e              # Browser IndexedDB sync tests
aube -F @author/web run check  # Svelte and TypeScript checks
aube -F @author/web run build  # Production web build
```

## Self-Hosting

Copy the root env example and change the secrets:

```sh
cp .env.example .env
docker compose up -d --build
```

The container stores SQLite data in the `author-notes-data` volume at `/data/notes.sqlite`.

## Monorepo

- `apps/web` is the SvelteKit web app, local Dexie store, Hono API, and self-host server.
- `apps/android` is a placeholder for the future Kotlin app.
- `packages/schema` defines Note, Notebook, Device, and shared sync metadata types.
- `packages/api-types` defines API request and response contracts.
- `packages/sync-spec` contains executable sync helpers plus protocol docs.
- `packages/test-fixtures` contains deterministic records used by tests and seed scripts.
- `docs` contains architecture notes.
- `tests` is reserved for cross-app integration tests.

See `docs/package-manager.md` for the Aube workflow.

## Design Intent

No blocks, toolbars, slash commands, public sharing, collaboration, Markdown rendering, or rich text. Notes have a title plus a plain text body. Network activity never blocks writing.

## Visual Mock Data

Start the dev server, then run:

```sh
aube run mock:browser
```

The script opens Chromium with a persistent profile under `apps/web/.data/mock-browser-profile` and fills IndexedDB with mock notebooks and notes. Re-running it refreshes only records whose ids start with `mock-`.
