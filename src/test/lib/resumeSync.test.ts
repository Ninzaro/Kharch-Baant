import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  getClerkSupabaseToken: vi.fn().mockResolvedValue('jwt'),
  setRealtimeAuth: vi.fn().mockResolvedValue(undefined),
  flushPendingMoneyWrites: vi.fn().mockResolvedValue(undefined),
  reapplyPendingToCache: vi.fn(),
}));

vi.mock('../../../lib/queryClient', () => ({
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));

vi.mock('../../../lib/supabase', () => ({
  getClerkSupabaseToken: mocks.getClerkSupabaseToken,
  setRealtimeAuth: mocks.setRealtimeAuth,
}));

vi.mock('../../../services/pendingMoneySync', () => ({
  flushPendingMoneyWrites: mocks.flushPendingMoneyWrites,
}));

vi.mock('../../../lib/outbox', () => ({
  reapplyPendingToCache: mocks.reapplyPendingToCache,
}));

import { resumeAfterBackground } from '../../../lib/resumeSync';

describe('resumeAfterBackground', () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockClear().mockResolvedValue(undefined);
    mocks.getClerkSupabaseToken.mockReset().mockResolvedValue('jwt');
    mocks.setRealtimeAuth.mockClear().mockResolvedValue(undefined);
    mocks.flushPendingMoneyWrites.mockClear().mockResolvedValue(undefined);
    mocks.reapplyPendingToCache.mockClear();
  });

  it('coalesces overlapping resumes onto one token refresh', async () => {
    let release!: (token: string) => void;
    mocks.getClerkSupabaseToken.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    const first = resumeAfterBackground();
    const second = resumeAfterBackground();
    release('jwt');
    await Promise.all([first, second]);

    expect(mocks.getClerkSupabaseToken).toHaveBeenCalledTimes(1);
    expect(mocks.setRealtimeAuth).toHaveBeenCalledTimes(1);
    expect(mocks.flushPendingMoneyWrites).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mocks.reapplyPendingToCache).toHaveBeenCalledTimes(1);
    expect(mocks.flushPendingMoneyWrites.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invalidateQueries.mock.invocationCallOrder[0],
    );
  });
});
