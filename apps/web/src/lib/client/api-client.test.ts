import { describe, expect, it, vi } from 'vitest';
import { MAX_API_RESPONSE_BYTES } from '@author/api-types';
import { createApiClient, SyncHttpError } from './api-client';

describe('API client response limits', () => {
  it('rejects a response whose declared size exceeds the client ceiling', async () => {
    const client = createApiClient({
      fetcher: vi.fn(
        async () =>
          new Response('{}', {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'content-length': String(MAX_API_RESPONSE_BYTES + 1)
            }
          })
      ) as typeof fetch
    });

    await expect(client.loadConfig()).rejects.toEqual(
      expect.objectContaining<Partial<SyncHttpError>>({
        name: 'SyncHttpError',
        status: 413,
        message: 'Server response is too large'
      })
    );
  });
});
