# Release Evidence: {{RELEASE_ID}}

- Date: {{DATE_UTC}}
- Commit: {{COMMIT_SHA}}
- Branch: {{BRANCH}}
- Android: `versionName={{ANDROID_VERSION_NAME}}`, `versionCode={{ANDROID_VERSION_CODE}}`
- Web: `version={{WEB_VERSION}}`
- Operator:
- Decision: Pending

## Scope

- Release type:
- User-facing changes:
- Storage, sync, auth, encryption, deployment, or Android changes:
- Explicit exceptions:

## Required Workflow Evidence

Record the exact workflow run URL, conclusion, and commit SHA.

- CI:
- Docker:
- Cloudflare Deploy:
- Android private test APK:
- Android production Release APK:
- CodeQL SARIF or code-scanning review:
- OpenSSF Scorecard SARIF review:
- Trivy SARIF review:

## Local Gate Evidence

Record command, result, timestamp, and notes for failures or accepted skips.

- `aube run toolchain:check`:
- `aube run release:version:check`:
- `aube run deps:check`:
- `aube run quality`:
- `aube audit --prod`:
- `aube audit --audit-level high`:
- `aube deprecations --transitive --exit-code`:
- `aube run test:coverage`:
- `aube run test:e2e`:
- `aube -F @author/web run build`:
- `aube -F @author/web run cf:build`:
- `aube run android:verify`:
- `aube run android:verify:release`:
- `aube run android:verify:connected`:
- `aube run docker:verify`:

## Staging Smoke

- Staging account:
- Staging API URL:
- Command or manual flow:
- Push result:
- Pull result:
- Stale-write conflict result:
- Encrypted-payload check:
- Login/session check:
- Cleanup result:

## Backup Restore Drill

- Backup source:
- Restore target:
- Restore timestamp:
- `aube -F @author/web run db:check` result:
- Notes:

## Artifact Traceability

- Git tag:
- GitHub release URL:
- Container image:
- Container digest:
- Cosign verification:
- SBOM/provenance:
- Android private test APK artifact:
- Android test-device upgrade/smoke result:
- Android production APK URL:
- Android APK SHA-256:
- Android signing verification:
- Android update-check URL:

## Production Configuration

- HTTPS enforced:
- `NOTES_LOGIN_PASSWORD` real secret:
- `NOTES_SERVER_SECRET` real secret:
- Turso token server-only:
- `/api/metrics` authenticated:
- Backup or managed export enabled:
- Cloudflare Cron cleanup trigger:
- Android release API URL:

## Security Review Notes

- High/critical dependency findings:
- High/critical image findings:
- CodeQL findings:
- Scorecard findings:
- Accepted exceptions:

## Rollback

- Previous known-good tag:
- Database rollback/restore plan:
- Container rollback plan:
- Cloudflare rollback plan:
- Android rollback/update notice:

## Sign-Off

- Release owner:
- Reviewed by:
- Published at:
