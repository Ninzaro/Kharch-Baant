import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GroupFormModal from '../../../components/GroupFormModal';
import { createGroupInvite } from '../../../services/supabaseApiService';

vi.mock('../../../services/supabaseApiService', () => ({
  createGroupInvite: vi.fn(),
}));

const priya = {
  id: 'priya',
  name: 'Priya',
  avatarUrl: '',
  isClaimed: false as const,
};

describe('GroupFormModal connect', () => {
  beforeEach(() => {
    vi.mocked(createGroupInvite).mockReset().mockResolvedValue({
      inviteUrl: 'https://www.motamaati.in/invite/seat',
      invite: {
        id: 'i1',
        groupId: 'g1',
        inviteToken: 'seat',
        invitedBy: 'me',
        expiresAt: '2026-10-08',
        maxUses: 1,
        currentUses: 0,
        isActive: true,
        createdAt: '2026-10-01',
        updatedAt: '2026-10-01',
      },
    });
    vi.stubGlobal('open', vi.fn());
  });

  it('creates a one-use seat invite for an unclaimed member', async () => {
    render(
      <GroupFormModal
        isOpen
        onClose={() => undefined}
        onSave={() => undefined}
        group={{
          id: 'g1',
          name: 'Goa',
          members: ['me', 'priya'],
          currency: 'INR',
          groupType: 'other',
          createdBy: 'me',
        }}
        allPeople={[
          { id: 'me', name: 'Ninad', avatarUrl: '', isClaimed: true },
          priya,
        ]}
        currentUserId="me"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share via WhatsApp' }));

    await vi.waitFor(() => {
      expect(createGroupInvite).toHaveBeenCalledWith(expect.objectContaining({
        groupId: 'g1',
        invitedBy: 'me',
        forPersonId: 'priya',
        maxUses: 1,
        expiresInDays: 7,
      }));
    });
  });
});
