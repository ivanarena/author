import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const e2eDbPath = resolve(repoRoot, 'apps/web/.data/e2e-notes.sqlite');
const e2eBaseUrl = 'http://127.0.0.1:5179';
const e2eEnvVars: Array<[string, string]> = [
  ['AUTHOR_E2E_ENV', 'true'],
  ['AUTHOR_API_URL', e2eBaseUrl],
  ['NOTES_DB_PATH', e2eDbPath],
  ['NOTES_REMOTE_SYNC_ENABLED', 'false'],
  ['NOTES_LOGIN_USERNAME', 'owner'],
  ['NOTES_LOGIN_PASSWORD', 'e2e-password-2026'],
  ['NOTES_SERVER_SECRET', 'e2e-server-secret'],
  ['NOTES_CLEANUP_ENABLED', 'false'],
  ['NOTES_BACKUP_ENABLED', 'false']
];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const e2eWebServerCommand = [
  `rm -f ${shellQuote(e2eDbPath)}*`,
  [
    'env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}"',
    ...e2eEnvVars.map(([key, value]) => `${key}=${shellQuote(value)}`),
    './node_modules/.bin/vite --host 0.0.0.0 --port 5179'
  ].join(' ')
].join('; ');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: e2eBaseUrl,
    trace: 'retain-on-failure'
  },
  webServer: {
    cwd: resolve(repoRoot, 'apps/web'),
    command: `bash -lc ${shellQuote(e2eWebServerCommand)}`,
    url: `${e2eBaseUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      grep: /@mobile/,
      use: { ...devices['Pixel 7'] }
    }
  ]
});
