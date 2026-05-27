import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const e2eDbPath = resolve(repoRoot, 'apps/web/.data/e2e-notes.sqlite');
const e2eBaseUrl = 'http://127.0.0.1:5179';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: e2eBaseUrl,
    trace: 'retain-on-failure'
  },
  webServer: {
    cwd: resolve(repoRoot, 'apps/web'),
    command: `bash -lc "rm -f ${e2eDbPath}* && AUTHOR_API_URL=${e2eBaseUrl} NOTES_DB_PATH=${e2eDbPath} NOTES_REMOTE_SYNC_ENABLED=false NOTES_LOGIN_USERNAME=owner NOTES_LOGIN_PASSWORD=e2e-password NOTES_SERVER_SECRET=e2e-server-secret NOTES_CLEANUP_ENABLED=false NOTES_BACKUP_ENABLED=false ./node_modules/.bin/vite --host 0.0.0.0 --port 5179"`,
    url: `${e2eBaseUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
