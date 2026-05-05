# Author Notes

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![Docker](../../actions/workflows/docker.yml/badge.svg)](../../actions/workflows/docker.yml)
![Node 24+](https://img.shields.io/badge/node-%3E%3D24-5FA04E)
![Aube 1.4](https://img.shields.io/badge/package_manager-aube%201.4-111827)
![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-F7B93E)
![Lint: ESLint](https://img.shields.io/badge/lint-eslint-4B32C3)
![Coverage: Vitest](https://img.shields.io/badge/coverage-vitest-6E9F18)

A super minimal local-first notes app for personal use.

The web app opens directly into a blank note, writes instantly to IndexedDB, and syncs to a small Hono API running inside SvelteKit. The self-hosted default is local SQLite/libSQL on disk; when Turso/libSQL is configured the server keeps SQLite active and mirrors local/remote records in both directions. The data contracts live in shared packages so a future Kotlin Android app can implement the same model and sync protocol.

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

Open the URL printed by Vite. The default local login is `owner` / `local-dev-password`; change it in `apps/web/.env` or create a DB-backed user with `aube -F @author/web run user:create -- iarena --random` for real use.

## Scripts

```sh
aube -F @author/web run dev    # SvelteKit web app and API
aube -F @author/web run seed   # Reset and seed the SQLite database
aube -F @author/web run user:create -- iarena --random  # Create or reset a user
aube -F @author/web run db:check                        # Smoke-check DB/auth/sync
aube run mock:browser          # Open a persistent browser profile filled with mock notes
aube run test                  # Backend, sync, and conflict tests
aube run test:coverage         # Unit tests with coverage thresholds
aube run test:e2e              # Browser IndexedDB sync tests
aube run quality               # Format, lint, and Svelte/TypeScript checks
aube run deps:check            # Verify dependency links and resolution
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

## Import and Export

The note toolbar can import a Markdown folder where folders are notebooks and `.md` files are notes with frontmatter, then export the same Markdown/frontmatter layout as a ZIP. Imported records are added as pending local changes so the normal sync flow can publish them.

## Visual Mock Data

Start the dev server, then run:

```sh
aube run mock:browser
```

The script opens Chromium with a persistent profile under `apps/web/.data/mock-browser-profile` and fills IndexedDB with mock notebooks and notes. Re-running it refreshes only records whose ids start with `mock-`.
