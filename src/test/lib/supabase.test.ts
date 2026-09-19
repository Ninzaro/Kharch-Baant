import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ realtime: { setAuth: vi.fn() } })),
}));
vi.unmock('../../../lib/supabase');

import {
  ClerkTokenError,
  getClerkSupabaseToken,
  setClerkTokenGetter,
} from '../../../lib/supabase';

afterEach(() => {
  setClerkTokenGetter(null);
  delete (window as any).Clerk;
});

describe('getClerkSupabaseToken', () => {
  it('returns an empty token only when there is no Clerk session', async () => {
    await expect(getClerkSupabaseToken()).resolves.toBe('');
  });

  it('rejects instead of silently falling back to anonymous when token retrieval fails', async () => {
    setClerkTokenGetter(async () => {
      throw new Error('Clerk unavailable');
    });

    await expect(getClerkSupabaseToken()).rejects.toBeInstanceOf(ClerkTokenError);
  });

  it('rejects when an active Clerk session returns no token', async () => {
    setClerkTokenGetter(async () => null);

    await expect(getClerkSupabaseToken()).rejects.toBeInstanceOf(ClerkTokenError);
  });
});
