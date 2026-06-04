class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'RequestBodyTooLargeError';
  }
}

function requestBodyTooLarge(request: Request, maxBytes: number): boolean {
  const contentLength = request.headers.get('content-length');
  if (!contentLength) return false;
  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > maxBytes;
}

async function readJsonBody<T>(
  request: Request,
  maxBytes: number
): Promise<T | null> {
  if (requestBodyTooLarge(request, maxBytes)) {
    throw new RequestBodyTooLargeError();
  }

  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError();
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());

  const text = chunks.join('');
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function jsonOrSizeError<T>(
  request: Request,
  maxBytes: number,
  message: string
): Promise<{ ok: true; body: T | null } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await readJsonBody<T>(request, maxBytes) };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: message }), {
          status: 413,
          headers: { 'content-type': 'application/json' }
        })
      };
    }
    throw error;
  }
}
