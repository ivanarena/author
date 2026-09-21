# Codebase Review and Remediation Plan

> Baseline: commit `c081a30`, reviewed and revalidated on 2026-08-17.
> Status: findings remediated in the post-review working tree; see the remediation and verification records below.

## Release Decision

Do not publish the candidate as a production release until the isolated staging
smoke, managed restore drill, and signed-APK device acceptance are complete.
Source remediation and green candidate checks do not replace those release
gates or an independent security review.

No critical issue was confirmed. A critical rating is reserved for a presently
exploitable unauthenticated compromise of note confidentiality, remote code
execution, or deterministic widespread data destruction. None was found during
this review. The absence of a confirmed critical issue is not a substitute for
an independent penetration test or cryptographic audit.

Features can only be exempted from a blocker by disabling them completely. For
example, remote-mirror findings remain release blockers whenever remote mirror
is enabled, and signup findings remain blockers whenever public signup is
enabled.

## Scope and Method

The review covered the 295 tracked files at the baseline commit, including:

- SvelteKit, Hono, browser IndexedDB, encryption, sync, import/export, and UI;
- SQLite/libSQL/Turso persistence, cleanup, backup, authentication, and mirror
  behavior;
- shared schemas, API types, and executable sync expectations;
- Android Kotlin, SQLCipher, Keystore preferences, WorkManager, Compose UI,
  import/export, updates, and release configuration;
- Docker, Compose, GitHub Actions, Gradle, Aube, deployment scripts, and docs.

The review combined source inspection with local builds, tests, audits, image
inspection, and targeted concurrency/data-flow analysis. It was not an external
network penetration test, formal cryptographic proof, production restore drill,
or Android device test.

## Independent Candidate Re-review

A second independent pass over candidate `a7198e6` found four additional gaps.
They are remediated in the subsequent candidate working tree and require fresh
exact-commit verification before release:

| ID      | Severity | Priority | Finding                                                                                             | Status |
| ------- | -------- | -------- | --------------------------------------------------------------------------------------------------- | ------ |
| R2-H-01 | High     | P0       | Stale/conflict-only pushes can claim active shrinkage and bypass the total-storage limit repeatedly | Fixed  |
| R2-M-01 | Medium   | P1       | Successful skipped/no-op workflow runs can satisfy production and artifact release gates            | Fixed  |
| R2-M-02 | Medium   | P1       | One-sided mirror descendants lose source versions when content returns to an earlier value          | Fixed  |
| R2-M-03 | Medium   | P1       | Direct decrypt paths return malformed reserved encryption envelopes as plaintext                    | Fixed  |

The quota exemption now requires version-matched deletion of every affected
active record before over-limit cleanup is allowed. Release gates verify the
required successful jobs, staging cannot opt into a successful no-op, and
commit-addressed image tags cannot be replaced. Mirror tests cover same-content
version convergence, while web and Android decrypt functions reject malformed
reserved namespaces directly.

## Severity and Priority

Severity describes impact; priority describes when the work must happen.

| Severity | Meaning                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Critical | Direct compromise or widespread irreversible loss with little or no prerequisite.                                                   |
| High     | Credible data loss, account compromise, or service-wide denial of service; release blocking.                                        |
| Medium   | Material weakness requiring authentication, local access, an operator mistake, a future migration, or a narrower failure condition. |
| Low      | Defense-in-depth, accessibility, observability, documentation, or maintainability issue.                                            |

| Priority | Target                                                                 |
| -------- | ---------------------------------------------------------------------- |
| P0       | Before the next production release.                                    |
| P1       | Before enabling the affected hosted/mirror feature or expanding users. |
| P2       | Next hardening cycle.                                                  |
| P3       | Planned maintenance; do not allow indefinite drift.                    |

## Finding Summary

