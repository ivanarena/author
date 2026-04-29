import { getAuthToken } from './config';

export function tokenFromRequest(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice('bearer '.length).trim();
  }

  return request.headers.get('x-notes-token');
}

export function isAuthorized(request: Request): boolean {
  return tokenFromRequest(request) === getAuthToken();
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json'
    }
  });
}
