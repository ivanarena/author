import { api } from '$lib/server/hono';
import { rememberRequestSocketAddress } from '$lib/server/client-address';
import type { RequestHandler } from './$types';

const handle: RequestHandler = ({ request, platform, getClientAddress }) => {
  rememberRequestSocketAddress(request, getClientAddress);
  return api.fetch(request, platform?.env);
};

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
