import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  passwordCharacterLength,
  passwordMeetsMinimumLength
} from './password-policy';

describe('password policy', () => {
  it('requires at least 15 characters', () => {
    expect(
      passwordMeetsMinimumLength('a'.repeat(MIN_PASSWORD_LENGTH - 1))
    ).toBe(false);
    expect(passwordMeetsMinimumLength('a'.repeat(MIN_PASSWORD_LENGTH))).toBe(
      true
    );
  });

  it('counts Unicode code points instead of UTF-16 units', () => {
    expect(passwordCharacterLength('🙂'.repeat(15))).toBe(15);
    expect(passwordMeetsMinimumLength('🙂'.repeat(14))).toBe(false);
    expect(passwordMeetsMinimumLength('🙂'.repeat(15))).toBe(true);
  });
});
