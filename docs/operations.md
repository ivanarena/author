# Operations

## Signup

Signup requires both an allow-listed email and a signed, expiring invitation. Add addresses to `signup_allowed_emails` in the remote database (`NOTES_SIGNUP_ALLOWED_EMAILS` may seed it), then run `aube -F @author/web run signup:invite -- <email> [days]`. Deliver the code separately. The code is HMAC-bound to the email and expiry with `NOTES_SERVER_SECRET`; its SHA-256 hash is consumed atomically with account creation, so replay remains blocked after account deletion. Rotating the server secret invalidates outstanding invitations and encrypted TOTP recovery.

## TLS and Headers

Run the app behind HTTPS. The SvelteKit hook sets CSP, HSTS on secure requests, Referrer-Policy, Permissions-Policy, X-Frame-Options, and X-Content-Type-Options.
Mutating API requests with an `Origin` header must match the configured public
API origin. Requests without `Origin` remain valid for Android and command-line
clients.

Set `NOTES_TRUST_PROXY_HEADERS=true` only behind a proxy that overwrites incoming forwarding headers. Otherwise keep it false. Cloudflare Worker deploys use `NOTES_TRUST_CLOUDFLARE_HEADERS=true` so auth throttles can trust Cloudflare's `CF-Connecting-IP`; keep that false unless Cloudflare is the trusted edge.
Login and signup throttles are stored as hashed keys in the database so they
survive restarts and Worker isolate changes. Use platform-level protection as
an additional layer for public deployments.

Set `NOTES_SERVER_SECRET` to an independent high-entropy value in production.
It is required for server-side encryption of 2FA seeds and must not be derived
from or reused as the login password.
Password authentication uses client-side Argon2id plus a server challenge/proof
verifier. This keeps Workers request CPU low while preserving Argon2id cost for
offline password guessing after a database leak. It does not make the web app
immune to JavaScript compromise: XSS, a malicious deployed bundle, or a
compromised origin can still read passwords, local encryption key material, and
decrypted note content. Keep the CSP strict, avoid third-party scripts, treat
supply-chain alerts as release blockers, switch browser key storage to
session-only for higher-risk browsers, and prefer Android or another local
client for stronger protection against mutable web code.

Account E2EE uses a client-side keyring. The database stores only the wrapped
`users.e2ee_keyring` value, not plaintext note keys or recovery codes. Tell
users to download a fresh recovery kit after signup, after password changes, and
after any suspected local-key loss. The kit and its recovery code must be stored
separately; losing both the password unwrap and recovery material can make
encrypted notes unrecoverable even when the account database is intact.
For recovery drills or operator-assisted repair, the web package includes
`aube -F @author/web run e2ee:recover`. Provide
`AUTHOR_RECOVERY_KIT_PATH`, `AUTHOR_RECOVERY_CODE`,
`AUTHOR_RECOVERY_USERNAME`, and `AUTHOR_RECOVERY_NEW_PASSWORD`; the script
prints SQL to reset that account's password verifier, revoke active
sessions/trusted-device login, and update `users.e2ee_keyring`, or JSON when
`AUTHOR_RECOVERY_OUTPUT=json`.
Do not use a plain password reset for an account that already has an
`e2ee_keyring`: the server rejects that path because it would leave note keys
wrapped by the old password. Use the recovery script so the replacement
password verifier and replacement keyring wrap are updated together.

## Instances

Run one app process per SQLite database. The local write queue and remote mirror queue are in-process. Multiple containers against the same SQLite file are not supported.
If the self-hosted local database and remote mirror contain different unmirrored edits for the same record, the mirror job stops instead of choosing a winner. The mirror uses its opposite-direction cursor to distinguish an unchanged target from an unmirrored target edit and preserves source record versions exactly. Restore one side from backup or export the intended record, then rerun the app so the next mirror pass can converge from a single source of truth. Missing user rows never imply account deletion: only an explicit `account_tombstones` row can delete an account on the other database.
Note reads, sync pulls, sync pushes, and trash cleanup do not wait for the
remote mirror. They update the local primary and queue the mirror worker so
typing and local maintenance are not blocked by Turso/network latency.
Client Sync settings include local repair diagnostics on web and Android. A pull
cursor reset is local recovery tooling only: it sets the next pull to revision
`0`, clears the legacy timestamp cursor, and leaves pending notes/notebooks in
place so conflicts remain explicit.
Android background sync may also skip a run when the local SQLCipher database
is locked by foreground app work. That warning is local contention, not data
loss; pending records stay local and the next manual or scheduled sync can
retry.

