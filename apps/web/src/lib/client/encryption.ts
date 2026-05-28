import type { Note, Notebook } from '@author/schema';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { normalizeNotebookName } from './note-utils';

export const ENCRYPTION_PREFIX = 'enc:v4:';
export const LEGACY_ENCRYPTION_PREFIX = 'enc:v3:';
export const ENCRYPTION_KEY_MATERIAL_STORAGE_KEY =
  'author-encryption-key-material-v1';
export const ENCRYPTION_KEY_MATERIAL_STORAGE_MODE_KEY =
  'author-encryption-key-material-mode-v1';
export const ENCRYPTION_UPGRADE_REQUIRED_MESSAGE =
  'This workspace uses an older encryption format. Open it with the migration-capable release first, then return to this version.';
export const ENCRYPTION_DECRYPT_FAILED_MESSAGE =
  'Encrypted note data cannot be decrypted with the active key material. Sign in again before syncing or changing this workspace.';

export type EncryptionKeyMaterialStorageMode = 'persistent' | 'session';

export interface PreparedAccountKeyring {
  keyMaterial: string;
  e2eeKeyring: string;
  recoveryCode: string;
  recoveryKit: E2eeRecoveryKit;
}

export interface E2eeRecoveryBundle {
  recoveryCode: string;
  recoveryKit: E2eeRecoveryKit;
  e2eeKeyring?: string;
}

export interface E2eeRecoveryKit {
  type: 'author-recovery-kit';
  version: 1;
  createdAt: string;
  recoveryWrap: WrappedKeyringBox;
  keyHint: string;
}

type KeyringScope = 'local' | 'account';

type KeyringKey = {
  id: string;
  material: string;
  createdAt: string;
  status: 'active' | 'retired';
};

type KeyringMaterial = {
  version: 1;
  scope: KeyringScope;
  accountUsername?: string;
  activeKeyId: string;
  keys: KeyringKey[];
  legacyMaterials?: string[];
  createdAt: string;
  updatedAt: string;
};

type WrappedE2eeKeyring = {
  version: 1;
  activeKeyId: string;
  wrappedAt: string;
  passwordWrap: WrappedKeyringBox;
  recoveryWrap?: WrappedKeyringBox;
};

type WrappedKeyringBox = {
  alg: 'AES-256-GCM';
  kdf: 'sha256';
  context: 'password' | 'recovery';
  iv: string;
  ciphertext: string;
};

type EncryptionEnvelope =
  | {
      version: 'v3';
      keyId: null;
      iv: Uint8Array;
      ciphertext: Uint8Array;
    }
  | {
      version: 'v4';
      keyId: string;
      iv: Uint8Array;
      ciphertext: Uint8Array;
    };

type EncryptionKeyDescriptor = {
  version: 'v3' | 'v4';
  keyId: string;
  cacheKey: string;
  rawKey?: Uint8Array;
  directMaterial?: string;
};

const HASH_V3_PREFIX = 'hash:v3:';
const KEYRING_MATERIAL_PREFIX = 'keyring:v1:';
const RECOVERY_CODE_PREFIX = 'author-recovery-v1-';
const PASSWORD_ARGON2_MEMORY_KIB = 19_456;
const PASSWORD_ARGON2_ITERATIONS = 2;
const PASSWORD_ARGON2_PARALLELISM = 1;
const PASSWORD_ARGON2_SALT_PREFIX = 'author:password-key:v3';
const CURRENT_ENCRYPTION_VERSION = 'v4';
const LEGACY_ENCRYPTION_VERSION = 'v3';
const CURRENT_PASSWORD_MATERIAL_VERSION = 'v4';
const DIRECT_KEY_ID = 'direct';
const NOTEBOOK_NAME_HASH_CONTEXT = 'notebook:name';

const keyCache = new Map<string, Promise<CryptoKey>>();
const hashKeyCache = new Map<string, Promise<CryptoKey>>();
const wrappingKeyCache = new Map<string, Promise<CryptoKey>>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let volatileKeyMaterial: string | null = null;

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
  return encryptedEnvelope(value)?.version === CURRENT_ENCRYPTION_VERSION;
}

export function isUnsupportedEncryptedText(value: string): boolean {
  return /^enc:v[12]:/.test(value);
}

export function isCurrentFieldHash(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(HASH_V3_PREFIX));
}

export function notebookNameContext(notebook: Pick<Notebook, 'id'>): string {
  return `notebook:${notebook.id}:name`;
}