| ID   | Severity | Priority | Finding                                                                 | Status |
| ---- | -------- | -------- | ----------------------------------------------------------------------- | ------ |
| H-01 | High     | P0       | Dependency and container security gates fail                            | Fixed  |
| H-02 | High     | P0       | Authenticated sync permits storage and response amplification           | Fixed  |
| H-03 | High     | P0       | Unauthenticated metric labels have unbounded cardinality                | Fixed  |
| H-04 | High     | P0       | Trash cleanup can tombstone a concurrently restored record              | Fixed  |
| H-05 | High     | P0       | A conflict response can supersede edits made while push is in flight    | Fixed  |
| H-06 | High     | P0       | Android plaintext-to-SQLCipher migration is not crash safe              | Fixed  |
| H-07 | High     | P0       | Android secure-preference failures silently delete key material         | Fixed  |
| H-08 | High     | P0/P1    | Missing remote user rows propagate destructive account deletion         | Fixed  |
| H-09 | High     | P0/P1    | Remote mirror silently chooses some winners and drifts versions         | Fixed  |
| H-10 | High     | P0       | Signup allow-list does not prove email ownership                        | Fixed  |
| H-11 | High     | P0       | Retention trusts client clocks and can hard-delete new trash            | Fixed  |
| M-01 | Medium   | P1       | Browser editor recovery stores plaintext note content                   | Fixed  |
| M-02 | Medium   | P1       | A normal session can replace or clear the account keyring               | Fixed  |
| M-03 | Medium   | P1       | Server does not enforce encrypted field/hash contracts                  | Fixed  |
| M-04 | Medium   | P1       | Unknown future encryption versions do not fail closed                   | Fixed  |
| M-05 | Medium   | P1       | Production secret and password validation is weak                       | Fixed  |
| M-06 | Medium   | P2       | Browser receives an exfiltratable bearer token despite HttpOnly cookie  | Fixed  |
| M-07 | Medium   | P2       | Record primary keys are global rather than owner scoped                 | Fixed  |
| M-08 | Medium   | P2       | localStorage sync-lock fallback is not atomic                           | Fixed  |
| M-09 | Medium   | P1       | Android sync responses are unbounded                                    | Fixed  |
| M-10 | Medium   | P2       | Android retries permanent sync failures indefinitely                    | Fixed  |
| M-11 | Medium   | P2       | Markdown export is lossy and entirely memory buffered                   | Fixed  |
| M-12 | Medium   | P1       | Compose injects the whole root environment and mishandles custom ports  | Fixed  |
| M-13 | Medium   | P2       | Release provenance and supply-chain verification have gaps              | Fixed  |
| M-14 | Medium   | P1       | Destructive operator scripts have unsafe backup/mirror behavior         | Fixed  |
| M-15 | Medium   | P2       | Change history, tombstones, and stale auth metadata grow without policy | Fixed  |
| M-16 | Medium   | P2       | Modal focus isolation and restoration are incomplete                    | Fixed  |
| L-01 | Low      | P3       | Android screenshot/task-switcher privacy is not hardened                | Fixed  |
| L-02 | Low      | P3       | Cleanup observability and metric disclosure policy are incomplete       | Fixed  |
| L-03 | Low      | P3       | Diagnostic redaction does not cover all sensitive field names           | Fixed  |
| L-04 | Low      | P3       | Android lint/resource warnings remain                                   | Fixed  |
| L-05 | Low      | P2       | Safety-critical coverage and code decomposition have gaps               | Fixed  |
| L-06 | Low      | P3       | Documentation and configuration have drifted from behavior              | Fixed  |

## Remediation Record

The finding descriptions below preserve the reviewed baseline for traceability.
The post-review working tree addresses them as follows:

- H-01: vulnerable resolutions were upgraded; audits and Trivy are clean. A
  dedicated `apps/runtime` closure is pruned in a throwaway stage before copy to
  the final image, reducing the image from about 296 MB to about 61 MB and
  removing Vitest, Wrangler, workerd, Playwright, Sharp, lint tooling, and other
  unrelated packages.
- H-02/H-03: shared byte limits, session-bound devices, a 50-device cap,
  transactional total-storage projection, sync throttling, byte-bounded pulls,
  bounded web/Android readers, and normalized metric routes close the
  amplification paths.
- H-04/H-05/H-11: cleanup selection/deletion is one write transaction, conflict
  persistence compares the current local fingerprint atomically, and retention
  uses a server-observed timestamp.
- H-06/H-07: Android migration copies historical schemas row-by-row into a
  validated SQLCipher candidate, installs by rename, recovers interrupted
  artifacts, and never deletes secure-preference ciphertext on a read failure.
  Connected migration/recovery tests exercise these paths.
- H-08/H-09: account deletion uses explicit replicated tombstones; unexplained
  user absence/orphan data fails closed; mirror overwrite checks the opposite
  cursor and preserves source versions exactly.
- H-10: signup requires an HMAC-signed, email-bound, expiring invitation and a
  client-wide throttle independent of submitted username.
- M-01 through M-10: editor recovery moved to encrypted IndexedDB; keyring
  updates require proof and compare-and-swap; sync fields/hashes and encryption
  namespaces fail closed; production secrets have minimum lengths; browsers use
  cookie-only sessions; owner-scoped keys, transactional fallback leases,
  bounded Android responses, and permanent-error retry classification are in
  place.
- M-11 through M-16: portable Markdown metadata and streaming Android ZIP
  output, Compose environment allow-listing, exact scanned-image publication,
  Gradle/certificate verification, consistent operator backups, cursor-stable
  change compaction, stale-device/auth pruning, and reusable modal focus
  isolation were added.
- L-01 through L-06: Android intentionally permits user-initiated screenshots while
  app lock still activates on stop, cleanup metrics were added, diagnostic fields
  are redacted and tested, Android lint is clean, focused
  race/migration/storage tests and Firefox E2E were added, and all identified
  documentation/configuration drift was corrected, and the release gate now
  rejects active Node or Aube versions that do not match the repository's pinned
  toolchain. The large safety-critical
  files remain intentionally split only at existing responsibility boundaries;
  targeted coverage and regression tests were preferred over a risky cosmetic
  rewrite.

Release-workflow attestations, staging smoke, and production restore evidence
still require the external GitHub/production environment; implementation is
complete but those release artifacts cannot be produced by a local source-tree
change.

## High-Severity Findings

### H-01: Dependency and container security gates fail

**Evidence**

- `aube audit --prod` reports four findings: three high and one moderate,
  affecting `nanoid` and `postcss`.
- `aube audit` reports seven findings: six high and one moderate, adding three
  `brace-expansion` advisories.
- `aube run docker:verify` reports eight high findings in
  `brace-expansion`, `nanoid`, `postcss`, `sharp`, and `undici`.
- The runtime image is about 296 MB decimal (`295910171` bytes). Its
  `/app/node_modules/.aube` store is about 402 MB and contains development/build
  tools including Vitest, Wrangler, workerd, TypeScript, and Sharp.
