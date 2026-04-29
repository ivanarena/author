import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { startTrashCleanupScheduler } from '$lib/server/cleanup-scheduler';

if (!building) {
  startTrashCleanupScheduler();
}

export const handle: Handle = ({ event, resolve }) => resolve(event);
