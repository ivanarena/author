# Operations

## Signup

Signup is closed by default. Keep `NOTES_SIGNUP_ENABLED=false` for a personal app and create users with:

```sh
aube -F @author/web run user:create -- owner --random
```

To allow controlled signup, set `NOTES_SIGNUP_INVITE_CODES` to comma-separated codes. Open signup requires the explicit `NOTES_SIGNUP_ENABLED=true` flag.

## TLS and Headers

Run the app behind HTTPS. The SvelteKit hook sets CSP, HSTS on secure requests, Referrer-Policy, Permissions-Policy, X-Frame-Options, and X-Content-Type-Options.

Set `NOTES_TRUST_PROXY_HEADERS=true` only behind a proxy that overwrites incoming forwarding headers. Otherwise keep it false.

## Instances

Run one app process per SQLite database. The local write queue and remote mirror queue are in-process. Multiple containers against the same SQLite file are not supported.

## Monitoring

- `/api/health`: liveness JSON.
- `/api/metrics`: Prometheus text for uptime and remote-sync state.
- Logs: stdout/stderr. Warnings include remote mirror failures and scheduler failures, without Turso tokens or session tokens.

## Backups

Before upgrades:

1. Stop the app or otherwise pause writes.
2. Copy `notes.sqlite` plus any `notes.sqlite-wal` / `notes.sqlite-shm` files.
3. Restore the copy into a fresh path.
4. Run `NOTES_DB_PATH=/restore/notes.sqlite aube -F @author/web run db:check`.
5. Start the upgraded app only after the restore check passes.

Turso backups should be restored through Turso first, then checked with the app pointed at the restored database.

## Containers

The Docker workflow builds as non-root, emits SBOM/provenance, scans with Trivy, and signs pushed GHCR images with keyless Cosign. The scan reports findings without failing CI by default; review high/critical findings before public deployments.