- The runtime install is produced by `Dockerfile:41-42`; vulnerable resolutions
  are recorded in `aube-lock.yaml`.

**Impact**

The repository's own release policy requires zero high/critical dependency and
image findings. Not every advisory has a demonstrated route from untrusted app
input, but shipping known-fixable vulnerabilities and a development-heavy
runtime unnecessarily expands attack surface and makes the release unverifiable.

**Plan**

1. Update direct/transitive constraints to at least the fixed versions reported
   by the audit tools.
2. Remove stale overrides that pin vulnerable versions.
3. Rework the runtime stage to install only the adapter-node production closure.
   If Aube filtering still installs workspace development tools, copy a pruned
   runtime closure or bundle the remaining externals explicitly.
4. Build once, scan that exact image digest, then publish the same digest.

**Acceptance**

- `aube audit --prod` and `aube audit --audit-level high` exit successfully.
- `aube run docker:verify` reports zero high/critical findings.
- Vitest, Wrangler, workerd, TypeScript, and other build-only tools are absent
  from the runtime image.
- A production container starts and passes its health check with a fresh volume.

### H-02: Authenticated sync permits storage and response amplification

**Evidence**

- Push bodies may be 5 MiB (`apps/web/src/lib/server/hono.ts:251`).
- Device validation only requires non-empty strings
  (`hono.ts:1025-1036`); it places no byte limit on ID or name.
- An empty push still upserts a device and records a change
  (`repository.ts:376-418`, `repository.ts:1473`).
- Record-limit accounting covers active notes and notebooks only
  (`record-limits.ts:334-390`). It excludes devices, tombstones,
  `entity_changes`, and version/conflict snapshots.
- Conflicts save both incoming and remote records, while accepted pushes save
  another snapshot (`repository.ts:1504-1549`, `repository.ts:1664-1697`).
- Pull pagination limits revision rows, not encoded response bytes
  (`repository.ts:888-998`). A page may contain up to 1,000 very large records.

**Impact**

One authenticated account can repeatedly create unique multi-megabyte devices,
or churn large note conflicts/snapshots, exhausting a shared database. A later
pull can assemble a response far larger than request limits and exhaust server,
browser, or Android memory. Quota checks occur before the write transaction and
do not account for all rows created by the transaction.

**Plan**

1. Add shared UTF-8 byte limits for every identifier, device name, encrypted
   field, hash, timestamp, keyring, and metadata array.
2. Bind sync device identity to the authenticated session or explicitly limit
   device registration and renaming.
3. Add per-account device limits and authenticated sync rate limits.
4. Extend storage projection to devices, version rows, tombstones, and change
   rows; perform the final quota check in the write transaction.
5. Page pulls by both entity count and serialized byte budget.
6. Add bounded body readers to both clients and return a typed "response too
   large" diagnostic without discarding pending records.

**Acceptance**

- Boundary tests cover byte limits, not JavaScript/Kotlin character counts.
- Repeated empty pushes cannot create unbounded devices.
- Conflict churn cannot exceed the account quota.
- Pull responses remain under a documented byte ceiling.
- Load tests prove a malicious account cannot materially affect another account.

### H-03: Unauthenticated metric labels have unbounded cardinality

**Evidence**

`apps/web/src/lib/server/hono.ts:121-212` stores a process-global map entry keyed
by the raw HTTP method and URL pathname. The middleware executes for unknown API
paths before route authentication. Entries have no cap, expiration, or route
normalization.

**Impact**

An unauthenticated client can request a large number of unique `/api/...` paths
and grow server memory until the Node process is killed. Worker isolates are
also exposed to unnecessary memory churn.

**Plan**

- Label metrics with a fixed route-template enum and collapse unmatched paths to
  `404`.
- Add a defensive maximum number of series and a test that sends randomized
  paths.
- Prefer a streaming/counter backend over retaining arbitrary labels forever.

**Acceptance**

One million distinct unknown paths produce one bounded `404` series, and metric
memory remains effectively constant.

### H-04: Trash cleanup can tombstone a concurrently restored record

**Evidence**

`cleanupTrash` selects notes and notebooks before entering the write transaction
(`apps/web/src/lib/server/repository.ts:1753-1772`). Inside the transaction it
runs conditional deletes, but then emits tombstones and delete revisions for
every row from the stale pre-transaction list (`repository.ts:1784-1817`).

**Impact**

If another transaction restores a selected record before cleanup's transaction,
the conditional delete skips that now-restored row, but cleanup still publishes
a hard delete. Sync clients can permanently remove the record while the server
row remains hidden behind a later delete revision.

**Plan**

- Select candidates and delete them in the same transaction.
- Tombstone only rows actually deleted, using `DELETE ... RETURNING` where
  supported or a version/timestamp checked re-read.
- Count only committed deletions in `CleanupResponse`.

**Acceptance**

A deterministic interleaving test restores a note/notebook between cleanup
start and deletion and proves no tombstone or delete revision is emitted.

### H-05: A conflict response can supersede edits made while push is in flight

**Evidence**

- Web takes a pending snapshot, waits for the push, then calls `saveConflict`
  (`apps/web/src/lib/client/sync.ts:331-375`).
- `saveConflict` stores the server's older local side and blindly marks the
  current entity as `conflict` (`sync-store.ts:297-319`).