export async function canDecryptEncryptedText(
  value: string,
  keyMaterial = getEncryptionKeyMaterial(),
  context = 'text'
): Promise<boolean> {
  const envelope = encryptedEnvelope(value);
  if (!envelope) return false;
  return canDecryptEnvelopeWithMaterial(envelope, keyMaterial, context);
}

export async function canDecryptEncryptedTextWithPrimaryMaterial(
  value: string,
  keyMaterial = getEncryptionKeyMaterial(),
  context = 'text'
): Promise<boolean> {
  const envelope = encryptedEnvelope(value);
  if (!envelope || envelope.version !== CURRENT_ENCRYPTION_VERSION)
    return false;
  const active = activeEncryptionDescriptor(keyMaterial);
  if (envelope.keyId !== active.keyId) return false;
  return canDecryptEnvelopeWithDescriptor(envelope, active, context);
}

async function canDecryptEnvelopeWithMaterial(
  envelope: EncryptionEnvelope,
  keyMaterial: string,
  context: string
): Promise<boolean> {
  for (const descriptor of decryptionDescriptors(keyMaterial, envelope)) {
    if (await canDecryptEnvelopeWithDescriptor(envelope, descriptor, context)) {
      return true;
    }
  }
  return false;
}

async function canDecryptEnvelopeWithDescriptor(
  envelope: EncryptionEnvelope,
  descriptor: EncryptionKeyDescriptor,
  context: string
): Promise<boolean> {
  try {
    const key = await encryptionKey(descriptor);
    await cryptoImpl().subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bufferSource(envelope.iv),
        additionalData: aad(envelope.version, descriptor.keyId, context)
      },
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
  const mode = getEncryptionKeyMaterialStorageMode();
  const sessionMaterial = currentSessionStorage?.getItem(
    ENCRYPTION_KEY_MATERIAL_STORAGE_KEY
  );
  if (sessionMaterial) return sessionMaterial;

  const stored = currentStorage?.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
  if (stored && mode === 'session' && isSyncKeyMaterial(stored)) {
    currentStorage?.removeItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
  } else if (stored) {
    return stored;
  }
  if (currentStorage) {
    const generated = generateLocalKeyMaterial();
    currentStorage.setItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY, generated);
    return generated;
  }

  volatileKeyMaterial ??= generateLocalKeyMaterial();
  return volatileKeyMaterial;
}

export function getEncryptionKeyMaterialStorageMode(): EncryptionKeyMaterialStorageMode {
  return storage()?.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_MODE_KEY) ===
    'session'
    ? 'session'
    : 'persistent';
}

export function setEncryptionKeyMaterialStorageMode(
  mode: EncryptionKeyMaterialStorageMode
): void {
  const currentStorage = storage();
  const currentSessionStorage = sessionStorageSafe();
  currentStorage?.setItem(ENCRYPTION_KEY_MATERIAL_STORAGE_MODE_KEY, mode);

  const sessionMaterial = currentSessionStorage?.getItem(
    ENCRYPTION_KEY_MATERIAL_STORAGE_KEY
  );
  const persistentMaterial = currentStorage?.getItem(
    ENCRYPTION_KEY_MATERIAL_STORAGE_KEY
  );
  const activeMaterial = sessionMaterial ?? persistentMaterial;
  if (!activeMaterial || !isSyncKeyMaterial(activeMaterial)) return;

  if (mode === 'session') {
    currentSessionStorage?.setItem(
      ENCRYPTION_KEY_MATERIAL_STORAGE_KEY,
      activeMaterial
    );
    currentStorage?.removeItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
    return;
  }

  currentStorage?.setItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY, activeMaterial);
  currentSessionStorage?.setItem(
    ENCRYPTION_KEY_MATERIAL_STORAGE_KEY,
    activeMaterial
  );
}

export function hasStoredEncryptionKeyMaterial(): boolean {
  const stored =
    sessionStorageSafe()?.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY) ??
    storage()?.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
  return Boolean(stored && isSyncKeyMaterial(stored));
}

