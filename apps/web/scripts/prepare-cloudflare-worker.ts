import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerPath = resolve(
  import.meta.dirname,
  '../.svelte-kit/cloudflare/_worker.js'
);
const generatedPath = resolve(
  import.meta.dirname,
  '../.svelte-kit/cloudflare/_worker.generated.js'
);

if (!existsSync(workerPath)) {
  throw new Error('Cloudflare worker build output is missing');
}

const workerSource = readFileSync(workerPath, 'utf8');
if (workerSource.includes("from './_worker.generated.js'")) {
  process.exit(0);
}

renameSync(workerPath, generatedPath);
writeFileSync(
  workerPath,
  `import generatedWorker from './_worker.generated.js';
import { runScheduledTrashCleanup } from '../../src/lib/server/cleanup-scheduler.ts';

export default {
  async fetch(request, env, context) {
    return generatedWorker.fetch(request, env, context);
  },

  async scheduled(controller, env, context) {
    if (env.NOTES_CLEANUP_ENABLED !== 'true') return;
    context.waitUntil(runScheduledTrashCleanup(env));
  }
};
`
);