- Android follows the same pattern
  (`NotesRepository.kt:1147-1187`, `NotesRepository.kt:1895-1910`).
- Accepted-change handling already compares the pushed version/timestamp, but
  conflict handling does not.

**Impact**

A user can continue typing while a push is in flight. If that older push
conflicts, the dialog represents the pushed snapshot, not the newest local
record. Resolving it can replace or duplicate stale text and lose the newer
edit.

**Plan**

- Pass a pushed-record fingerprint to conflict persistence.
- In the same local transaction, compare the current record to the pushed
  fingerprint.
- If it advanced, either build the conflict from the current record or leave the
  current record pending and retain the server conflict as ancestry metadata.
- Apply the same algorithm and executable test vectors on web and Android.

**Acceptance**

A delayed-push test types a second edit before a conflict response and proves
all resolution choices preserve or explicitly present the second edit.

### H-06: Android plaintext-to-SQLCipher migration is not crash safe

**Evidence**

`apps/android/app/src/main/java/com/author/core/NotesDatabase.kt:303-343`:

- changes the plaintext source's `PRAGMA user_version` to the current version
  before the replacement database is validated;
- renames the only source database to a plaintext backup;
- installs the encrypted file with `copyTo`, which is not an atomic replacement;
- deletes the backup immediately after the copy;
- deletes a plaintext backup whenever the main database is absent
  (`NotesDatabase.kt:280-283`).

There is no instrumentation test for each historical plaintext schema or for a
process death after export, rename, partial copy, or validation.

**Impact**

A crash can leave no main file, a partial encrypted file, or an old-schema file
marked as current. A subsequent start may delete the only backup or fail to open
the database. Local-only pending notes can become inaccessible.

**Plan**

1. Never mutate the source database's schema version.
2. Export to a separate encrypted candidate, open it, run normal migrations,
   and validate expected tables/columns and record counts.
3. `fsync` the candidate and parent directory where supported.
4. Use atomic same-filesystem renames: original to retained backup, candidate to
   main.
5. On startup, detect every migration artifact and recover the last validated
   database before creating/deleting anything.
6. Retain the plaintext backup until a later successful app start and explicit
   cleanup policy.

**Acceptance**

Connected tests migrate every supported plaintext schema and inject failure at
each filesystem step. Every restart must recover either the original or fully
validated encrypted database, never an empty workspace.

### H-07: Android secure-preference failures silently delete key material

**Evidence**

`SecurePreferenceStore.getString` catches every decryption failure, removes the
stored value, and returns null
(`apps/android/app/src/main/java/com/author/core/SecurePreferenceStore.kt:26-37`).
The same store contains the SQLCipher password, session token, trusted-device
secret, and note key material. If the SQLCipher password disappears,
`NotesDatabase.kt:266-302` generates a new password and may quarantine the
intact old database as unreadable.

**Impact**

A corrupted preference payload, transient provider failure, or Keystore
invalidation is converted into destructive state mutation. The app can appear
signed out, lose sync key material, or open a new empty database while unsynced
notes remain inaccessible in a quarantined file.

**Plan**

- Distinguish `missing`, `available`, and `unreadable` secure values.
- Never delete ciphertext as a side effect of reading it.
- Fail closed with a recovery screen and diagnostic that identifies which key
  class is unavailable without logging the value.
- Preserve the database and all preference ciphertext until explicit user
  recovery/reset confirmation.

**Acceptance**

Unit and connected tests inject corrupt payloads and Keystore failures for each
sensitive key. Reads do not mutate preferences, the original database is not
renamed/deleted, and recovery guidance is shown.

### H-08: Missing remote user rows propagate destructive account deletion

**Evidence**

Remote mirror starts by deleting remote owner data without a matching user and
then treats the remote user list as authoritative when syncing to local
(`apps/web/src/lib/server/remote-sync.ts:472-511`,
`remote-sync.ts:876-884`). Missing users are deleted with all related local data.
There is no durable account-deletion event distinguishing intentional deletion
from an incomplete restore, misconfiguration, or temporary remote corruption.

**Impact**

An accidentally missing remote user row can cause both remote and healthy local
account data to be deleted. This is especially dangerous after partial restores
or first-time pairing with the wrong remote.

**Plan**

- Introduce explicit versioned account tombstones/deletion intents.
- Refuse to infer account deletion from absence.
- Add first-pair and restore preflight summaries; require operator confirmation
  before a destructive reconciliation.
- Back up both sides before any account-pruning migration.

**Acceptance**

An empty/partial remote cannot delete a local account. Only a validated explicit
account tombstone can propagate deletion, and replay is idempotent.

### H-09: Remote mirror silently chooses some winners and drifts versions

**Evidence**

- `canSourceOverwriteTarget` allows a higher-version, newer/tie-broken source to
  overwrite differing target content (`remote-sync.ts:279-300`).
- Remote-to-local runs first (`remote-sync.ts:877-881`), so a qualifying newer
  remote silently wins.
- Existing tests explicitly assert that newer remote edits win
  (`repository.test.ts:1130`).
- For an existing target, `pushChanges` advances `target.version + 1` instead of
  adopting the source version (`repository.ts:1603-1610`,
  `repository.ts:1719-1726`). `preserveNewRecordVersions` only applies to new
  rows.

**Impact**

