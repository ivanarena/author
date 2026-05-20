import type { Note, Notebook } from '@author/schema';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { normalizeNotebookName } from './note-utils';

export const ENCRYPTION_PREFIX = 'enc:v2:';
export const ENCRYPTION_KEY_MATERIAL_STORAGE_KEY =
  'author-encryption-key-material-v1';

const HASH_V2_PREFIX = 'hash:v2:';
const USERNAME_KEY = 'author-username';
const FALLBACK_KEY_MATERIAL = 'author:local:v1';
const LOCAL_KEY_MATERIAL_PREFIX = 'local:v2:';
const PASSWORD_PBKDF2_ITERATIONS = 210_000;
const PASSWORD_PBKDF2_SALT_PREFIX = 'author:password-key:v2';
const PASSWORD_ARGON2_MEMORY_KIB = 19_456;
const PASSWORD_ARGON2_ITERATIONS = 2;
const PASSWORD_ARGON2_PARALLELISM = 1;
const PASSWORD_ARGON2_SALT_PREFIX = 'author:password-key:v3';
const LEGACY_NOTEBOOK_NAME_CONTEXT = 'notebook:name';

const keyCache = new Map<string, Promise<CryptoKey>>();
const hashKeyCache = new Map<string, Promise<CryptoKey>>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type EncryptionEnvelope = {
  version: 'v1' | 'v2';
  iv: Uint8Array;
  ciphertext: Uint8Array;
};

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function sessionStorageSafe(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function normalizedUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isEncryptedText(value: string): boolean {
  return encryptedEnvelope(value) !== null;
}

export function isCurrentEncryptedText(value: string): boolean {
  return encryptedEnvelope(value)?.version === 'v2';
}

export function isCurrentFieldHash(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(HASH_V2_PREFIX));
}

export function notebookNameContext(notebook: Pick<Notebook, 'id'>): string {
  return `notebook:${notebook.id}:name`;
}

export async function canDecryptEncryptedText(
  value: string,
  keyMaterial = getEncryptionKeyMaterial(),
  context = 'text'
): Promise<boolean> {
  if (
    await canDecryptEncryptedTextWithPrimaryMaterial(
      value,
      keyMaterial,
      context
    )
  ) {
    return true;
  }
  const envelope = encryptedEnvelope(value);
  if (!envelope) return false;

  for (const material of fallbackKeyMaterials(keyMaterial)) {
    if (await canDecryptEnvelopeWithMaterial(envelope, material, context)) {
      return true;
    }
  }

  return false;
}

export async function canDecryptEncryptedTextWithPrimaryMaterial(
  value: string,
  keyMaterial = getEncryptionKeyMaterial(),
  context = 'text'
): Promise<boolean> {
  const envelope = encryptedEnvelope(value);
  if (!envelope) return false;
  return canDecryptEnvelopeWithMaterial(envelope, keyMaterial, context);
}

async function canDecryptEnvelopeWithMaterial(
  envelope: EncryptionEnvelope,
  keyMaterial: string,
  context: string
): Promise<boolean> {
  try {
    const key = await encryptionKey(keyMaterial, envelope.version);
    await cryptoImpl().subtle.decrypt(
      envelope.version === 'v2'
        ? {
            name: 'AES-GCM',
            iv: bufferSource(envelope.iv),
            additionalData: aad(context)
          }
        : { name: 'AES-GCM', iv: bufferSource(envelope.iv) },
      key,
      bufferSource(envelope.ciphertext)
    );
    return true;
  } catch {
    return false;
  }
}

export function getEncryptionKeyMaterial(): string {
  const currentStorage = storage();
  const currentSessionStorage = sessionStorageSafe();
  const sessionMaterial = currentSessionStorage?.getItem(
    ENCRYPTION_KEY_MATERIAL_STORAGE_KEY
  );
  if (sessionMaterial) return sessionMaterial;

  const stored = currentStorage?.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
  if (stored) {
    if (isSyncKeyMaterial(stored)) {
      currentStorage?.removeItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
      currentSessionStorage?.setItem(
        ENCRYPTION_KEY_MATERIAL_STORAGE_KEY,
        stored
      );
    }
    return stored;
  }
  if (currentStorage) {
    const generated = generateLocalKeyMaterial();
    currentStorage.setItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY, generated);
    return generated;
  }

  return FALLBACK_KEY_MATERIAL;
}

export function hasStoredEncryptionKeyMaterial(): boolean {
  const stored =
    sessionStorageSafe()?.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY) ??
    storage()?.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
  return Boolean(stored && isSyncKeyMaterial(stored));
}

