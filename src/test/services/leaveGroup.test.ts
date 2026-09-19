import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
  getClerkSupabaseToken: vi.fn(),
  setRealtimeAuth: vi.fn(),
  setClerkTokenGetter: vi.fn(),
}));

import { leaveGroup } from '../../../services/supabaseApiService';

describe('leaveGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the identity-bound leave_group RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(leaveGroup('group-1')).resolves.toEqual({ success: true });

    expect(mocks.rpc).toHaveBeenCalledWith('leave_group', {
      p_group_id: 'group-1',
    });
  });

  it('surfaces a non-zero balance rejection', async () => {
    const error = {
      code: '23514',
      message: 'Settle your balance before leaving this group',
    };
    mocks.rpc.mockResolvedValue({ data: null, error });

    await expect(leaveGroup('group-1')).rejects.toBe(error);
  });
});
