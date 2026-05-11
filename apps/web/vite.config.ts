import { sveltekit } from '@sveltejs/kit/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(appRoot, '../..');

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: {
      allow: [repoRoot, searchForWorkspaceRoot(appRoot)]
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
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
        statements: 62,
        branches: 53,
        functions: 65,
        lines: 64
      }
    }
  }
});
