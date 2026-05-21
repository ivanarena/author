import { describe, expect, it } from 'vitest';
import { parseDateValue } from './archive-parser';

describe('archive parser date values', () => {
  it('normalizes numeric timestamps from common archive formats', () => {
    expect(parseDateValue(1_800_000_000)).toBe('2027-01-15T08:00:00.000Z');
    expect(parseDateValue(1_800_000_000_000)).toBe('2027-01-15T08:00:00.000Z');
    expect(parseDateValue(1_800_000_000_000_000)).toBe(
      '2027-01-15T08:00:00.000Z'
    );
  });

  it('parses strings defensively and rejects empty or invalid dates', () => {
    expect(parseDateValue(' 1800000000 ')).toBe('2027-01-15T08:00:00.000Z');
    expect(parseDateValue('2027-01-15T08:00:00.000Z')).toBe(
      '2027-01-15T08:00:00.000Z'
    );
    expect(parseDateValue('')).toBeNull();
    expect(parseDateValue('not a date')).toBeNull();
    expect(parseDateValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseDateValue({ createdAt: '2027-01-15' })).toBeNull();
  });
});
