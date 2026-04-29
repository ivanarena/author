# Project Structure

```text
apps/
  web/          SvelteKit app, IndexedDB client, Hono API, SQLite/libSQL server
  android/      Kotlin/Compose placeholder
packages/
  schema/       Shared Note, Notebook, Device contracts
  api-types/    Request and response payloads
  sync-spec/    Sync rules, conflict helpers, protocol docs
  test-fixtures/ deterministic seed/test data
docs/           Architecture and setup notes
tests/          Future cross-app integration tests
```

The v1 backend is a Hono app in `apps/web/src/lib/server/hono.ts`. SvelteKit owns the web app and forwards `/api/*` requests to Hono through a catch-all API route.
