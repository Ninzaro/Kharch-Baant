import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: mocks.from,
  },
  getClerkSupabaseToken: vi.fn(),
  setRealtimeAuth: vi.fn(),
  setClerkTokenGetter: vi.fn(),
}));

import { ensureUserExists } from '../../../services/supabaseApiService';

describe('ensureUserExists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the person created by ensure_my_person', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        id: 'person-1',
        name: 'New User',
        avatar_url: '',
        email: null,
        clerk_user_id: 'user-1',
        is_claimed: true,
        source: 'self',
      }],
      error: null,
    });

    await expect(
      ensureUserExists('user-1', 'New User', 'NEW@EXAMPLE.COM')
    ).resolves.toMatchObject({
      id: 'person-1',
      email: undefined,
      authUserId: 'user-1',
      isClaimed: true,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('ensure_my_person', {
      p_name: 'New User',
      p_email: 'new@example.com',
    });
  });

  it('surfaces RPC failures without attempting a direct people insert', async () => {
    const rpcError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };
    mocks.rpc.mockResolvedValue({ data: null, error: rpcError });

    await expect(
      ensureUserExists('user-1', 'New User', 'new@example.com')
    ).rejects.toBe(rpcError);

    expect(mocks.from).not.toHaveBeenCalled();
  });
});
