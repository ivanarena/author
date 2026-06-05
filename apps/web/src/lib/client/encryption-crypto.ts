export function cryptoImpl(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for note encryption');
  }
  return globalThis.crypto;
}

export function encryptionIv(): Uint8Array {
  const iv = new Uint8Array(12);
  cryptoImpl().getRandomValues(iv);
  return iv;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  cryptoImpl().getRandomValues(bytes);
  return bytes;
}
