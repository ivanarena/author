import { describe, expect, it } from 'vitest';
import {
  AUTH_PROOF_ALGORITHM,
  AUTH_PROOF_KDF_PARAMS,
  authProofFromPassword,
  decodeBase64UrlStrict,
  passwordVerifierFromPassword,
  randomAuthNonce,
  verifyAuthServerProof
} from './auth-proof';

describe('auth proof protocol', () => {
  it('derives an Argon2id SCRAM-style verifier and password proof', async () => {
    const verifier = await passwordVerifierFromPassword(
      'correct horse battery'
    );
    expect(verifier).toMatchObject({
      algorithm: AUTH_PROOF_ALGORITHM,
      params: AUTH_PROOF_KDF_PARAMS
    });
    expect(verifier.salt).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.storedKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.serverKey).toMatch(/^[A-Za-z0-9_-]+$/);

    const challenge = {
      mode: 'proof' as const,
      challengeId: randomAuthNonce(24),
      username: 'owner',
      purpose: 'login' as const,
      clientNonce: randomAuthNonce(),
      serverNonce: randomAuthNonce(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      salt: verifier.salt,
      params: verifier.params
    };

    const material = await authProofFromPassword(
      'correct horse battery',
      challenge
    );
    expect(material.proof).toMatchObject({
      challengeId: challenge.challengeId,
      clientNonce: challenge.clientNonce,
      proof: expect.stringMatching(/^[A-Za-z0-9_-]+$/)
    });
    expect(
      verifyAuthServerProof(
        material.expectedServerProof,
        material.expectedServerProof
      )
    ).toBe(true);
    expect(
      verifyAuthServerProof(material.expectedServerProof, verifier.storedKey)
    ).toBe(false);
  });

  it('binds proofs to the challenge nonce and purpose', async () => {
    const verifier = await passwordVerifierFromPassword(
      'correct horse battery'
    );
    const challenge = {
      mode: 'proof' as const,
      challengeId: randomAuthNonce(24),
      username: 'owner',
      purpose: 'login' as const,
      clientNonce: randomAuthNonce(),
      serverNonce: randomAuthNonce(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      salt: verifier.salt,
      params: verifier.params
    };
    const login = await authProofFromPassword(
      'correct horse battery',
      challenge
    );
    const changedPurpose = await authProofFromPassword(
      'correct horse battery',
      {
        ...challenge,
        purpose: 'delete_account'
      }
    );

    expect(login.proof.proof).not.toBe(changedPurpose.proof.proof);
    expect(login.expectedServerProof).not.toBe(
      changedPurpose.expectedServerProof
    );
  });

  it('rejects non-canonical base64url input', () => {
    expect(decodeBase64UrlStrict('AA')).not.toBeNull();
    expect(decodeBase64UrlStrict('AA!!')).toBeNull();
    expect(decodeBase64UrlStrict('A')).toBeNull();
    expect(decodeBase64UrlStrict('AA==')).toBeNull();
  });
});
