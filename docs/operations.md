# Operations

## Signup

Signup is email allow-list only when a remote database is configured. Add addresses to `signup_allowed_emails` in the remote database. `NOTES_SIGNUP_ALLOWED_EMAILS` can seed that table on startup for simple deployments.

## TLS and Headers

Run the app behind HTTPS. The SvelteKit hook sets CSP, HSTS on secure requests, Referrer-Policy, Permissions-Policy, X-Frame-Options, and X-Content-Type-Options.

Set `NOTES_TRUST_PROXY_HEADERS=true` only behind a proxy that overwrites incoming forwarding headers. Otherwise keep it false.
Login and signup throttles are stored as hashed keys in the database so they
survive restarts and Worker isolate changes. Use platform-level protection as
an additional layer for public deployments.

## Instances

Run one app process per SQLite database. The local write queue and remote mirror queue are in-process. Multiple containers against the same SQLite file are not supported.

## Monitoring

- `/api/health`: liveness JSON.
- `/api/metrics`: Prometheus text for uptime and remote-sync state.
- Logs: stdout/stderr. Warnings include remote mirror failures and scheduler failures, without Turso tokens or session tokens.

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

Turso backups should be restored through Turso first, then checked with the app pointed at the restored database.

## Containers

The Docker workflow builds as non-root, scans the local image with Trivy before publishing, fails CI on high or critical findings, emits SBOM/provenance for pushed images, and signs pushed GHCR images with keyless Cosign. Review the uploaded SARIF artifact before public deployments.
