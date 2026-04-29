# Cross-App Tests

This directory is reserved for future cross-app integration tests that run the web app, API, and Android sync fixtures against the same protocol cases.

Current tests live beside the code they exercise:

- `apps/web/src/lib/server/repository.test.ts`
- `apps/web/src/lib/server/hono.test.ts`
- `apps/web/tests/e2e/sync.spec.ts`
- `packages/sync-spec/tests/conflict.test.ts`
