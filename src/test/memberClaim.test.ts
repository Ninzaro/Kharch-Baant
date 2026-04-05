import { describe, it, expect } from 'vitest';
import type { Person, PersonSource } from '../../types';

describe('Person type', () => {
  it('accepts isClaimed and source fields', () => {
    const claimed: Person = {
      id: 'abc',
      name: 'Rahul',
      avatarUrl: 'https://example.com/img.jpg',
      isClaimed: true,
      source: 'self',
    };
    expect(claimed.isClaimed).toBe(true);
    expect(claimed.source).toBe('self');
  });

  it('accepts unclaimed dummy with email', () => {
    const dummy: Person = {
      id: 'xyz',
      name: 'Priya',
      avatarUrl: 'https://example.com/img.jpg',
      email: 'priya@example.com',
      isClaimed: false,
      source: 'manual',
    };
    expect(dummy.isClaimed).toBe(false);
    expect(dummy.email).toBe('priya@example.com');
  });

  it('maps DB row fields to Person correctly', () => {
    const dbRow = {
      id: 'test-id',
      name: 'Test User',
      avatar_url: 'https://example.com/a.jpg',
      email: 'test@example.com',
      clerk_user_id: 'clerk_123',
      auth_user_id: null,
      is_claimed: true,
      source: 'self',
    };

    const authUserId = (dbRow as any)?.auth_user_id ?? (dbRow as any)?.clerk_user_id ?? null;
    const result: Person = {
      id: dbRow.id,
      name: dbRow.name,
      avatarUrl: dbRow.avatar_url,
      email: dbRow.email,
      authUserId: authUserId || undefined,
      isClaimed: dbRow.is_claimed,
      source: dbRow.source as PersonSource,
    };

    expect(result.isClaimed).toBe(true);
    expect(result.source).toBe('self');
    expect(result.email).toBe('test@example.com');
  });
});