export function assertSupportedEncryptionKeyMaterial(
  keyMaterial = getEncryptionKeyMaterial()
): void {
  const keyring = parseKeyringMaterial(keyMaterial);
  if (keyring && validateKeyringMaterial(keyring)) return;
  if (
    (keyMaterial.startsWith('password:') &&
      !isCurrentPasswordKeyMaterial(keyMaterial)) ||
    keyMaterial.startsWith('account:') ||
    keyMaterial === 'author:local:v1'
  ) {
    throw new Error(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE);
  }
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
    CURRENT_PASSWORD_MATERIAL_VERSION,
    'argon2id',
    `m=${PASSWORD_ARGON2_MEMORY_KIB},t=${PASSWORD_ARGON2_ITERATIONS},p=${PASSWORD_ARGON2_PARALLELISM}`,
    base64UrlEncode(argon2)
  ].join(':');
}

export async function prepareNewAccountKeyring(
  username: string,
  password: string
): Promise<PreparedAccountKeyring> {
  const keyMaterial = encodeKeyringMaterial(
    createKeyringMaterial('account', normalizedUsername(username))
  );
  const passwordMaterial = await keyMaterialFromPassword(username, password);
  const recoveryCode = generateRecoveryCode();
  const e2eeKeyring = await wrapKeyringMaterial(
    keyMaterial,
    passwordMaterial,
    recoveryCode
  );
  const recoveryKit = await createRecoveryKit(keyMaterial, recoveryCode);
  return { keyMaterial, e2eeKeyring, recoveryCode, recoveryKit };
}

export async function keyringMaterialFromWrapped(
  e2eeKeyring: string,
  username: string,
  password: string
): Promise<string> {
  return unwrapKeyringMaterial(
    e2eeKeyring,
    await keyMaterialFromPassword(username, password)
  );
}

export async function migratePasswordMaterialToAccountKeyring(
  username: string,
  passwordMaterial: string
): Promise<PreparedAccountKeyring> {
  const keyMaterial = encodeKeyringMaterial(
    createKeyringMaterial('account', normalizedUsername(username), [
      passwordMaterial
    ])
  );
  const recoveryCode = generateRecoveryCode();
  const e2eeKeyring = await wrapKeyringMaterial(
    keyMaterial,
    passwordMaterial,
    recoveryCode
  );
  return {
    keyMaterial,
    e2eeKeyring,
    recoveryCode,
    recoveryKit: await createRecoveryKit(keyMaterial, recoveryCode)
  };
}

export async function rewrapKeyringForPassword(
  keyMaterial: string,
  username: string,
  password: string,
  existingE2eeKeyring?: string | null
): Promise<string> {
  const existingRecoveryWrap = existingE2eeKeyring
    ? parseWrappedE2eeKeyring(existingE2eeKeyring)?.recoveryWrap
    : undefined;
  return wrapKeyringMaterial(
    keyMaterial,
    await keyMaterialFromPassword(username, password),
    undefined,
    existingRecoveryWrap
  );
}

export async function rememberEncryptionPassword(
  username: string,
  password: string,
  e2eeKeyring?: string | null
): Promise<{ previousMaterial: string; nextMaterial: string }> {
  const rotation = await prepareEncryptionPassword(
    username,
    password,
    e2eeKeyring
  );
  commitEncryptionKeyMaterial(rotation.nextMaterial);
  return rotation;
}

export async function prepareEncryptionPassword(
  username: string,
  password: string,
  e2eeKeyring?: string | null
): Promise<{ previousMaterial: string; nextMaterial: string }> {
  const previousMaterial = getEncryptionKeyMaterial();
  const passwordMaterial = await keyMaterialFromPassword(username, password);
  if (e2eeKeyring) {
    return {
      previousMaterial,
      nextMaterial: await unwrapKeyringMaterial(e2eeKeyring, passwordMaterial)
    };
  }

  const existing = parseKeyringMaterial(previousMaterial);
  if (existing?.scope === 'account') {
    return { previousMaterial, nextMaterial: previousMaterial };
  }

  return {
    previousMaterial,
    nextMaterial: encodeKeyringMaterial(
      createKeyringMaterial('account', normalizedUsername(username), [
        passwordMaterial
      ])
    )
  };
}

