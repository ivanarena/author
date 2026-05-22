import type {
  AuthChallengeResponse,
  AuthKdfParams,
  AuthProof,
  PasswordVerifier
} from '@author/api-types';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const AUTH_PROOF_ALGORITHM = 'argon2id-scram-sha256';
export const AUTH_PROOF_MEMORY_KIB = 19_456;
export const AUTH_PROOF_ITERATIONS = 2;
export const AUTH_PROOF_PARALLELISM = 1;
export const AUTH_PROOF_KEY_LENGTH = 32;
export const AUTH_PROOF_KDF_PARAMS: AuthKdfParams = {
  algorithm: 'argon2id',
  memoryKiB: AUTH_PROOF_MEMORY_KIB,
  iterations: AUTH_PROOF_ITERATIONS,
  parallelism: AUTH_PROOF_PARALLELISM,
  keyLength: AUTH_PROOF_KEY_LENGTH
};

const AUTH_MESSAGE_VERSION = 'author-auth-proof-v1';
const CLIENT_KEY_LABEL = 'Client Key';
const SERVER_KEY_LABEL = 'Server Key';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const encoder = new TextEncoder();

export interface AuthProofMaterial {
  proof: AuthProof;
  expectedServerProof: string;
}

export function authKdfParamsString(
  params: AuthKdfParams = AUTH_PROOF_KDF_PARAMS
): string {
  return `m=${params.memoryKiB},t=${params.iterations},p=${params.parallelism}`;
}

export function authKdfParamsAreCurrent(
  params: AuthKdfParams | null | undefined
): boolean {
  return (
    params?.algorithm === AUTH_PROOF_KDF_PARAMS.algorithm &&
    params.memoryKiB === AUTH_PROOF_KDF_PARAMS.memoryKiB &&
    params.iterations === AUTH_PROOF_KDF_PARAMS.iterations &&
    params.parallelism === AUTH_PROOF_KDF_PARAMS.parallelism &&
    params.keyLength === AUTH_PROOF_KDF_PARAMS.keyLength
  );
}

export function randomAuthNonce(bytes = 32): string {
  const output = new Uint8Array(bytes);
  crypto.getRandomValues(output);
  return base64UrlEncode(output);
}

export async function passwordVerifierFromPassword(
  password: string,
  salt = randomAuthNonce(16),
  params: AuthKdfParams = AUTH_PROOF_KDF_PARAMS
): Promise<PasswordVerifier> {
  const saltedPassword = await deriveAuthPasswordBytes(password, salt, params);
  const clientKey = hmacSha256(saltedPassword, CLIENT_KEY_LABEL);
  const storedKey = sha256(clientKey);
  const serverKey = hmacSha256(saltedPassword, SERVER_KEY_LABEL);
  return {
    algorithm: AUTH_PROOF_ALGORITHM,
    salt,
    params,
    storedKey: base64UrlEncode(storedKey),
    serverKey: base64UrlEncode(serverKey)
  };
}

export async function authProofFromPassword(
  password: string,
  challenge: AuthChallengeResponse
): Promise<AuthProofMaterial> {
  if (challenge.mode !== 'proof') {
    throw new Error('Password proof challenge is not available');
  }
  if (!authKdfParamsAreCurrent(challenge.params)) {
    throw new Error('Unsupported password proof parameters');
  }

  const saltedPassword = await deriveAuthPasswordBytes(
    password,
    challenge.salt,
    challenge.params
  );
  const clientKey = hmacSha256(saltedPassword, CLIENT_KEY_LABEL);
  const storedKey = sha256(clientKey);
  const message = authProofMessage(challenge);
  const clientSignature = hmacSha256(storedKey, message);
  const proof = xorBytes(clientKey, clientSignature);
  const serverKey = hmacSha256(saltedPassword, SERVER_KEY_LABEL);
  return {
    proof: {
      challengeId: challenge.challengeId,
      clientNonce: challenge.clientNonce,
      proof: base64UrlEncode(proof)
    },
    expectedServerProof: base64UrlEncode(hmacSha256(serverKey, message))
  };
}

export function authProofMessage(challenge: {
  challengeId: string;
  username: string;
  purpose: string;
  clientNonce: string;
  serverNonce: string;
  salt: string;
  params: AuthKdfParams;
}): string {
  return [
    AUTH_MESSAGE_VERSION,
    `username=${challenge.username}`,
    `purpose=${challenge.purpose}`,
    `challenge=${challenge.challengeId}`,
    `clientNonce=${challenge.clientNonce}`,
    `serverNonce=${challenge.serverNonce}`,
    `salt=${challenge.salt}`,
    `params=${authKdfParamsString(challenge.params)}`
  ].join('\n');
}

export function verifyAuthServerProof(
  expectedServerProof: string,
  serverProof: string | null | undefined
): boolean {
  if (!serverProof) return false;
  const actual = decodeBase64UrlStrict(serverProof);
  const expected = decodeBase64UrlStrict(expectedServerProof);
  return Boolean(actual && expected && constantTimeEqual(actual, expected));
}

export function decodeBase64UrlStrict(value: string): Uint8Array | null {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return null;
  try {
    const bytes = base64UrlDecode(value);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export function base64UrlEncode(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64url');
  }

  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll(/=+$/g, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '='
  );
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }

  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

export function constantTimeEqual(
  actual: Uint8Array,
  expected: Uint8Array
): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

export function xorBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length !== right.length) {
    throw new Error('Cannot XOR byte arrays with different lengths');
  }
  const output = new Uint8Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    output[index] = left[index] ^ right[index];
  }
  return output;
}

export function hmacSha256(
  key: Uint8Array,
  message: string | Uint8Array
): Uint8Array {
  const bytes = typeof message === 'string' ? encoder.encode(message) : message;
  return hmac(sha256, key, bytes);
}

async function deriveAuthPasswordBytes(
  password: string,
  salt: string,
  params: AuthKdfParams
): Promise<Uint8Array> {
  if (!authKdfParamsAreCurrent(params)) {
    throw new Error('Unsupported password proof parameters');
  }
  const saltBytes = decodeBase64UrlStrict(salt);
  if (!saltBytes || saltBytes.length < 16) {
    throw new Error('Invalid password proof salt');
  }
  return await argon2idAsync(encoder.encode(password), saltBytes, {
    t: params.iterations,
    m: params.memoryKiB,
    p: params.parallelism,
    dkLen: params.keyLength,
    maxmem: params.memoryKiB * 1024 + 1024 * 1024
  });
}
