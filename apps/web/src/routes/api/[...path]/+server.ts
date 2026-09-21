import { api } from '$lib/server/hono';

export function GET({ request, platform }) {
  return api.fetch(request, platform?.env);
}

export function POST({ request, platform }) {
  return api.fetch(request, platform?.env);
}

export function PATCH({ request, platform }) {
  return api.fetch(request, platform?.env);
}

export function PUT({ request, platform }) {
  return api.fetch(request, platform?.env);
}

export function DELETE({ request, platform }) {
  return api.fetch(request, platform?.env);
}

export function OPTIONS({ request, platform }) {
  return api.fetch(request, platform?.env);
}