Independent local and remote edits are not always reported as divergence,
contrary to `docs/operations.md`. A source at version 5 can become version 2 on
the target, so failover changes the sync ancestry and can create widespread
client conflicts or silent winner selection.

**Plan**

Choose and document one model:

1. **Strict mirror:** one writer, replicated source versions/revisions, and hard
   failure on any differing content without proven ancestry; or
2. **Two-primary replication:** explicit ancestry/change IDs and conflict rows,
   never timestamp/version winner selection.

For the current architecture, strict mirror is smaller and safer. Preserve
source versions exactly and verify source/target role before every run.

**Acceptance**

Mirror tests cover equal, descendant, divergent, delete, restore, outage, and
promotion cases. Divergence never chooses a winner, and failover preserves all
client `baseVersion` expectations.

### H-10: Signup allow-list does not prove email ownership

**Evidence**

- Signup only checks for a matching row in `signup_allowed_emails`
  (`apps/web/src/lib/server/auth.ts:288-297`, `hono.ts:1476-1490`).
- No invitation secret or email challenge is required.
- Different responses reveal disabled, disallowed, and already-taken states.
- The signup throttle key includes the submitted username
  (`hono.ts:675-681`), so rotating usernames bypasses a per-client ceiling.

**Impact**

Anyone who knows or guesses an allowed address can claim it before its owner.
The response oracle helps enumerate allow-list/account state. This is a hosted
account-provisioning vulnerability, even though it may be acceptable for a
single-user private deployment with signup disabled.

**Plan**

- Replace bare email rows with random, expiring, single-use invitation tokens or
  verified email challenges.
- Consume invitations atomically with account creation.
- Add per-client, per-email, and global signup limits independent of username.
- Return a uniform external response for disallowed/taken identities.

**Acceptance**

Knowing an allowed email is insufficient to create an account; replay and
parallel invitation use fail safely; rotating usernames does not evade limits.

### H-11: Retention trusts client clocks and can hard-delete new trash

**Evidence**

Web and Android generate trash/delete timestamps locally. For web see
`entity-store-notes.ts:134-143` and `entity-store-notebooks.ts:72-81`.
Payload validation accepts any parseable date, and cleanup compares that value
directly with the server retention cutoff (`repository.ts:1751-1768`). Mirror
ordering also uses client timestamps as tie breakers.

**Impact**

A device clock more than the retention period behind can create a newly trashed
record that is immediately eligible for permanent cleanup. Future timestamps
can prevent expected cleanup and distort mirror ordering.

**Plan**

- Add server-observed `trashed_at_server`/`deleted_at_server` values when the
  transition is first accepted.
- Base retention exclusively on the server-observed value.
- Preserve client timestamps only for UI metadata and diagnose implausible skew.
- Do not use untrusted wall-clock values as replication ancestry.

**Acceptance**

Tests with clocks years behind/ahead retain newly trashed records for the full
server retention interval and do not change mirror conflict decisions.

## Medium-Severity Findings

### M-01: Browser editor recovery stores plaintext note content

`apps/web/src/lib/components/notes/controller/actions/editor.ts:15-27` and
`editor.ts:408-433` write the live title/body to `localStorage`. Crash residue
therefore bypasses encrypted IndexedDB. `clearSensitiveWorkspace` also deletes
that recovery record before a session-only user can sign in again
(`editor.ts:250-269`).

**Plan:** store a versioned encrypted recovery record in IndexedDB, decrypt it
only after key unlock, and retain unreadable ciphertext until successful unlock
or explicit discard. Add reload, sign-out, session-only, corrupt-ciphertext, and
permanent-delete tests.

### M-02: A normal session can replace or clear the account keyring

`PATCH /api/account` permits a keyring-only update for an ordinary session
(`apps/web/src/lib/server/hono.ts:1671-1710`). `cleanE2eeKeyring` checks size but
not wrapper structure, and null clears the field (`auth.ts:321-330`,
`auth.ts:1382-1401`). A stolen session can deny recovery/new-device access even
though password change and account deletion require proof.

**Plan:** require recent password proof or authorization by the current account
key, validate wrapper structure, and update with a current-keyring hash/version
compare-and-swap. Keep a short auditable rollback window containing encrypted
wrappers only.

### M-03: Server does not enforce encrypted field/hash contracts

`apps/web/src/lib/server/payload-validation.ts:39-78` accepts arbitrary strings
for note content/notebook names and permits absent arbitrary hashes. The server
therefore accepts plaintext or malformed pseudo-envelopes from outdated/custom
clients, contrary to public encrypted-storage wording. Missing notebook hashes
also weaken duplicate-name enforcement.

**Plan:** for sync-capable accounts, require structurally current field
envelopes and current hash formats. Keep legacy/bootstrap/import paths separate
and explicit. Add protocol tests proving plaintext, malformed envelopes, wrong
hash versions, and oversized fields are rejected without dropping pending data.

### M-04: Unknown future encryption versions do not fail closed

Web only flags `enc:v1`/`enc:v2` as unsupported
(`apps/web/src/lib/client/encryption-fields.ts:34-40`); Android does the same
(`NoteCrypto.kt:93-98`). An `enc:v5:` value is parsed as ordinary text and can be
wrapped as v4 and republished.

**Plan:** reserve the entire `enc:v<integer>:` namespace. Reject every envelope
version not explicitly supported before plaintext handling. Add shared fixtures
for malformed current, known legacy, and unknown future versions on both
clients.

### M-05: Production secret and password validation is weak

