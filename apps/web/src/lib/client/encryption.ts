import type { Note } from '@author/schema';

export const ENCRYPTION_PREFIX = 'enc:v1:';
export const ENCRYPTION_KEY_MATERIAL_STORAGE_KEY =
  'author-notes-encryption-key-material-v1';

const USERNAME_KEY = 'author-notes-username';
const FALLBACK_KEY_MATERIAL = 'author-notes:local:v1';

const keyCache = new Map<string, Promise<CryptoKey>>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizedUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isEncryptedText(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX);
}

export function getEncryptionKeyMaterial(): string {
  const currentStorage = storage();
  const stored = currentStorage?.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
  if (stored) return stored;

  return FALLBACK_KEY_MATERIAL;
}

export function hasStoredEncryptionKeyMaterial(): boolean {
  return Boolean(storage()?.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY));
}

export async function keyMaterialFromPassword(
  username: string,
  password: string
): Promise<string> {
  const digest = await cryptoImpl().subtle.digest(
    'SHA-256',
    encoder.encode(`${normalizedUsername(username)}\0${password}`)
  );
  return `password:${base64UrlEncode(new Uint8Array(digest))}`;
}

export async function rememberEncryptionPassword(
  username: string,
  password: string
): Promise<{ previousMaterial: string; nextMaterial: string }> {
  const previousMaterial = getEncryptionKeyMaterial();
  const nextMaterial = await keyMaterialFromPassword(username, password);
  storage()?.setItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY, nextMaterial);
  return { previousMaterial, nextMaterial };
}

export async function encryptText(
  value: string,
  keyMaterial = getEncryptionKeyMaterial(),
  _context = 'text'
): Promise<string> {
  void _context;
  if (isEncryptedText(value)) return value;

  const iv = encryptionIv();
  const key = await encryptionKey(keyMaterial);
  const encrypted = await cryptoImpl().subtle.encrypt(
    { name: 'AES-GCM', iv: bufferSource(iv) },
    key,
    encoder.encode(value)
  );

  return `${ENCRYPTION_PREFIX}${base64UrlEncode(iv)}:${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptText(
  value: string,
  keyMaterial = getEncryptionKeyMaterial()
): Promise<string> {
  if (!isEncryptedText(value)) return value;

  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'enc' || parts[1] !== 'v1')
    return value;

  for (const material of decryptionKeyMaterials(keyMaterial)) {
    try {
      const key = await encryptionKey(material);
      const decrypted = await cryptoImpl().subtle.decrypt(
        { name: 'AES-GCM', iv: bufferSource(base64UrlDecode(parts[2])) },
        key,
        bufferSource(base64UrlDecode(parts[3]))
      );
      return decoder.decode(decrypted);
    } catch {
      continue;
    }
  }

  return value;
}

export async function encryptNoteFields<T extends Note>(
  note: T,
  keyMaterial = getEncryptionKeyMaterial()
): Promise<T> {
  const titleHash = isEncryptedText(note.title)
    ? (note.titleHash ?? null)
    : await fieldHash(note.title, keyMaterial, `note:${note.id}:title`);
  const bodyHash = isEncryptedText(note.body)
    ? (note.bodyHash ?? null)
    : await fieldHash(note.body, keyMaterial, `note:${note.id}:body`);

  return {
    ...note,
    titleHash,
    bodyHash,
    title: await encryptText(note.title, keyMaterial, `note:${note.id}:title`),
    body: await encryptText(note.body, keyMaterial, `note:${note.id}:body`)
  };
}

export async function decryptNoteFields<T extends Note>(
  note: T,
  keyMaterial = getEncryptionKeyMaterial()
): Promise<T> {
  return {
    ...note,
    title: await decryptText(note.title, keyMaterial),
    body: await decryptText(note.body, keyMaterial)
  };
}

export async function reencryptNoteFields<T extends Note>(
  note: T,
  previousMaterial: string,
  nextMaterial: string
): Promise<T> {
  const decrypted = await decryptNoteFields(note, previousMaterial);
  return encryptNoteFields(decrypted, nextMaterial);
}

function cryptoImpl(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for note encryption');
  }
  return globalThis.crypto;
}

function encryptionKey(keyMaterial: string): Promise<CryptoKey> {
  const cached = keyCache.get(keyMaterial);
  if (cached) return cached;

  const key = cryptoImpl()
    .subtle.digest('SHA-256', encoder.encode(`author-notes:${keyMaterial}`))
    .then((digest) =>
      cryptoImpl().subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt'
      ])
    );
  keyCache.set(keyMaterial, key);
  return key;
}

function decryptionKeyMaterials(primary: string): string[] {
  const candidates = [primary];
  const currentStorage = storage();
  const username = currentStorage?.getItem(USERNAME_KEY);

  if (username?.trim()) {
    candidates.push(`account:${normalizedUsername(username)}:v1`);
  }
  candidates.push(FALLBACK_KEY_MATERIAL);

  return [...new Set(candidates)];
}

function encryptionIv(): Uint8Array {
  const iv = new Uint8Array(12);
  cryptoImpl().getRandomValues(iv);
  return iv;
}

async function fieldHash(
  value: string,
  keyMaterial: string,
  context: string
): Promise<string> {
  const digest = await cryptoImpl().subtle.digest(
    'SHA-256',
    encoder.encode(
      `author-notes-field-hash:${keyMaterial}:${context}\0${value}`
    )
  );
  return `hash:v1:${base64UrlEncode(new Uint8Array(digest))}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = bytesToBinary(bytes);
  if (typeof btoa === 'function') {
    return btoa(binary)
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }
  return Buffer.from(bytes).toString('base64url');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');

  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function bytesToBinary(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  }
  return chunks.join('');
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
