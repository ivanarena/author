import { argon2idAsync } from '@noble/hashes/argon2.js';
import {
  CURRENT_ENCRYPTION_VERSION,
  CURRENT_PASSWORD_MATERIAL_VERSION,
  DIRECT_KEY_ID,
  ENCRYPTION_DECRYPT_FAILED_MESSAGE,
  ENCRYPTION_KEY_MATERIAL_STORAGE_KEY,
  ENCRYPTION_KEY_MATERIAL_STORAGE_MODE_KEY,
  ENCRYPTION_UPGRADE_REQUIRED_MESSAGE,
  KEYRING_MATERIAL_PREFIX,
  PASSWORD_ARGON2_ITERATIONS,
  PASSWORD_ARGON2_MEMORY_KIB,
  PASSWORD_ARGON2_PARALLELISM,
  PASSWORD_ARGON2_SALT_PREFIX,
  RECOVERY_CODE_PREFIX,
  type E2eeRecoveryBundle,
  type E2eeRecoveryKit,
  type EncryptionEnvelope,
  type EncryptionKeyDescriptor,
  type EncryptionKeyMaterialStorageMode,
  type KeyringKey,
  type KeyringMaterial,
  type KeyringScope,
  type PreparedAccountKeyring,
  type WrappedE2eeKeyring,
  type WrappedKeyringBox
} from './encryption-constants';
import {
  bufferSource,
  base64UrlDecode,
  base64UrlEncode,
  decoder,
  encoder
} from './encryption-encoding';
import { cryptoImpl, encryptionIv, randomBytes } from './encryption-crypto';

const hashKeyCache = new Map<string, Promise<CryptoKey>>();
const wrappingKeyCache = new Map<string, Promise<CryptoKey>>();
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

export function activeEncryptionDescriptor(
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

export function decryptionDescriptors(
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

export function fieldHashKey(keyMaterial: string): Promise<CryptoKey> {
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

function generateLocalKeyMaterial(): string {
  return encodeKeyringMaterial(createKeyringMaterial('local'));
}

function isSyncKeyMaterial(material: string): boolean {
  const keyring = parseKeyringMaterial(material);
  return keyring?.scope === 'account' || isCurrentPasswordKeyMaterial(material);
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
