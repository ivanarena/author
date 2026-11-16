const socketAddresses = new WeakMap<Request, string>();

/**
 * Remembers the transport-level peer address for a request, as reported by
 * the SvelteKit adapter. It is used only when no trusted proxy header names
 * the client.
 */
export function rememberRequestSocketAddress(
  request: Request,
  readAddress: () => string
): void {
  try {
    const address = readAddress()?.trim();
    if (address) socketAddresses.set(request, address);
  } catch {
    // Adapters may throw when the address is unavailable; fall back silently.
  }
}

export function requestSocketAddress(request: Request): string | null {
  return socketAddresses.get(request) ?? null;
}

/**
 * Returns the last entry of a comma-separated forwarding header. A trusted
 * proxy appends (or sets) the value it observed, so the last entry is the
 * one the proxy vouches for; earlier entries may come from the client.
 */
export function lastForwardedValue(
  value: string | null | undefined
): string | null {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.at(-1) ?? null;
}
