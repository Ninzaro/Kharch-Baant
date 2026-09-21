import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  getClerkSupabaseToken: vi.fn().mockResolvedValue('jwt'),
  setRealtimeAuth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/queryClient', () => ({
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));

vi.mock('../../../lib/supabase', () => ({
  getClerkSupabaseToken: mocks.getClerkSupabaseToken,
  setRealtimeAuth: mocks.setRealtimeAuth,
}));

import { resumeAfterBackground } from '../../../lib/resumeSync';

describe('resumeAfterBackground', () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockClear().mockResolvedValue(undefined);
    mocks.getClerkSupabaseToken.mockReset().mockResolvedValue('jwt');
    mocks.setRealtimeAuth.mockClear().mockResolvedValue(undefined);
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
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
  });
});
