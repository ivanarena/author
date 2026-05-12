# Operations

## Signup

Signup is invite-only when a remote database is configured. The default invite code is seeded into local and remote `invitation_codes` tables:

```text
authorprivatefriendsonly
```

Disable an invite by setting its `disabled_at` value. `NOTES_SIGNUP_INVITE_CODES` can add temporary env-only invite codes for controlled rollouts.

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

The Docker workflow builds as non-root, scans the local image with Trivy before publishing, fails CI on high or critical findings, emits SBOM/provenance for pushed images, and signs pushed GHCR images with keyless Cosign. Review the uploaded SARIF artifact before public deployments.
