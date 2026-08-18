import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignupInvitation, signupInvitationIsValid } from './auth';

describe('signed signup invitations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T00:00:00.000Z'));
    process.env.NOTES_SERVER_SECRET = 'test-server-secret-with-32-characters';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NOTES_SERVER_SECRET;
  });

  it('binds an invitation to its email and expiry', () => {
    const invitation = createSignupInvitation(
      'invited@example.com',
      new Date('2026-08-18T00:00:00.000Z')
    );

    expect(signupInvitationIsValid('invited@example.com', invitation)).toBe(
      true
    );
    expect(signupInvitationIsValid('other@example.com', invitation)).toBe(
      false
    );
    expect(
      signupInvitationIsValid('invited@example.com', `${invitation}x`)
    ).toBe(false);

    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'));
    expect(signupInvitationIsValid('invited@example.com', invitation)).toBe(
      false
    );
  });
});