`apps/web/src/lib/server/config.ts:60-78` rejects a small placeholder list but
accepts very short production secrets/passwords. Bootstrap/verifier paths do
not consistently enforce the UI's 15-character policy. Weak
`NOTES_SERVER_SECRET` values reduce protection for encrypted TOTP seeds.

**Plan:** enforce minimum entropy-oriented lengths for server-known secrets and
bootstrap passwords at startup, reject reuse, and clearly document that a
verifier-only API cannot prove plaintext password length. Add production-config
negative tests.

### M-06: Browser receives an exfiltratable bearer token despite HttpOnly cookie

Login/signup responses include the raw session token while also setting the
HttpOnly cookie (`apps/web/src/lib/server/hono.ts:1413`, `1517`, `1619`). The web
client retains the token in memory (`apps/web/src/lib/client/local-state.ts:136-163`).
A successful login followed by keyring-unlock failure also leaves an orphaned
server session.

**Plan:** use cookie-only browser sessions and return bearer tokens only through
a native-client-specific flow. If post-login key setup fails, revoke the newly
created session. Add tests that browser auth succeeds without exposing a token
in JSON.

### M-07: Record primary keys are global rather than owner scoped

`apps/web/src/lib/server/db.ts:142-181` defines note/notebook IDs as global
primary keys. Ownership is enforced by preflight checks and conditional upserts
(`repository.ts:474-501`, `repository.ts:1118-1186`) rather than by the schema.
One tenant's ID prevents the same ID in another tenant, and concurrency depends
on database transaction behavior.

**Plan:** migrate to `(owner_username, id)` primary/unique keys and owner-scoped
foreign keys/indexes. Use a checked shadow-table migration and cross-account
collision tests.

### M-08: localStorage sync-lock fallback is not atomic

The fallback lock performs separate read, write, and verification operations
(`apps/web/src/lib/client/sync.ts:541-553`). It has no transaction or fencing
token, and losing the lease during an active run does not abort writes.

**Plan:** use Web Locks where available and an IndexedDB transactional lease
with monotonically increasing fencing tokens otherwise. Verify ownership before
each push/pull commit. Add two-context browser tests on the fallback path.

### M-09: Android sync responses are unbounded

`apps/android/app/src/main/java/com/author/core/SyncClient.kt:289-293` calls
`readText()` for every response without a maximum. This compounds H-02 and also
allows a compromised/misconfigured API endpoint to exhaust device memory.

**Plan:** enforce content-length and streaming byte ceilings before JSON parse,
with separate documented limits for auth, push, and pull. Treat overflow as a
permanent diagnostic until the server/page size changes.

### M-10: Android retries permanent sync failures indefinitely

`apps/android/app/src/main/java/com/author/core/SyncWorker.kt:48-62` retries every
non-auth, non-database-lock error. Permanent validation, quota, or other 4xx
responses can therefore consume recurring battery/network and keep unique work
occupied.

**Plan:** classify transport/408/429/5xx as retryable and most other 4xx as
permanent. Record the permanent failure, finish the worker, preserve pending
records, and let manual sync expose the action required.

### M-11: Markdown export is lossy and entirely memory buffered

Web and Android choose only the first active notebook assignment and omit IDs,
favorites, trash state, and secondary notebook links
(`apps/web/src/lib/client/markdown-archive.ts:132-178`,
`apps/android/app/src/main/java/com/author/core/MarkdownArchive.kt:106-148`).
Trashed notes export as normal active notes. Dates omit timezone, and ZIP output
is assembled in memory without ZIP64 (`markdown-archive.ts:181-247`).

**Plan:** either label this explicitly as a lossy human-readable export or add
portable versioned frontmatter for all intended metadata. Stream ZIP output,
use timezone-qualified ISO dates, define trash behavior, and test multi-notebook
round trips and large archives.

### M-12: Compose injects the whole root environment and mishandles custom ports

`compose.yml:14-17` passes the entire root `.env` into the app. That file is also
used by deployment and Android tooling, so unrelated Turso, Cloudflare,
staging, or signing values can enter the app process. `${PORT}:3000` also lets
`PORT` change the app's internal listen port while always targeting container
port 3000, breaking custom settings.

**Plan:** use an explicit server-only environment allow-list or a separate
runtime env file. Keep container `PORT=3000` fixed and introduce `HOST_PORT` for
host mapping. Add a Compose smoke test with non-default host port and assert
unrelated variables are absent.

### M-13: Release provenance and supply-chain verification have gaps

- Trivy runs from a mutable tag with Docker-socket access
  (`.github/workflows/docker.yml:69-81`).
- Publish rebuilds the image instead of pushing the already scanned digest
  (`docker.yml:56-63`, `docker.yml:131-142`).
- Gradle wrapper lacks `distributionSha256Sum`
  (`apps/android/gradle/wrapper/gradle-wrapper.properties`).
- APK verification accepts any valid signing certificate
  (`.github/workflows/android-release.yml:134-142`).
- Manual release input can resolve as a non-tag ref; the workflow does not
  explicitly prove `refs/tags/<input>` exists and points at `HEAD` before
  creating/uploading the release.

**Plan:** digest-pin the scanner, minimize Docker-socket exposure, publish the
scanned image digest, add Gradle distribution/dependency verification, pin the
expected APK certificate fingerprint, and verify exact tag-to-commit identity.