export function clearStoredEncryptionKeyMaterial(): void {
  storage()?.removeItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
  sessionStorageSafe()?.removeItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
}

export async function keyMaterialFromPassword(
  username: string,
  password: string
): Promise<string> {
  const normalized = normalizedUsername(username);
  const legacy = await legacyPasswordMaterial(normalized, password);
  const pbkdf2 = await pbkdf2PasswordMaterial(normalized, password);
  const argon2 = await argon2idAsync(
    encoder.encode(password),
    encoder.encode(`${PASSWORD_ARGON2_SALT_PREFIX}:${normalized}`),
    {
      t: PASSWORD_ARGON2_ITERATIONS,
      m: PASSWORD_ARGON2_MEMORY_KIB,
      p: PASSWORD_ARGON2_PARALLELISM,
      dkLen: 32,
      maxmem: PASSWORD_ARGON2_MEMORY_KIB * 1024 + 1024 * 1024
    }
  );

  return [
    'password',
    'v3',
    'argon2id',
    `m=${PASSWORD_ARGON2_MEMORY_KIB},t=${PASSWORD_ARGON2_ITERATIONS},p=${PASSWORD_ARGON2_PARALLELISM}`,
    base64UrlEncode(argon2),
    'pbkdf2',
    'v2',
    String(PASSWORD_PBKDF2_ITERATIONS),
    pbkdf2,
    'legacy',
    legacy
  ].join(':');
}

async function legacyPasswordMaterial(
  normalizedUsernameValue: string,
  password: string
): Promise<string> {
  const digest = await cryptoImpl().subtle.digest(
    'SHA-256',
    encoder.encode(`${normalizedUsernameValue}\0${password}`)
  );
  return base64UrlEncode(new Uint8Array(digest));
}

async function pbkdf2PasswordMaterial(
  normalizedUsernameValue: string,
  password: string
): Promise<string> {
  const passwordKey = await cryptoImpl().subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await cryptoImpl().subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PASSWORD_PBKDF2_ITERATIONS,
      salt: encoder.encode(
        `${PASSWORD_PBKDF2_SALT_PREFIX}:${normalizedUsernameValue}`
      )
    },
    passwordKey,
    256
  );
  return base64UrlEncode(new Uint8Array(derived));
}

export async function rememberEncryptionPassword(
  username: string,
  password: string
): Promise<{ previousMaterial: string; nextMaterial: string }> {
  const rotation = await prepareEncryptionPassword(username, password);
  commitEncryptionKeyMaterial(rotation.nextMaterial);
  return rotation;
}

export async function prepareEncryptionPassword(
  username: string,
  password: string
): Promise<{ previousMaterial: string; nextMaterial: string }> {
  const previousMaterial = getEncryptionKeyMaterial();
  const nextMaterial = await keyMaterialFromPassword(username, password);
  return { previousMaterial, nextMaterial };
}

export function commitEncryptionKeyMaterial(keyMaterial: string): void {
  if (isSyncKeyMaterial(keyMaterial)) {
    storage()?.removeItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
    sessionStorageSafe()?.setItem(
      ENCRYPTION_KEY_MATERIAL_STORAGE_KEY,
      keyMaterial
    );
    return;
  }
  sessionStorageSafe()?.removeItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
  storage()?.setItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY, keyMaterial);
}