export function commitEncryptionKeyMaterial(keyMaterial: string): void {
  if (isSyncKeyMaterial(keyMaterial)) {
    if (getEncryptionKeyMaterialStorageMode() === 'persistent') {
      storage()?.setItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY, keyMaterial);
    } else {
      storage()?.removeItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY);
    }
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
  if (
    await canDecryptEncryptedTextWithPrimaryMaterial(
      value,
      keyMaterial,
      context
    )
  )
    return value;

  const descriptor = activeEncryptionDescriptor(keyMaterial);
  const iv = encryptionIv();
  const key = await encryptionKey(descriptor);
  const encrypted = await cryptoImpl().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: bufferSource(iv),
      additionalData: aad(CURRENT_ENCRYPTION_VERSION, descriptor.keyId, context)
    },
    key,
    encoder.encode(value)
  );

  return `${ENCRYPTION_PREFIX}${descriptor.keyId}:${base64UrlEncode(iv)}:${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptText(
  value: string,
  keyMaterial = getEncryptionKeyMaterial(),
  context = 'text'
): Promise<string> {
  const envelope = encryptedEnvelope(value);
  if (!envelope) return value;

  for (const descriptor of decryptionDescriptors(keyMaterial, envelope)) {
    try {
      const key = await encryptionKey(descriptor);
      const decrypted = await cryptoImpl().subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bufferSource(envelope.iv),
          additionalData: aad(envelope.version, descriptor.keyId, context)
        },
        key,
        bufferSource(envelope.ciphertext)
      );
      return decoder.decode(decrypted);
    } catch {
      continue;
    }
  }

  throw new Error(ENCRYPTION_DECRYPT_FAILED_MESSAGE);
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
  const titleHash =
    titleAlreadyEncrypted && isCurrentFieldHash(note.titleHash)
      ? (note.titleHash ?? null)
      : await fieldHash(plainTitle ?? note.title, keyMaterial, titleContext);
  const bodyHash =
    bodyAlreadyEncrypted && isCurrentFieldHash(note.bodyHash)
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
  const nameHash =
    nameAlreadyEncrypted && isCurrentFieldHash(notebook.nameHash)
      ? (notebook.nameHash ?? null)
      : await fieldHash(
          normalizeNotebookName(plainName ?? notebook.name),
          keyMaterial,
          NOTEBOOK_NAME_HASH_CONTEXT
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
  return decryptText(notebook.name, keyMaterial, notebookNameContext(notebook));
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

export async function createRecoveryKit(
  keyMaterial = getEncryptionKeyMaterial(),
  recoveryCode = generateRecoveryCode()
): Promise<E2eeRecoveryKit> {
  const keyring = requireKeyringMaterial(keyMaterial);
  const recoveryWrap = await wrapKeyringBox(
    keyMaterial,
    recoveryWrappingSecret(recoveryCode),
    'recovery'
  );
  return {
    type: 'author-recovery-kit',
    version: 1,
    createdAt: new Date().toISOString(),
    recoveryWrap,
    keyHint: keyring.activeKeyId
  };
}

export async function createRecoveryBundle(
  existingE2eeKeyring?: string | null,
  keyMaterial = getEncryptionKeyMaterial()
): Promise<E2eeRecoveryBundle> {
  const recoveryCode = generateRecoveryCode();
  const recoveryKit = await createRecoveryKit(keyMaterial, recoveryCode);
  const existing = existingE2eeKeyring
    ? parseWrappedE2eeKeyring(existingE2eeKeyring)
    : null;
  if (!existing?.passwordWrap) {
    return { recoveryCode, recoveryKit };
  }
  const keyring = requireKeyringMaterial(keyMaterial);
  const wrapped: WrappedE2eeKeyring = {
    ...existing,
    activeKeyId: keyring.activeKeyId,
    wrappedAt: new Date().toISOString(),
    recoveryWrap: recoveryKit.recoveryWrap
  };
  return {
    recoveryCode,
    recoveryKit,
    e2eeKeyring: JSON.stringify(wrapped)
  };
}

export function recoveryKitFileName(now = new Date()): string {
  return `author-recovery-kit-${now.toISOString().slice(0, 10)}.json`;
}

export function recoveryKitText(kit: E2eeRecoveryKit): string {
  return `${JSON.stringify(kit, null, 2)}\n`;
}

export async function restoreKeyringFromRecoveryKit(
  kit: E2eeRecoveryKit,
  recoveryCode: string
): Promise<string> {
  if (
    kit?.type !== 'author-recovery-kit' ||
    kit.version !== 1 ||
    !kit.recoveryWrap
  ) {
    throw new Error('Invalid recovery kit');
  }
  return unwrapKeyringBox(
    kit.recoveryWrap,
    recoveryWrappingSecret(recoveryCode)
  );
}

function cryptoImpl(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for note encryption');
  }
  return globalThis.crypto;
}

async function encryptionKey(
  descriptor: EncryptionKeyDescriptor
): Promise<CryptoKey> {
  const cached = keyCache.get(descriptor.cacheKey);
  if (cached) return cached;

  const key = descriptor.rawKey
    ? cryptoImpl().subtle.importKey(
        'raw',
        bufferSource(descriptor.rawKey),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      )
    : cryptoImpl()
        .subtle.digest(
          'SHA-256',
          encoder.encode(
            descriptor.version === 'v3'
              ? `author:encryption:v3:${descriptor.directMaterial}`
              : `author:encryption:${descriptor.version}:${descriptor.keyId}:${descriptor.directMaterial}`
          )
        )
        .then((digest) =>
          cryptoImpl().subtle.importKey(
            'raw',
            digest,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
          )
        );
  keyCache.set(descriptor.cacheKey, key);
  return key;
}

function activeEncryptionDescriptor(
  keyMaterial: string
): EncryptionKeyDescriptor {
  const keyring = parseKeyringMaterial(keyMaterial);
  if (keyring) {
    const active = keyring.keys.find((key) => key.id === keyring.activeKeyId);
    if (!active) throw new Error(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE);
    const rawKey = base64UrlDecode(active.material);
    if (rawKey.byteLength !== 32) {
      throw new Error(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE);
    }
    return {
      version: CURRENT_ENCRYPTION_VERSION,
      keyId: active.id,
      cacheKey: `keyring:${active.id}:${active.material}`,
      rawKey
    };
  }

  return directDescriptor(
    keyMaterial,
    CURRENT_ENCRYPTION_VERSION,
    DIRECT_KEY_ID
  );
}

function decryptionDescriptors(
  keyMaterial: string,
  envelope: EncryptionEnvelope
): EncryptionKeyDescriptor[] {
  const keyring = parseKeyringMaterial(keyMaterial);
  if (!keyring) {
    return [
      directDescriptor(
        keyMaterial,
        envelope.version,
        envelope.version === 'v4' ? envelope.keyId : DIRECT_KEY_ID
      )
    ];
  }

  if (envelope.version === 'v4') {
    const key = keyring.keys.find(
      (candidate) => candidate.id === envelope.keyId
    );
    if (!key) return [];
    const rawKey = base64UrlDecode(key.material);
    if (rawKey.byteLength !== 32) return [];
    return [
      {
        version: 'v4',
        keyId: key.id,
        cacheKey: `keyring:${key.id}:${key.material}`,
        rawKey
      }
    ];
  }

  return (keyring.legacyMaterials ?? []).map((material) =>
    directDescriptor(material, 'v3', DIRECT_KEY_ID)
  );
}

function directDescriptor(
  material: string,
  version: 'v3' | 'v4',
  keyId: string
): EncryptionKeyDescriptor {
  return {
    version,
    keyId,
    cacheKey: `direct:${version}:${keyId}:${material}`,
    directMaterial: material
  };
}

function isCurrentPasswordKeyMaterial(material: string): boolean {
  const parts = material.split(':');
  return (
    parts[0] === 'password' &&
    parts[1] === CURRENT_PASSWORD_MATERIAL_VERSION &&
    parts[2] === 'argon2id' &&
    Boolean(parts[3]) &&
    Boolean(parts[4]) &&
    parts.length === 5
  );
}

function fieldHashKey(keyMaterial: string): Promise<CryptoKey> {
  const descriptor = activeEncryptionDescriptor(keyMaterial);
  const secret = descriptor.rawKey
    ? base64UrlEncode(descriptor.rawKey)
    : (descriptor.directMaterial ?? '');
  const cacheKey = `hash:v3:${descriptor.keyId}:${secret}`;
  const cached = hashKeyCache.get(cacheKey);
  if (cached) return cached;

  const key = cryptoImpl().subtle.importKey(
    'raw',
    encoder.encode(`author:field-hash-key:v3:${descriptor.keyId}:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  hashKeyCache.set(cacheKey, key);
  return key;
}

