import { describe, expect, it, vi } from 'vitest';
import { NATIVE_SSO_REDIRECT, NATIVE_PORTAL_RETURN_URL } from '../../../components/auth/clerkAppearance';
import {
  buildAccountPortalOAuthUrl,
  CLERK_ACCOUNT_PORTAL_SIGN_IN,
  startNativeGoogleOAuth,
} from '../../../hooks/useNativeOAuth';
import { Browser } from '@capacitor/browser';

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('native OAuth', () => {
  it('asks Clerk to return to the HTTPS bounce page, not the website home', () => {
    const url = buildAccountPortalOAuthUrl();
    expect(url.startsWith(CLERK_ACCOUNT_PORTAL_SIGN_IN)).toBe(true);
    expect(url).toContain(encodeURIComponent(NATIVE_PORTAL_RETURN_URL));
    expect(url).not.toContain('clerk.motamaati.in');
  });

  it('initiates Google OAuth via signIn.create and opens Browser with externalVerificationRedirectURL', async () => {
    const mockSignIn = {
      create: vi.fn().mockResolvedValue({
        firstFactorVerification: {
          externalVerificationRedirectURL: new URL('https://accounts.google.com/o/oauth2/v2/auth?test=1'),
        },
      }),
    };

    await startNativeGoogleOAuth(mockSignIn, undefined);

    expect(mockSignIn.create).toHaveBeenCalledWith({
      strategy: 'oauth_google',
      redirectUrl: NATIVE_SSO_REDIRECT,
      actionCompleteRedirectUrl: NATIVE_SSO_REDIRECT,
    });
    expect(Browser.open).toHaveBeenCalledWith({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?test=1',
    });
  });

  it('falls back to signUp.create if signIn.create fails', async () => {
    const mockSignIn = {
      create: vi.fn().mockRejectedValue(new Error('User not found')),
    };
    const mockSignUp = {
      create: vi.fn().mockResolvedValue({
        verifications: {
          externalAccount: {
            externalVerificationRedirectURL: new URL('https://accounts.google.com/o/oauth2/v2/auth?signup=1'),
          },
        },
      }),
    };

    await startNativeGoogleOAuth(mockSignIn, mockSignUp);

    expect(mockSignIn.create).toHaveBeenCalled();
    expect(mockSignUp.create).toHaveBeenCalledWith({
      strategy: 'oauth_google',
      redirectUrl: NATIVE_SSO_REDIRECT,
      actionCompleteRedirectUrl: NATIVE_SSO_REDIRECT,
    });
    expect(Browser.open).toHaveBeenCalledWith({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?signup=1',
    });
  });
});

