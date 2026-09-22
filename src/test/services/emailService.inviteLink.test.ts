import { describe, expect, it } from 'vitest';
import { inviteLink } from '../../../services/emailService';

describe('inviteLink', () => {
  it('uses the production origin send-email allows', () => {
    expect(inviteLink('abc')).toBe('https://www.motamaati.in/invite/abc');
  });
});
