export const MIN_PASSWORD_LENGTH = 15;

export function passwordCharacterLength(password: string): number {
  return Array.from(password).length;
}

export function passwordMeetsMinimumLength(password: string): boolean {
  return passwordCharacterLength(password) >= MIN_PASSWORD_LENGTH;
}