### M-14: Destructive operator scripts have unsafe backup/mirror behavior

- `cleanup-current-only-blockers.ts:269-279` copies only the main SQLite file,
  which is unsafe if WAL writes continue.
- Its JSON backup includes auth/session tables and uses default file permissions
  (`cleanup-current-only-blockers.ts:156-176`).
- `create-user.ts` changes local state only even though remote users are
  authoritative.
- `cleanup-trash.ts` does not mirror immediately.
- `seed.ts` clears active rows but leaves tombstones/entity revisions, so it is
  not a complete reset.

**Plan:** require stopped writes or `VACUUM INTO`/online backup APIs, write
sensitive exports with mode `0600`, make remote authority explicit in every
account tool, and make reset/cleanup transactionally clear or deliberately
retain all related state. Add mandatory dry-run summaries and typed
confirmation for destructive operations.

### M-15: Change history, tombstones, and stale auth metadata grow without policy

`entity_changes` appends on every accepted operation
(`apps/web/src/lib/server/repository.ts:331-349`) and is not compacted.
Tombstones persist unless a record is recreated/account deleted. Expired
sessions are pruned only during later session creation (`auth.ts:1276-1278`).
Long-lived active workspaces therefore grow metadata continuously even though
version snapshots have retention.

**Plan:** design cursor-stable compaction before deleting revisions. Options
include periodic full-snapshot generations plus a minimum supported cursor, or
per-entity latest state with explicit cursor-reset semantics. Add scheduled
session/challenge/rate-limit pruning and document tombstone retention.

### M-16: Modal focus isolation and restoration are incomplete

Settings and history receive initial wrapper focus, but no modal traps focus,
marks the background inert, or reliably restores the trigger. Conflict and
signup-recovery dialogs do not receive programmed initial focus
(`ConflictDialog.svelte`, `SignupRecoveryModal.svelte`,
`page-controller.svelte.ts:1398-1412`). Conflict buttons also have no busy guard.

**Plan:** create one small reusable dialog action/component that manages initial
focus, tab cycling, Escape policy, inert background, trigger restoration, and
busy state. Add keyboard E2E tests for every dialog, not only an app-shell axe
scan.

## Low-Severity Findings

### L-01: Android screenshot/task-switcher privacy is not hardened

Author intentionally does not set `FLAG_SECURE` so users can capture screenshots.
App lock activates on stop, but the system may still capture the note surface for
recents. This is an explicit product tradeoff; a future privacy setting could
separately obscure recents without blocking user-initiated screenshots.

### L-02: Cleanup observability and metric disclosure policy are incomplete

Backup and remote-sync state have metric families, but cleanup only logs and has
no last-success/failure metric (`cleanup-scheduler.ts`). When no dedicated
metrics token is configured, any signed-in account can access aggregate service
metrics. Add cleanup freshness/outcome metrics and document whether ordinary
users should see global account/request information.

### L-03: Diagnostic redaction does not cover all sensitive field names

Web and Android redact generic `token`, `password`, and `secret` keys but not
specific names such as `e2eeKeyring`, `recoveryCode`, `keyMaterial`, or
`deviceTrustSecret` (`client/debug-log.ts`, `core/DebugLogStore.kt`). Expand the
field-name denylist and add adversarial redaction fixtures. Diagnostics should
never include note content either.

### L-04: Android lint/resource warnings remain

Release lint currently reports 0 errors and 20 warnings, including launcher
shape/resource warnings and a notification small icon that uses the launcher
asset (`UpdateCheckWorker.kt:123`). Replace it with a proper monochrome status
icon, provide a true round icon, remove unused resources, and clear Compose/API
deprecation warnings.

### L-05: Safety-critical coverage and code decomposition have gaps

Current web coverage is 76.32% statements and 66.05% branches. Important client
storage/query/profile modules report 0%, Svelte components are outside coverage,
and only Chromium E2E is configured. The following safety-critical files are
large:

- `NotesRepository.kt`: 2,602 lines;
- `NotesController.kt`: 1,965 lines;
- `hono.ts`: 2,394 lines;
- `repository.ts`: 1,884 lines.

Split by existing responsibilities rather than introducing a new framework.
Prioritize tests for the races/migrations in this report, Firefox/WebKit storage
behavior, old Android schemas, and operator scripts.

### L-06: Documentation and configuration have drifted from behavior

Correct these while fixing the associated code, not as claim-only patches:

- `docs/operations.md` says divergent mirror edits stop, but H-09 permits some
  silent winners.
- `docs/sync-protocol.md` says old clients fail closed, but M-04 breaks that for
  future versions.
- Privacy/security pages do not disclose plaintext editor recovery, and the
  privacy account-data list omits email.
- `apps/android/README.md` says local schema v2 while code uses v3.
- `README.md` advertises `local-dev-password`, while the copied web env template
  uses a different value.
- `.githooks/pre-commit` falls back to Aube 1.8.0 while the workspace requires
  1.16.0.
- Production-readiness asks operators to monitor cleanup state, but no cleanup
  metric exists.

## Remediation Sequence

### Phase 0: Stop release and close immediate loss/DoS paths

Target: before any production release.

1. **Dependency/runtime closure:** H-01.
2. **Request/resource boundaries:** H-02, H-03, M-09.
3. **Transactional data safety:** H-04, H-05, H-11.
4. **Android local-data safety:** H-06, H-07.
5. **Account provisioning:** H-10, or disable signup.
6. Re-run all local gates plus targeted adversarial/concurrency tests.

