import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const e2eDbPath = resolve(repoRoot, 'apps/web/.data/e2e-notes.sqlite');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5179',
    trace: 'retain-on-failure'
  },
  webServer: {
    cwd: repoRoot,
    command: `bash -lc "rm -f ${e2eDbPath}* && NOTES_DB_PROVIDER=local NOTES_DB_PATH=${e2eDbPath} NOTES_AUTH_TOKEN=e2e-token NOTES_LOGIN_PASSWORD=e2e-password NOTES_CLEANUP_ENABLED=false aube -F @author/web run dev -- --port 5179"`,
    url: 'http://127.0.0.1:5179/api/health',
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
