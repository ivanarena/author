import { building, dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { startTrashCleanupScheduler } from '$lib/server/cleanup-scheduler';
import {
  applySecurityHeaders,
  createSecurityNonce,
  isSecureRequest
} from '$lib/server/security-headers';

if (!building) {
  startTrashCleanupScheduler();
}

export const handle: Handle = async ({ event, resolve }) => {
  const nonce = createSecurityNonce();
  const response = await resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replaceAll('<script', `<script nonce="${nonce}"`)
  });
  applySecurityHeaders(response, {
    nonce,
    dev,
    secure: isSecureRequest(event.request, event.url)
  });
  return response;
};
