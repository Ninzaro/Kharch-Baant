import { describe, expect, it, vi } from 'vitest';
import { exchangeGoogleIdTokenWithClerk } from '../../../services/nativeGoogleAuth';

describe('exchangeGoogleIdTokenWithClerk', () => {
  it('throws an error if idToken is missing', async () => {
    const mockClerk = {
      loaded: true,
      authenticateWithGoogleOneTap: vi.fn(),
      setActive: vi.fn(),
    };

    await expect(
      exchangeGoogleIdTokenWithClerk(mockClerk, {} as any)
    ).rejects.toThrow('Missing Google ID token.');
  });

  it('activates a completed Clerk session from authenticateWithGoogleOneTap', async () => {
    const mockClerk = {
      loaded: true,
      authenticateWithGoogleOneTap: vi.fn().mockResolvedValue({
        createdSessionId: 'sess_existing_123',
        status: 'complete',
      }),
      setActive: vi.fn().mockResolvedValue(undefined),
    };

    const result = await exchangeGoogleIdTokenWithClerk(mockClerk, {
      idToken: 'valid_google_id_token',
    });

    expect(mockClerk.authenticateWithGoogleOneTap).toHaveBeenCalledWith({
      token: 'valid_google_id_token',
    });
    expect(mockClerk.setActive).toHaveBeenCalledWith({ session: 'sess_existing_123' });
    expect(result.createdSessionId).toBe('sess_existing_123');
  });

  it('signs out an existing session before exchanging the token', async () => {
    const mockClerk = {
      loaded: true,
      session: { id: 'old_sess' },
      signOut: vi.fn().mockResolvedValue(undefined),
      authenticateWithGoogleOneTap: vi.fn().mockResolvedValue({
        createdSessionId: 'sess_new_999',
        status: 'complete',
      }),
      setActive: vi.fn().mockResolvedValue(undefined),
    };

    vi.useFakeTimers();
    const pending = exchangeGoogleIdTokenWithClerk(mockClerk, {
      idToken: 'token_with_active_session',
    });
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;
    vi.useRealTimers();

    expect(mockClerk.signOut).toHaveBeenCalled();
    expect(mockClerk.setActive).toHaveBeenCalledWith({ session: 'sess_new_999' });
    expect(result.createdSessionId).toBe('sess_new_999');
  });
});
