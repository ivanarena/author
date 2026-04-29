import { api } from '$lib/server/hono';

export function GET({ request }) {
  return api.fetch(request);
}

export function POST({ request }) {
  return api.fetch(request);
}

export function OPTIONS({ request }) {
  return api.fetch(request);
}
