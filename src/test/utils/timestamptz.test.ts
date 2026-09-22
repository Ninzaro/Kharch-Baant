import { describe, expect, it } from 'vitest';
import { postgrestTimestamptz } from '../../../utils/timestamptz';

describe('postgrestTimestamptz', () => {
  it('rewrites a UTC offset so PostgREST does not treat + as a space', () => {
    expect(postgrestTimestamptz('2026-09-22T05:18:33.672242+00:00')).toBe(
      '2026-09-22T05:18:33.672242Z',
    );
  });

  it('leaves an already-Z timestamp unchanged', () => {
    expect(postgrestTimestamptz('2026-09-22T05:18:33.672242Z')).toBe(
      '2026-09-22T05:18:33.672242Z',
    );
  });
});
