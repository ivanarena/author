# Operations

## Signup

Signup is email allow-list only when a remote database is configured. Add addresses to `signup_allowed_emails` in the remote database. `NOTES_SIGNUP_ALLOWED_EMAILS` can seed that table on startup for simple deployments.

## TLS and Headers

Run the app behind HTTPS. The SvelteKit hook sets CSP, HSTS on secure requests, Referrer-Policy, Permissions-Policy, X-Frame-Options, and X-Content-Type-Options.
Mutating API requests with an `Origin` header must match the configured public
API origin. Requests without `Origin` remain valid for Android and command-line
clients.

Set `NOTES_TRUST_PROXY_HEADERS=true` only behind a proxy that overwrites incoming forwarding headers. Otherwise keep it false.
Login and signup throttles are stored as hashed keys in the database so they
survive restarts and Worker isolate changes. Use platform-level protection as
an additional layer for public deployments.

Set `NOTES_SERVER_SECRET` to an independent high-entropy value in production.
It is required for server-side encryption of 2FA seeds and must not be derived
from or reused as the login password.
Cloudflare Workers need enough CPU budget for Argon2id password verification.
If login or signup returns 503 and Worker logs show an exceeded CPU limit,
raise the Worker CPU limit or plan; do not reduce Argon2id parameters as an
operational workaround.

## Instances

Run one app process per SQLite database. The local write queue and remote mirror queue are in-process. Multiple containers against the same SQLite file are not supported.
If the self-hosted local database and remote mirror contain different edits for the same record, the mirror job stops instead of choosing a winner. Restore one side from backup or export the intended record, then rerun the app so the next mirror pass can converge from a single source of truth.
Note reads, sync pulls, sync pushes, and trash cleanup do not wait for the
remote mirror. They update the local primary and queue the mirror worker so
typing and local maintenance are not blocked by Turso/network latency.

## Monitoring

- `/api/health`: liveness JSON.
- `/api/metrics`: Prometheus text for uptime and remote-sync state. It is authenticated by default; set `NOTES_METRICS_TOKEN` for scrapers, or `NOTES_METRICS_PUBLIC=true` only on a private trusted network.
- Logs: stdout/stderr. Warnings include remote mirror failures and scheduler failures, without Turso tokens or session tokens.

## Staging Remote Checks

Keep the staging Turso database isolated from production data. The remote smoke
workflow seeds only the dedicated `author-remote-test` account, verifies that
the database has no pre-Argon2 or pre-`enc:v3` blockers, and removes each
run-specific smoke note after the check. Do not point
`AUTHOR_REMOTE_TEST_DATABASE_URL` or `AUTHOR_REMOTE_TEST_API_URL` at production;
the scripts fail closed unless the target name looks like test, staging,
preview, smoke, or CI.

## Backups

Self-hosted Node deployments can write automatic local SQLite snapshots when
`NOTES_BACKUP_ENABLED=true`. Keep `NOTES_BACKUP_DIR` on a mounted path that is
included in your host backups. The scheduler uses SQLite `VACUUM INTO`, runs
after startup when `NOTES_BACKUP_RUN_ON_START=true`, repeats every
`NOTES_BACKUP_INTERVAL_MINUTES`, and keeps `NOTES_BACKUP_RETENTION_COUNT`
snapshot files.

Before upgrades:

1. Stop the app or otherwise pause writes.
2. Copy `notes.sqlite` plus any `notes.sqlite-wal` / `notes.sqlite-shm` files.
3. Restore the copy into a fresh path.
4. Run `NOTES_DB_PATH=/restore/notes.sqlite aube -F @author/web run db:check`.
5. Start the upgraded app only after the restore check passes.

Turso backups should be restored through Turso first, then checked with the app pointed at the restored database. Keep `NOTES_SERVER_SECRET` with the restore; encrypted 2FA seeds cannot be verified if that secret is lost or changed.

## Containers

The Docker workflow builds as non-root, scans the local image with Trivy before publishing, fails CI on high or critical findings, emits SBOM/provenance for pushed images, and signs pushed GHCR images with keyless Cosign. Review the uploaded SARIF artifact before public deployments.
