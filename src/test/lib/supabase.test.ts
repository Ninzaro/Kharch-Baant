import { afterEach, describe, expect, it, vi } from 'vitest';

const realtimeAuth = vi.hoisted(() => ({
  setAuth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ realtime: { setAuth: realtimeAuth.setAuth } })),
}));
vi.unmock('../../../lib/supabase');

import {
  ClerkTokenError,
  getClerkSupabaseToken,
  setClerkTokenGetter,
  setRealtimeAuth,
} from '../../../lib/supabase';

afterEach(() => {
  setClerkTokenGetter(null);
  delete (window as any).Clerk;
  realtimeAuth.setAuth.mockReset().mockResolvedValue(undefined);
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

describe('setRealtimeAuth', () => {
  it('awaits realtime.setAuth with the given token', async () => {
    let resolved = false;
    realtimeAuth.setAuth.mockImplementation(
      () => new Promise((resolve) => { queueMicrotask(() => { resolved = true; resolve(undefined); }); }),
    );

    await setRealtimeAuth('jwt-live');

    expect(realtimeAuth.setAuth).toHaveBeenCalledWith('jwt-live');
    expect(resolved).toBe(true);
  });

  it('does not throw when setAuth rejects', async () => {
    realtimeAuth.setAuth.mockRejectedValue(new Error('ws down'));
    await expect(setRealtimeAuth('jwt-live')).resolves.toBeUndefined();
  });
});
