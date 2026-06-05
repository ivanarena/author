import type { Note, Notebook } from '@author/schema';
import {
  CURRENT_ENCRYPTION_VERSION,
  ENCRYPTION_DECRYPT_FAILED_MESSAGE,
  ENCRYPTION_PREFIX,
  HASH_V3_PREFIX,
  LEGACY_ENCRYPTION_VERSION,
  NOTEBOOK_NAME_HASH_CONTEXT,
  type EncryptionEnvelope,
  type EncryptionKeyDescriptor
} from './encryption-constants';
import {
  bufferSource,
  base64UrlDecode,
  base64UrlEncode,
  decoder,
  encoder
} from './encryption-encoding';
import { cryptoImpl, encryptionIv } from './encryption-crypto';
import {
  activeEncryptionDescriptor,
  decryptionDescriptors,
  fieldHashKey,
  getEncryptionKeyMaterial
} from './encryption-keyring';
import { normalizeNotebookName } from './note-utils';

const keyCache = new Map<string, Promise<CryptoKey>>();

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
