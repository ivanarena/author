# Project Structure

```text
apps/
  web/          SvelteKit app, IndexedDB client, Hono API, SQLite/libSQL server,
                Worker build scripts, Playwright tests
  runtime/      Explicit adapter-node production dependency closure
  android/      Kotlin/Compose Android app, SQLCipher storage, WorkManager sync,
                debug/unit/instrumented tests
packages/
  schema/       Shared Note, Notebook, Device contracts
  api-types/    Request and response payloads
  sync-spec/    Sync rules, conflict helpers, cursor helpers, retention helpers
  test-fixtures/ deterministic seed/test data
docs/           Architecture and setup notes
.github/        CI, Docker, Cloudflare, Android release, staging, security flows
scripts/        Release evidence, Docker verification, Android version checks
```

The v1 backend is a Hono app in `apps/web/src/lib/server/hono.ts`. SvelteKit owns the web app and forwards `/api/*` requests to Hono through `apps/web/src/routes/api/[...path]/+server.ts`.

The primary code paths are:

- Web UI: `apps/web/src/routes/+page.svelte` plus `apps/web/src/lib/components/notes`.
- Browser storage and encryption: `apps/web/src/lib/client/db.ts`, `entity-store.ts`, `sync.ts`, and `encryption.ts`.
- Server storage, auth, sync, and cleanup: `apps/web/src/lib/server/db.ts`, `auth.ts`, `repository.ts`, `hono.ts`, `remote-sync.ts`, `cleanup-scheduler.ts`, and `backup-scheduler.ts`.
- Android storage, crypto, sync, and UI: `apps/android/app/src/main/java/com/author/core` and `apps/android/app/src/main/java/com/author/ui`.
- Shared contracts: `packages/schema`, `packages/api-types`, and `packages/sync-spec`.

API route constants live in `packages/api-types/src/index.ts`. The current route surface includes health, metrics, config, auth challenge/login/signup/validate/logout, account/profile/password/TOTP/trusted-device/delete-account endpoints, notes/notebooks reads, sync status/pull/push, and cleanup.