export async function encryptText(
  value: string,
  keyMaterial = getEncryptionKeyMaterial(),
  context = 'text'
): Promise<string> {
  if (await canDecryptEncryptedText(value, keyMaterial, context)) return value;

  const iv = encryptionIv();
  const key = await encryptionKey(keyMaterial, 'v2');
  const encrypted = await cryptoImpl().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: bufferSource(iv),
      additionalData: aad(context)
    },
    key,
    encoder.encode(value)
  );

  return `${ENCRYPTION_PREFIX}${base64UrlEncode(iv)}:${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptText(
  value: string,
  keyMaterial = getEncryptionKeyMaterial(),
  context = 'text'
): Promise<string> {
  const envelope = encryptedEnvelope(value);
  if (!envelope) return value;

  for (const material of decryptionKeyMaterials(keyMaterial)) {
    try {
      const key = await encryptionKey(
        material,
        envelope.version === 'v2' ? 'v2' : 'v1'
      );
      const decrypted = await cryptoImpl().subtle.decrypt(
        envelope.version === 'v2'
          ? {
              name: 'AES-GCM',
              iv: bufferSource(envelope.iv),
              additionalData: aad(context)
            }
          : { name: 'AES-GCM', iv: bufferSource(envelope.iv) },
        key,
        bufferSource(envelope.ciphertext)
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
  const titleContext = `note:${note.id}:title`;
  const bodyContext = `note:${note.id}:body`;
  const titleAlreadyEncrypted =
    await canDecryptEncryptedTextWithPrimaryMaterial(
      note.title,
      keyMaterial,
      titleContext
    );
  const bodyAlreadyEncrypted = await canDecryptEncryptedTextWithPrimaryMaterial(
    note.body,
    keyMaterial,
    bodyContext
  );
  const plainTitle = titleAlreadyEncrypted
    ? null
    : await decryptText(note.title, keyMaterial, titleContext);
  const plainBody = bodyAlreadyEncrypted
    ? null
    : await decryptText(note.body, keyMaterial, bodyContext);
  const titleHash = titleAlreadyEncrypted
    ? (note.titleHash ?? null)
    : await fieldHash(plainTitle ?? note.title, keyMaterial, titleContext);
  const bodyHash = bodyAlreadyEncrypted
    ? (note.bodyHash ?? null)
    : await fieldHash(plainBody ?? note.body, keyMaterial, bodyContext);

  return {
    ...note,
    titleHash,
    bodyHash,
    title: titleAlreadyEncrypted
      ? note.title
      : await encryptText(plainTitle ?? note.title, keyMaterial, titleContext),
    body: bodyAlreadyEncrypted
      ? note.body
      : await encryptText(plainBody ?? note.body, keyMaterial, bodyContext)
  };
}

export async function decryptNoteFields<T extends Note>(
  note: T,
  keyMaterial = getEncryptionKeyMaterial()
): Promise<T> {
  return {
    ...note,
    title: await decryptText(note.title, keyMaterial, `note:${note.id}:title`),
    body: await decryptText(note.body, keyMaterial, `note:${note.id}:body`)
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

export async function encryptNotebookFields<T extends Notebook>(
  notebook: T,
  keyMaterial = getEncryptionKeyMaterial()
): Promise<T> {
  const nameContext = notebookNameContext(notebook);
  const nameAlreadyEncrypted = await canDecryptEncryptedTextWithPrimaryMaterial(
    notebook.name,
    keyMaterial,
    nameContext
  );
  const plainName = nameAlreadyEncrypted
    ? null
    : await decryptNotebookName(notebook, keyMaterial);
  const nameHash = nameAlreadyEncrypted
    ? (notebook.nameHash ?? null)
    : await fieldHash(
        normalizeNotebookName(plainName ?? notebook.name),
        keyMaterial,
        LEGACY_NOTEBOOK_NAME_CONTEXT
      );

  return {
    ...notebook,
    nameHash,
    name: nameAlreadyEncrypted
      ? notebook.name
      : await encryptText(plainName ?? notebook.name, keyMaterial, nameContext)
  };
}

async function decryptNotebookName<T extends Notebook>(
  notebook: T,
  keyMaterial: string
): Promise<string> {
  const currentContext = notebookNameContext(notebook);
  if (
    await canDecryptEncryptedText(notebook.name, keyMaterial, currentContext)
  ) {
    return decryptText(notebook.name, keyMaterial, currentContext);
  }
  if (
    await canDecryptEncryptedText(
      notebook.name,
      keyMaterial,
      LEGACY_NOTEBOOK_NAME_CONTEXT
    )
  ) {
    return decryptText(
      notebook.name,
      keyMaterial,
      LEGACY_NOTEBOOK_NAME_CONTEXT
    );
  }
  return notebook.name;
}

export async function decryptNotebookFields<T extends Notebook>(
  notebook: T,
  keyMaterial = getEncryptionKeyMaterial()
): Promise<T> {
  return {
    ...notebook,
    name: await decryptNotebookName(notebook, keyMaterial)
  };
}

export async function reencryptNotebookFields<T extends Notebook>(
  notebook: T,
  previousMaterial: string,
  nextMaterial: string
): Promise<T> {
  const decrypted = await decryptNotebookFields(notebook, previousMaterial);
  return encryptNotebookFields(decrypted, nextMaterial);
}

function cryptoImpl(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for note encryption');
  }
  return globalThis.crypto;
}

function encryptionKey(
  keyMaterial: string,
  version: 'v1' | 'v2'
): Promise<CryptoKey> {
  const primaryMaterial = primaryEncryptionKeyMaterial(keyMaterial);
  const cacheKey = `${version}:${primaryMaterial}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const domain =
    version === 'v2'
      ? `author:encryption:v2:${primaryMaterial}`
      : `author:${primaryMaterial}`;
  const key = cryptoImpl()
    .subtle.digest('SHA-256', encoder.encode(domain))
    .then((digest) =>
      cryptoImpl().subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt'
      ])
    );
  keyCache.set(cacheKey, key);
  return key;
}

