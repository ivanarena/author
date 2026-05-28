import { sveltekit } from '@sveltejs/kit/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(appRoot, '../..');

const WORKSPACE_ENV_KEYS = new Set([
  'NOTES_DB_PROVIDER',
  'NOTES_DB_PATH',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'NOTES_LOGIN_USERNAME',
  'NOTES_LOGIN_PASSWORD',
  'NOTES_AUTH_SESSION_DAYS',
  'NOTES_SIGNUP_ALLOWED_EMAILS',
  'NOTES_REMOTE_SYNC_ENABLED',
  'NOTES_CLEANUP_ENABLED',
  'NOTES_CLEANUP_RUN_ON_START',
  'NOTES_CLEANUP_INTERVAL_MINUTES',
  'NOTES_TRUST_PROXY_HEADERS',
  'NOTES_LEGACY_AUTH_TOKEN_ENABLED',
  'NOTES_AUTH_TOKEN',
  'NOTES_SERVER_SECRET',
  'NOTES_TOTP_SECRET_KEY',
  'NOTES_METRICS_PUBLIC',
  'NOTES_METRICS_TOKEN',
  'NOTES_BACKUP_ENABLED',
  'NOTES_BACKUP_RUN_ON_START',
  'NOTES_BACKUP_INTERVAL_MINUTES',
  'NOTES_BACKUP_RETENTION_COUNT',
  'NOTES_BACKUP_DIR',
  'NOTES_RECORD_LIMITS_ENABLED',
  'NOTES_RECORD_LIMIT_STORAGE_BYTES',
  'NOTES_RECORD_LIMIT_SAFETY_RATIO',
  'NOTES_RECORD_LIMIT_NOTE_BYTES',
  'NOTES_RECORD_LIMIT_NOTEBOOK_BYTES',
  'AUTHOR_API_URL',
  'AUTHOR_SYNC_API_URL',
  'ANDROID_SYNC_API_URL',
  'ANDROID_SYNC_SERVER_URL',
  'NOTES_SYNC_SERVER_URL',
  'HOST',
  'PORT'
]);

function loadWorkspaceEnvDefaults(mode: string): void {
  const shellEnvKeys = new Set(Object.keys(process.env));
  const envLayers = [loadEnv(mode, repoRoot, ''), loadEnv(mode, appRoot, '')];
  for (const env of envLayers) {
    for (const [key, value] of Object.entries(env)) {
      if (!WORKSPACE_ENV_KEYS.has(key) || shellEnvKeys.has(key)) {
        continue;
      }
      process.env[key] = value;
    }
  }
}

export default defineConfig(({ mode }) => {
  loadWorkspaceEnvDefaults(mode);

  return {
    plugins: [sveltekit()],
    server: {
      fs: {
        allow: [repoRoot, searchForWorkspaceRoot(appRoot)]
      }
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      testTimeout: 180000,
      hookTimeout: 180000,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        reportsDirectory: 'coverage',
        include: ['src/lib/**/*.{ts,svelte.ts}'],
        exclude: [
          'src/lib/**/*.test.ts',
          'src/lib/components/**/*.svelte',
          'src/lib/components/**/*.css'
        ],
        thresholds: {
          statements: 64,
          branches: 55,
          functions: 72,
          lines: 65
        }
      }
    }
  };
});