## Monitoring

- `/api/health`: liveness JSON.
- `/api/metrics`: Prometheus text for uptime, normalized-route HTTP request counts/errors/duration buckets, scheduled backup, trash cleanup/compaction, and remote-sync state. Production private metrics require `NOTES_METRICS_TOKEN`; ordinary account sessions are not metrics credentials. Set `NOTES_METRICS_PUBLIC=true` only on a private trusted network.
- Logs: stdout/stderr. Warnings include remote mirror failures and scheduler failures, without Turso tokens or session tokens.

Current metric families include `author_up`, `author_uptime_seconds`,
`author_http_requests_total`, `author_http_request_errors_total`,
`author_http_request_duration_seconds`, `author_remote_sync_*`,
`author_database_backup_*`, `author_trash_cleanup_*`, and
`author_entity_changes_last_compacted`.

## Turso Usage Guard

When a Turso database is configured, sync pushes are checked against an
estimated shared storage budget before writing remote rows. The estimate uses
`NOTES_RECORD_LIMIT_STORAGE_BYTES`, `NOTES_RECORD_LIMIT_SAFETY_RATIO`,
`NOTES_RECORD_LIMIT_NOTE_BYTES`, and `NOTES_RECORD_LIMIT_NOTEBOOK_BYTES`, then
divides the usable budget by the current number of accounts. Pushes must fit
the active record-count estimate, projected active row bytes, device cap, and
projected auxiliary storage for snapshots/change rows. The final check runs
inside the write transaction. This is a guardrail for free-plan storage, not a precise billing
meter; Turso row-read and row-write quotas still depend on query patterns and
monthly activity.

If users hit the estimate, they can keep editing locally but sync reports an
explicit limit error until data is deleted/exported or the operator raises the
budget estimate. The 50-device security cap remains active even when estimated
Turso limits are disabled. Set `NOTES_RECORD_LIMITS_ENABLED=false` to disable
the storage-budget estimate.

Scheduled cleanup also prunes expired auth state and compacts `entity_changes`
to the newest operation per owner/entity. This remains cursor-stable: a client
behind that revision receives the newest current row or retained delete, while
a client already past it needs no superseded operation. Entity tombstones are
retained so arbitrarily stale clients still observe hard deletes.

## Staging Remote Checks

Keep the staging Turso database isolated from production data. The remote smoke
workflow seeds only the dedicated `author-remote-test` account, verifies that
the database has no pre-`enc:v3` rows or non-current account verifier blockers,
and removes each run-specific smoke note after the check. Do not point
`AUTHOR_REMOTE_TEST_DATABASE_URL` or `AUTHOR_REMOTE_TEST_API_URL` at production;
the scripts fail closed unless the target name looks like test, staging,
preview, smoke, or CI.

For manual staging deploys, use the `STAGING_*` variables from
`.env.staging.example` and `aube -F @author/web run cf:secrets:staging`. The
secret upload dry-run should name `author-staging`; never upload production
Turso values through the staging path or staging values through `cf:secrets`.
The production `cf:secrets` path requires `AUTHOR_DEPLOY_TARGET=production` and
also refuses inherited shell-only production Turso values by default, which
prevents stale direnv/session exports from being used accidentally.

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

The self-hosted image runs as the non-root `node` user and enables cleanup plus local SQLite backups by default. The checked-in Compose file adds a read-only root filesystem, writable `/tmp`, dropped Linux capabilities, `no-new-privileges`, localhost-only port binding by default, and a persistent `/data` volume for the database and scheduled snapshots.

The Docker workflow builds as non-root, exports one image archive, scans it with a digest-pinned Trivy container without mounting the Docker socket, and publishes that exact scanned archive. It fails on high/critical findings, emits and attests SBOM/provenance for the published digest, and signs it with keyless Cosign. Review the uploaded SARIF artifact before public deployments.
