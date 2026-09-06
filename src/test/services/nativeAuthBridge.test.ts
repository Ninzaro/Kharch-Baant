import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
  },
  registerPlugin: vi.fn(() => ({
    signInWithGoogle: vi.fn(),
  })),
  WebPlugin: class WebPlugin {},
}));

vi.mock('../../../services/clerkNativeAuth', () => ({
  default: {
    signInWithGoogle: vi.fn(),
  },
}));

vi.mock('../../../services/nativeGoogleAuth', () => ({
  performNativeGoogleSignIn: vi.fn(),
}));

vi.mock('../../../utils/env', () => ({
  getEnvValue: vi.fn((key: string) => {
    if (key === 'VITE_SUPABASE_URL') return 'https://example.supabase.co';
    if (key === 'VITE_SUPABASE_ANON_KEY') return 'anon-key';
    if (key === 'VITE_CLERK_PUBLISHABLE_KEY') return 'pk_live_test';
    return undefined;
  }),
}));

import { Capacitor } from '@capacitor/core';
import ClerkNativeAuth from '../../../services/clerkNativeAuth';
import { performNativeGoogleSignIn } from '../../../services/nativeGoogleAuth';
import {
  completeNativeGoogleSignIn,
  consumeSignInTicket,
  isAndroidNativeApp,
  nativeBridgeUrl,
} from '../../../services/nativeAuthBridge';

describe('nativeAuthBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
  });

  it('selects the native bridge only on Capacitor Android', () => {
    expect(isAndroidNativeApp()).toBe(false);

    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    expect(isAndroidNativeApp()).toBe(false);

    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    expect(isAndroidNativeApp()).toBe(true);
  });

  it('builds the existing Supabase Edge Function URL', () => {
    expect(nativeBridgeUrl('https://example.supabase.co/')).toBe(
      'https://example.supabase.co/functions/v1/native-bridge'
    );
  });

  it('activates the clerk-react session from a completed ticket sign-in', async () => {
    const signIn = {
      create: vi.fn().mockResolvedValue({
        status: 'complete',
        createdSessionId: 'sess_webview_1',
      }),
    };
    const setActive = vi.fn().mockResolvedValue(undefined);

    await consumeSignInTicket(signIn, setActive, 'sit_ticket');

    expect(signIn.create).toHaveBeenCalledWith({
      strategy: 'ticket',
      ticket: 'sit_ticket',
    });
    expect(setActive).toHaveBeenCalledWith({ session: 'sess_webview_1' });
  });

  it('does not call setActive when the ticket sign-in is incomplete', async () => {
    const signIn = {
      create: vi.fn().mockResolvedValue({
        status: 'needs_first_factor',
        createdSessionId: null,
      }),
    };
    const setActive = vi.fn();

    await expect(consumeSignInTicket(signIn, setActive, 'sit_ticket')).rejects.toThrow(
      /did not complete/
    );
    expect(setActive).not.toHaveBeenCalled();
  });

  it('orchestrates Google → native Clerk → backend ticket → clerk-react', async () => {
    vi.mocked(performNativeGoogleSignIn).mockResolvedValue({
      idToken: 'google-id-token',
    });
    vi.mocked(ClerkNativeAuth.signInWithGoogle).mockResolvedValue({
      token: 'native-session-jwt',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: 'sit_one_time' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const signIn = {
      create: vi.fn().mockResolvedValue({
        status: 'complete',
        createdSessionId: 'sess_webview_2',
      }),
    };
    const setActive = vi.fn().mockResolvedValue(undefined);

    await completeNativeGoogleSignIn({ signIn, setActive });

    expect(performNativeGoogleSignIn).toHaveBeenCalled();
    expect(ClerkNativeAuth.signInWithGoogle).toHaveBeenCalledWith({
      googleIdToken: 'google-id-token',
      publishableKey: 'pk_live_test',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/native-bridge',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer native-session-jwt',
          apikey: 'anon-key',
        }),
      })
    );
    expect(signIn.create).toHaveBeenCalledWith({
      strategy: 'ticket',
      ticket: 'sit_one_time',
    });
    expect(setActive).toHaveBeenCalledWith({ session: 'sess_webview_2' });

    vi.unstubAllGlobals();
  });
});