function aad(
  version: 'v3' | 'v4',
  keyId: string,
  context: string
): ArrayBuffer {
  const keySegment = version === 'v4' ? `:${keyId}` : '';
  return bufferSource(
    encoder.encode(`author:encrypted-field:${version}${keySegment}:${context}`)
  );
}

function encryptionIv(): Uint8Array {
  const iv = new Uint8Array(12);
  cryptoImpl().getRandomValues(iv);
  return iv;
}

function generateLocalKeyMaterial(): string {
  return encodeKeyringMaterial(createKeyringMaterial('local'));
}

function isSyncKeyMaterial(material: string): boolean {
  const keyring = parseKeyringMaterial(material);
  return keyring?.scope === 'account' || isCurrentPasswordKeyMaterial(material);
}

function encryptedEnvelope(value: string): EncryptionEnvelope | null {
  const parts = value.split(':');
  try {
    if (
      parts.length === 5 &&
      parts[0] === 'enc' &&
      parts[1] === CURRENT_ENCRYPTION_VERSION &&
      parts[2] &&
      parts[3] &&
      parts[4]
    ) {
      const iv = base64UrlDecode(parts[3]);
      const ciphertext = base64UrlDecode(parts[4]);
      if (iv.byteLength !== 12 || ciphertext.byteLength < 16) return null;
      return {
        version: CURRENT_ENCRYPTION_VERSION,
        keyId: parts[2],
        iv,
        ciphertext
      };
    }

    if (
      parts.length === 4 &&
      parts[0] === 'enc' &&
      parts[1] === LEGACY_ENCRYPTION_VERSION &&
      parts[2] &&
      parts[3]
    ) {
      const iv = base64UrlDecode(parts[2]);
      const ciphertext = base64UrlDecode(parts[3]);
      if (iv.byteLength !== 12 || ciphertext.byteLength < 16) return null;
      return {
        version: LEGACY_ENCRYPTION_VERSION,
        keyId: null,
        iv,
        ciphertext
      };
    }
  } catch {
    return null;
  }
  return null;
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
  return `${HASH_V3_PREFIX}${base64UrlEncode(new Uint8Array(signature))}`;
}

