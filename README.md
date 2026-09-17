# Author

[![CI](https://github.com/ivanarena/author/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ivanarena/author/actions/workflows/ci.yml)
[![Security](https://github.com/ivanarena/author/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/ivanarena/author/actions/workflows/security.yml)
[![Docker](https://github.com/ivanarena/author/actions/workflows/docker.yml/badge.svg?branch=main)](https://github.com/ivanarena/author/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 24.12+](https://img.shields.io/badge/node-%3E%3D24.12-5FA04E)
![Aube 1.16](https://img.shields.io/badge/package_manager-aube%201.16-111827)

A minimal, local-first, self-hostable notes app for plain-text writing.

Author opens directly into the editor, saves browser and Android changes locally
before using the network, and synchronizes through a small Hono API. The default
self-hosted deployment uses SQLite/libSQL on disk. An optional Turso mirror is
available for Node deployments, while Cloudflare Workers use Turso as their
primary database.

## Features

- Plain-text title and body editing without blocks or rich-text storage
- Offline-first browser storage with queued synchronization
- Native Android app with an encrypted SQLCipher database
- Client-encrypted note titles, bodies, notebook names, and account keyrings
- Explicit version conflicts instead of silent remote overwrites
- Notebooks, favorites, trash, local note history, search, and Markdown ZIP
  import/export
- Password challenge/proof login, optional TOTP, trusted-device login, and E2EE
  recovery kits
- Docker/SQLite self-hosting, optional Turso mirroring, and Cloudflare Workers
  support
- Scheduled SQLite snapshots, Prometheus metrics, cleanup, health checks, and
  release security gates

Author does **not** claim independently audited cryptography, hardened
zero-knowledge delivery, or protection from malicious hosted web JavaScript.
See [SECURITY.md](SECURITY.md) before relying on it for sensitive data.

## Self-Host with Docker

For production, use a tagged release from
[GitHub Releases](https://github.com/ivanarena/author/releases), not a moving
development branch.

Requirements:

- Docker Engine and Docker Compose v2
- Persistent storage and an off-host backup destination
- An HTTPS reverse proxy for access outside the server

```sh
git clone https://github.com/ivanarena/author.git
cd author
git checkout vX.Y.Z
cp .env.example .env
chmod 600 .env
$EDITOR .env
docker compose config
docker compose build --pull
docker compose up -d
curl --fail http://127.0.0.1:3000/api/health
```

Replace `vX.Y.Z` with a published release and replace every `change-this` or
`use-a-long-random` value in `.env`. At minimum, configure independent values
for `NOTES_LOGIN_PASSWORD`, `NOTES_SERVER_SECRET`, and
`NOTES_METRICS_TOKEN`. The login password must be at least 15 characters.

Compose binds to `127.0.0.1:3000` by default, runs as a non-root user with a
read-only root filesystem, and stores the SQLite database and scheduled
snapshots in the `author-data` volume. Put Caddy, Nginx, or another trusted HTTPS
proxy in front before accessing it over a network.

Read the complete [self-hosting guide](docs/self-hosting.md) before exposing the
app. It covers secret generation, TLS, first login, backups, restores, upgrades,
Android, monitoring, and security boundaries.

## Local Development

Install Node.js 24.12 or newer and Aube 1.16.0. The recommended tool manager is
[mise](https://mise.jdx.dev/):

```sh
curl https://mise.run | sh
mise use -g node@24
mise use -g aube@1.16.0
cp apps/web/.env.example apps/web/.env
aube install
aube -F @author/web run dev
```

Open the URL printed by Vite. The development template uses a placeholder
bootstrap password; replace it before the first login. If
`NOTES_LOGIN_PASSWORD` is omitted in development only, the fallback is
`local-dev-password`.

Useful commands:

```sh
aube -F @author/web run dev
aube -F @author/web run user:create -- owner --random
aube -F @author/web run signup:invite -- you@example.com
aube run mock:browser
aube run quality
aube run test
aube run test:e2e
aube -F @author/web run build
aube run android:verify
aube run android:verify:connected
```

Install Playwright browsers once before local E2E tests:

```sh
aube -F @author/web exec -- playwright install chromium
```

The repository uses Aube and `aube-lock.yaml`. Do not add npm, pnpm, Yarn, or
Bun lockfiles. See [docs/package-manager.md](docs/package-manager.md).

## Android

The Kotlin/Compose client stores local data in SQLCipher and synchronizes with
the same Author HTTP API as the web app. Turso credentials always stay on the
server.

Build a debug APK:

```sh
cd apps/android
./gradlew :app:assembleDebug
```

A self-hosted release APK must be built with your public HTTPS API URL and
signed with a key you control:

```sh
AUTHOR_API_URL=https://author.example.com \
  ./gradlew :app:lintRelease :app:assembleRelease
```

See [apps/android/README.md](apps/android/README.md) for emulator, signing,
release, update, and local-storage details.

## Architecture

- `apps/web` — SvelteKit web app, IndexedDB client, Hono API, SQLite/libSQL
  server, Cloudflare Worker build, and Playwright tests
- `apps/android` — Kotlin/Compose app, SQLCipher storage, and WorkManager sync
- `packages/schema` — shared note, notebook, device, and retention contracts
- `packages/api-types` — shared API request and response contracts
- `packages/sync-spec` — executable sync and conflict invariants
- `packages/test-fixtures` — deterministic fixtures for tests and seed scripts
- `docs` — setup, operations, protocol, architecture, and release guidance

Network activity never blocks local typing, notebook changes, import/export, or
trash actions. See [docs/sync-protocol.md](docs/sync-protocol.md) and
[docs/conflict-handling.md](docs/conflict-handling.md).

## Documentation

- [Self-hosting](docs/self-hosting.md)
- [Setup and deployment options](docs/setup.md)
- [Operations, backups, and monitoring](docs/operations.md)
- [Production readiness and release gates](docs/production-readiness.md)
- [Public GitHub publication checklist](docs/publication-checklist.md)
- [Database schema](docs/database-schema.md)
- [Project structure](docs/project-structure.md)
- [Security policy and threat model](SECURITY.md)
- [Support](SUPPORT.md)

## Import and Export

Author imports a Markdown folder where folders are notebooks and `.md` files are
notes with frontmatter, and exports the same layout as a ZIP. Author frontmatter
preserves record IDs, notebook names, favorite/trash state, and
timezone-qualified timestamps. This is a portable, human-readable export—not a
replacement for database backups or local note-history retention.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Please report vulnerabilities privately
using [SECURITY.md](SECURITY.md).

## License

Author is licensed under the [MIT License](LICENSE). See
[ASSET_PROVENANCE.md](ASSET_PROVENANCE.md) for project artwork and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party software and
fonts.