Exit criteria:

- no high/critical audit or image findings;
- byte-bound sync and bounded metric cardinality;
- deterministic regression tests for cleanup/conflict races;
- crash-injected Android migration and secure-preference tests pass;
- signup requires proof of invitation ownership.

### Phase 1: Make sync, mirror, and encryption fail closed

Target: before enabling remote mirror or expanding hosted users.

1. H-08 and H-09: explicit account deletion and strict mirror semantics.
2. M-02 through M-05: authenticated/CAS keyring updates, server contract
   enforcement, unknown-version rejection, and secret policy.
3. M-01: encrypted editor recovery.
4. M-12 and M-14: least-privilege runtime environment and safe operator tools.
5. Update `docs/sync-protocol.md`, `docs/conflict-handling.md`,
   `docs/operations.md`, privacy, and security pages with the implemented model.

Exit criteria:

- remote absence cannot delete an account;
- mirror never chooses between unproven divergent records;
- source versions survive failover unchanged;
- all encryption namespaces and keyring mutations fail closed;
- recovery and destructive-operation drills pass from backups.

### Phase 2: Portability, operations, and platform hardening

Target: next hardening release.

1. M-06 through M-08: cookie-only browser auth, owner-scoped keys, fenced
   fallback sync lock.
2. M-10 and M-11: retry classification and full-fidelity/streaming export.
3. M-13 and M-15: artifact identity, Gradle/APK verification, and metadata
   lifecycle.
4. M-16: reusable accessible dialog behavior.
5. L-01 through L-04: privacy, observability, redaction, and Android resources.

### Phase 3: Maintainability and assurance

1. Raise branch coverage around auth, storage, sync, migrations, and tools before
   chasing aggregate percentages.
2. Add Firefox/WebKit E2E and connected Android migration tests.
3. Decompose the four large safety-critical files along current module
   boundaries.
4. Run a staging smoke, backup restore drill, Android connected suite, secret
   scan, and independent security review.
5. Close L-06 and keep this report as a tracked release artifact.

## Verification Record

The remediated working tree was revalidated on 2026-08-17:

| Command/check                                | Result                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `aube run toolchain:check`                   | Passed; Node 24.19.0 and repository-pinned Aube 1.16.0             |
| `aube run quality`                           | Passed; format/lint and Svelte check reported 0 errors/0 warnings  |
| Actionlint and Zizmor pedantic audit         | Passed; no workflow findings                                       |
| `aube run test:coverage`                     | Passed; 7 sync-spec and 322 web tests                              |
| Web coverage                                 | 76.78% statements, 66.61% branches, 82.45% functions, 79.01% lines |
| `aube -F @author/web run build`              | Passed                                                             |
| `aube -F @author/web run cf:build`           | Passed                                                             |
| `aube run test:e2e`                          | Passed; 20 Chromium/Firefox/mobile tests                           |
| `aube run android:verify`                    | Passed; debug unit/lint/APK and dependency verification            |
| `aube run android:verify:release`            | Passed; release lint reported no issues                            |
| `aube run android:verify:connected`          | Passed; 26 emulator tests including migration/recovery             |
| `aube audit --prod`                          | Passed; no known vulnerabilities                                   |
| `aube audit --audit-level high`              | Passed; no known vulnerabilities                                   |
| `aube deprecations --transitive --exit-code` | Passed; no deprecated packages                                     |
| `aube run docker:verify`                     | Passed; zero high/critical OS or library findings                  |
| Runtime image inspection                     | About 61 MB; 3.7 MB Aube store containing only 3 runtime packages  |
| Container health smoke                       | Passed as non-root with production auth configuration              |
| Local SQLite restore drill                   | Source and restored copies both passed `db:check`                  |
| GitHub release preflight                     | Secrets/environments exist; `main` requires all four CI jobs       |

Implemented but requiring external release infrastructure for final evidence:

- CI WebKit E2E (the local host lacks WebKit system libraries; CI installs them);
- `aube run staging:verify` against dedicated staging credentials;
- production/Turso managed restore drill;
- GitHub SARIF, signing-key custody, published SBOM/provenance/Cosign
  attestation, and exact-artifact workflow run;
- external penetration testing, fuzzing, and independent cryptographic review.

## Existing Controls Worth Preserving

The remediation should not regress the following strengths:

- parameterized SQL for user-controlled database values;
- owner filters on normal note/notebook/device reads;
- origin checks for browser mutations and strict SameSite/HttpOnly cookies;
- CSP, HSTS on secure requests, frame denial, MIME, referrer, and permissions
  headers;
- hashed server session/trusted-device tokens and short-lived single-use auth
  challenges;
- AES-GCM with random IVs, field-specific AAD, keyed stable hashes, and shared
  crypto fixtures;
- explicit `baseVersion` conflicts and cursor-stable pull revisions;
- local-first pending-record preservation during normal sync failures;
- SQLCipher, Keystore-backed preferences, HTTPS-only Android release networking,
  and Android backup exclusions;
- non-root/read-only/capability-dropped Compose defaults;
- immutable SHA pins for GitHub Actions and signed container publication.

Any fix to sync, encryption, mirror, or storage must preserve offline writes and
must add tests in the shared sync specification plus the affected web/Android
suite where the contract is shared.
