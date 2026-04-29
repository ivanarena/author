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
    include: ['src/**/*.test.ts']
  }
});
