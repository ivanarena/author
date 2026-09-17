# Self-Hosting Author

This guide is for a single-user or small trusted deployment of Author with
Docker Compose and local SQLite. Author is local-first: browser and Android
clients write locally before they sync to this server.

Author is not a turnkey public SaaS. If you offer accounts to other people, you
become the service operator and are responsible for access policy, privacy and
terms, abuse handling, backups, monitoring, and applicable law.

## What You Need

- A Linux host with Docker Engine and Docker Compose v2
- A domain name and HTTPS reverse proxy for access outside the host
- Persistent storage with a separate backup destination
- A tagged Author release from
  [GitHub Releases](https://github.com/ivanarena/author/releases)

Do not deploy a moving development branch as production. Check out the release
tag you intend to run and read its release notes first.

## 1. Clone a Release

```sh
git clone https://github.com/ivanarena/author.git
cd author
git checkout vX.Y.Z
```

Replace `vX.Y.Z` with a published release tag. Verify the tag and source commit
shown on the release page before continuing.

## 2. Create the Configuration

```sh
cp .env.example .env
chmod 600 .env
```

Edit `.env` and replace every `change-this` or `use-a-long-random` placeholder.
Generate independent secrets; do not reuse the account password as the server
or metrics secret.

```sh
openssl rand -hex 32 # NOTES_LOGIN_PASSWORD (or choose a 15+ character password)
openssl rand -hex 32 # NOTES_SERVER_SECRET
openssl rand -hex 32 # NOTES_METRICS_TOKEN
```

Required values for a private SQLite deployment:

```env
AUTHOR_DEPLOY_TARGET=production
HOST_PORT=3000
NOTES_DB_PATH=/data/notes.sqlite
NOTES_LOGIN_USERNAME=owner
NOTES_LOGIN_PASSWORD=replace-with-a-unique-password
NOTES_SERVER_SECRET=replace-with-an-independent-random-secret
NOTES_METRICS_PUBLIC=false
NOTES_METRICS_TOKEN=replace-with-an-independent-random-token
NOTES_REMOTE_SYNC_ENABLED=false
```

`NOTES_LOGIN_PASSWORD` bootstraps the first account only when that account does
not exist. It is not a password-reset mechanism. Keep
`NOTES_SERVER_SECRET` stable across upgrades and restores because it protects
server-side authentication secrets such as TOTP seeds.

Leave Turso variables unset for the simplest self-hosted deployment. The local
SQLite database remains authoritative. See [Setup](setup.md) if you intentionally
want a Turso mirror or Cloudflare Workers deployment.

## 3. Validate and Start

```sh
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

The default port binding is `127.0.0.1:3000`; it is not exposed on every host
interface. Open the app through an HTTPS reverse proxy before using it over a
network.

Inspect startup failures without printing `.env`:

```sh
docker compose logs --tail=200 notes
```

The production server rejects known placeholder passwords and server secrets.
After the first successful login, save the E2EE recovery kit and recovery code
in separate secure locations.

## 4. Add HTTPS

Keep Author bound to localhost or a private container network and terminate TLS
with Caddy, Nginx, or another trusted reverse proxy.

Caddy example:

```caddyfile
author.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Set `NOTES_TRUST_PROXY_HEADERS=true` only when the proxy removes untrusted
incoming forwarding headers and writes its own. Otherwise leave it `false`.
Never expose Turso credentials, `NOTES_SERVER_SECRET`, metrics tokens, session
tokens, recovery material, or Android signing keys to browser configuration.

## Data and Backups

Compose stores the database and scheduled SQLite snapshots in the named
`author-data` volume mounted at `/data`. Scheduled snapshots default to
`/data/backups` and do not replace an off-host backup.

Before an upgrade, stop writes and copy the complete data directory:

```sh
mkdir -p backup/author-data
docker compose stop notes
docker compose cp notes:/data/. backup/author-data/
docker compose start notes
```

Copy that backup to a different machine or storage service. A backup on the
same Docker volume is not sufficient.

Practice restore into a disposable deployment. At minimum, copy a snapshot to
a separate host path and run the integration check from a source checkout:

```sh
NOTES_DB_PATH=/absolute/path/to/restored-notes.sqlite \
  aube -F @author/web run db:check
```

Keep the matching `NOTES_SERVER_SECRET` with protected restore material.
Encrypted TOTP seeds cannot be used after restoring with a different secret.
See [Operations](operations.md) for retention, monitoring, recovery kits, and
remote-mirror failure handling.

## Upgrades

1. Read the target release notes and migration warnings.
2. Export important notes as Markdown for an additional human-readable copy.
3. Stop writes and make an off-host backup.
4. Check out the exact new release tag.
5. Rebuild and start the container.
6. Verify health, login, note decryption, create/edit sync, export, and backup
   freshness.

```sh
git fetch --tags
git checkout vX.Y.Z
docker compose build --pull
docker compose up -d
curl --fail http://127.0.0.1:3000/api/health
```

Do not run two Author processes against the same SQLite file. Local write and
remote-mirror serialization is process-local.

## Android

A published Android APK must be built for your HTTPS Author API URL and signed
with a key you control. The upstream APK, when available, targets the upstream
configured service and is not automatically suitable for a fork or another
self-hosted domain. See the [Android README](../apps/android/README.md).

## Monitoring

- `GET /api/health` is the small public liveness endpoint.
- `GET /api/metrics` is private in production unless
  `NOTES_METRICS_PUBLIC=true`; authenticate with `NOTES_METRICS_TOKEN`.
- Container logs go to stdout/stderr and intentionally omit credentials.
- Monitor backup age, cleanup state, HTTP errors, and remote-sync state.

## Security Boundaries

Author encrypts note titles, bodies, notebook names, and account keyrings before
sync. It does not hide all metadata, and hosted web JavaScript can access
plaintext while the app is running. There has been no independent security
audit. Read [SECURITY.md](../SECURITY.md) and the in-app security model before
using Author for sensitive or critical records.

## Troubleshooting

- **The container rejects configuration:** replace every placeholder and ensure
  the login password is at least 15 characters.
- **Login fails after changing `.env`:** the bootstrap password does not reset an
  existing account. Use the account password flow or documented recovery-kit
  procedure.
- **The app works locally but not through the proxy:** verify WebSocket/HTTP
  forwarding, the public HTTPS origin, and trusted proxy settings.
- **Metrics return 401:** provide `Authorization: Bearer <token>` or
  `x-author-metrics-token` with `NOTES_METRICS_TOKEN`.
- **Remote mirroring stops:** do not discard either database. Follow the
  explicit divergence recovery guidance in [Operations](operations.md).

For security-sensitive problems, follow [SECURITY.md](../SECURITY.md). For
ordinary setup questions, use [SUPPORT.md](../SUPPORT.md).