function createKeyringMaterial(
  scope: KeyringScope,
  accountUsername?: string,
  legacyMaterials: string[] = []
): KeyringMaterial {
  const now = new Date().toISOString();
  const key = randomDataKey();
  return {
    version: 1,
    scope,
    ...(accountUsername ? { accountUsername } : {}),
    activeKeyId: key.id,
    keys: [key],
    ...(legacyMaterials.length ? { legacyMaterials } : {}),
    createdAt: now,
    updatedAt: now
  };
}

function randomDataKey(): KeyringKey {
  const bytes = new Uint8Array(32);
  cryptoImpl().getRandomValues(bytes);
  return {
    id: `dk_${base64UrlEncode(randomBytes(12))}`,
    material: base64UrlEncode(bytes),
    createdAt: new Date().toISOString(),
    status: 'active'
  };
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  cryptoImpl().getRandomValues(bytes);
  return bytes;
}

function encodeKeyringMaterial(keyring: KeyringMaterial): string {
  return `${KEYRING_MATERIAL_PREFIX}${base64UrlEncode(
    encoder.encode(JSON.stringify(keyring))
  )}`;
}

function parseKeyringMaterial(material: string): KeyringMaterial | null {
  if (!material.startsWith(KEYRING_MATERIAL_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      decoder.decode(
        base64UrlDecode(material.slice(KEYRING_MATERIAL_PREFIX.length))
      )
    ) as KeyringMaterial;
    return validateKeyringMaterial(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function requireKeyringMaterial(material: string): KeyringMaterial {
  const keyring = parseKeyringMaterial(material);
  if (!keyring) throw new Error('Recovery kit requires keyring material');
  return keyring;
}

function validateKeyringMaterial(value: KeyringMaterial): boolean {
  try {
    return (
      value?.version === 1 &&
      (value.scope === 'local' || value.scope === 'account') &&
      typeof value.activeKeyId === 'string' &&
      value.activeKeyId.length > 0 &&
      Array.isArray(value.keys) &&
      value.keys.some(
        (key) =>
          key.id === value.activeKeyId &&
          key.status === 'active' &&
          base64UrlDecode(key.material).byteLength === 32
      )
    );
  } catch {
    return false;
  }
}

async function wrapKeyringMaterial(
  keyMaterial: string,
  passwordMaterial: string,
  recoveryCode?: string,
  existingRecoveryWrap?: WrappedKeyringBox
): Promise<string> {
  const keyring = requireKeyringMaterial(keyMaterial);
  const recoveryWrap = recoveryCode
    ? await wrapKeyringBox(
        keyMaterial,
        recoveryWrappingSecret(recoveryCode),
        'recovery'
      )
    : existingRecoveryWrap;
  const wrapped: WrappedE2eeKeyring = {
    version: 1,
    activeKeyId: keyring.activeKeyId,
    wrappedAt: new Date().toISOString(),
    passwordWrap: await wrapKeyringBox(
      keyMaterial,
      passwordMaterial,
      'password'
    ),
    ...(recoveryWrap ? { recoveryWrap } : {})
  };
  return JSON.stringify(wrapped);
}

function parseWrappedE2eeKeyring(value: string): WrappedE2eeKeyring | null {
  try {
    const parsed = JSON.parse(value) as WrappedE2eeKeyring;
    if (
      parsed?.version !== 1 ||
      typeof parsed.activeKeyId !== 'string' ||
      !parsed.activeKeyId ||
      !validWrappedKeyringBox(parsed.passwordWrap, 'password') ||
      (parsed.recoveryWrap !== undefined &&
        !validWrappedKeyringBox(parsed.recoveryWrap, 'recovery'))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function unwrapKeyringMaterial(
  e2eeKeyring: string,
  passwordMaterial: string
): Promise<string> {
  const parsed = parseWrappedE2eeKeyring(e2eeKeyring);
  if (!parsed) {
    throw new Error('Invalid encrypted keyring');
  }
  return unwrapKeyringBox(parsed.passwordWrap, passwordMaterial);
}

async function wrapKeyringBox(
  keyMaterial: string,
  wrappingSecret: string,
  context: 'password' | 'recovery'
): Promise<WrappedKeyringBox> {
  requireKeyringMaterial(keyMaterial);
  const iv = encryptionIv();
  const key = await keyringWrappingKey(wrappingSecret, context);
  const encrypted = await cryptoImpl().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: bufferSource(iv),
      additionalData: keyringWrapAad(context)
    },
    key,
    encoder.encode(keyMaterial)
  );
  return {
    alg: 'AES-256-GCM',
    kdf: 'sha256',
    context,
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(encrypted))
  };
}

async function unwrapKeyringBox(
  box: WrappedKeyringBox,
  wrappingSecret: string
): Promise<string> {
  if (!validWrappedKeyringBox(box)) {
    throw new Error('Invalid encrypted keyring');
  }
  try {
    const key = await keyringWrappingKey(wrappingSecret, box.context);
    const decrypted = await cryptoImpl().subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bufferSource(base64UrlDecode(box.iv)),
        additionalData: keyringWrapAad(box.context)
      },
      key,
      bufferSource(base64UrlDecode(box.ciphertext))
    );
    const keyMaterial = decoder.decode(decrypted);
    requireKeyringMaterial(keyMaterial);
    return keyMaterial;
  } catch {
    throw new Error(ENCRYPTION_DECRYPT_FAILED_MESSAGE);
  }
}

function validWrappedKeyringBox(
  box: WrappedKeyringBox | null | undefined,
  context?: 'password' | 'recovery'
): box is WrappedKeyringBox {
  return (
    box?.alg === 'AES-256-GCM' &&
    box.kdf === 'sha256' &&
    (box.context === 'password' || box.context === 'recovery') &&
    (!context || box.context === context) &&
    typeof box.iv === 'string' &&
    typeof box.ciphertext === 'string'
  );
}

function keyringWrappingKey(
  secret: string,
  context: 'password' | 'recovery'
): Promise<CryptoKey> {
  const cacheKey = `${context}:${secret}`;
  const cached = wrappingKeyCache.get(cacheKey);
  if (cached) return cached;
  const key = cryptoImpl()
    .subtle.digest(
      'SHA-256',
      encoder.encode(`author:e2ee-keyring-wrap:v1:${context}:${secret}`)
    )
    .then((digest) =>
      cryptoImpl().subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt'
      ])
    );
  wrappingKeyCache.set(cacheKey, key);
  return key;
}

function keyringWrapAad(context: 'password' | 'recovery'): ArrayBuffer {
  return bufferSource(encoder.encode(`author:e2ee-keyring:v1:${context}`));
}

function recoveryWrappingSecret(recoveryCode: string): string {
  const trimmed = recoveryCode.trim();
  if (!trimmed.startsWith(RECOVERY_CODE_PREFIX)) {
    throw new Error('Invalid recovery code');
  }
  return trimmed;
}

function generateRecoveryCode(): string {
  return `${RECOVERY_CODE_PREFIX}${base64UrlEncode(randomBytes(32))}`;
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