function primaryEncryptionKeyMaterial(material: string): string {
  if (!material.startsWith('password:v3:')) return material;

  const parts = material.split(':');
  if (
    parts[0] === 'password' &&
    parts[1] === 'v3' &&
    parts[2] === 'argon2id' &&
    parts[3] &&
    parts[4]
  ) {
    return parts.slice(0, 5).join(':');
  }

  return material;
}

function fieldHashKey(keyMaterial: string): Promise<CryptoKey> {
  const cached = hashKeyCache.get(keyMaterial);
  if (cached) return cached;

  const key = cryptoImpl().subtle.importKey(
    'raw',
    encoder.encode(`author:field-hash-key:v2:${keyMaterial}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  hashKeyCache.set(keyMaterial, key);
  return key;
}

function aad(context: string): ArrayBuffer {
  return bufferSource(encoder.encode(`author:encrypted-field:v2:${context}`));
}

function decryptionKeyMaterials(primary: string): string[] {
  const candidates = [primary, ...fallbackKeyMaterials(primary)];
  const currentStorage = storage();
  const username = currentStorage?.getItem(USERNAME_KEY);

  if (username?.trim()) {
    candidates.push(`account:${normalizedUsername(username)}:v1`);
  }
  candidates.push(FALLBACK_KEY_MATERIAL);

  return [...new Set(candidates)];
}

function fallbackKeyMaterials(material: string): string[] {
  if (material.startsWith('password:v2:')) {
    const legacy = material.split(':legacy:')[1];
    return legacy ? [`password:${legacy}`] : [];
  }

  if (material.startsWith('password:v3:')) {
    const parts = material.split(':');
    const pbkdf2Index = parts.indexOf('pbkdf2');
    const legacyIndex = parts.indexOf('legacy');
    const fallbacks: string[] = [];
    if (
      pbkdf2Index >= 0 &&
      legacyIndex > pbkdf2Index &&
      parts[pbkdf2Index + 1] === 'v2'
    ) {
      const iterations = parts[pbkdf2Index + 2];
      const pbkdf2 = parts[pbkdf2Index + 3];
      const legacy = parts[legacyIndex + 1];
      if (iterations && pbkdf2 && legacy) {
        fallbacks.push(`password:v2:${iterations}:${pbkdf2}:legacy:${legacy}`);
      }
    }
    const legacy = legacyIndex >= 0 ? parts[legacyIndex + 1] : null;
    if (legacy) fallbacks.push(`password:${legacy}`);
    return fallbacks;
  }

  return [];
}

function encryptionIv(): Uint8Array {
  const iv = new Uint8Array(12);
  cryptoImpl().getRandomValues(iv);
  return iv;
}

function generateLocalKeyMaterial(): string {
  const key = new Uint8Array(32);
  cryptoImpl().getRandomValues(key);
  return `${LOCAL_KEY_MATERIAL_PREFIX}${base64UrlEncode(key)}`;
}

function isSyncKeyMaterial(material: string): boolean {
  return material.startsWith('password:') || material.startsWith('account:');
}

function encryptedEnvelope(value: string): EncryptionEnvelope | null {
  const parts = value.split(':');
  const version = parts[1];
  if (
    parts.length !== 4 ||
    parts[0] !== 'enc' ||
    (version !== 'v1' && version !== 'v2') ||
    !parts[2] ||
    !parts[3]
  ) {
    return null;
  }

  try {
    const iv = base64UrlDecode(parts[2]);
    const ciphertext = base64UrlDecode(parts[3]);
    if (iv.byteLength !== 12 || ciphertext.byteLength < 16) return null;
    return { version, iv, ciphertext };
  } catch {
    return null;
  }
}

async function fieldHash(
  value: string,
  keyMaterial: string,
  context: string
): Promise<string> {
  const signature = await cryptoImpl().subtle.sign(
    'HMAC',
    await fieldHashKey(keyMaterial),
    encoder.encode(`${context}\0${value}`)
  );
  return `${HASH_V2_PREFIX}${base64UrlEncode(new Uint8Array(signature))}`;
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
