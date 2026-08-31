import { describe, expect, it } from 'vitest';
import { nativeHideClerkSocials, NATIVE_SSO_REDIRECT } from '../../../components/auth/clerkAppearance';
import {
  NATIVE_OAUTH_PROVIDERS,
  buildAccountPortalOAuthUrl,
  CLERK_ACCOUNT_PORTAL_SIGN_IN,
} from '../../../hooks/useNativeOAuth';

describe('native OAuth', () => {
  it('hides Clerk provider buttons but not the whole social root (that breaks email)', () => {
    expect(nativeHideClerkSocials.socialButtonsBlockButton__google.display).toBe('none');
    expect(nativeHideClerkSocials).not.toHaveProperty('socialButtonsRoot');
    expect(NATIVE_SSO_REDIRECT).toBe('kharchbaant://sso-callback');
  });

  it('offers Google, Apple, and Microsoft on native', () => {
    expect(NATIVE_OAUTH_PROVIDERS.map((p) => p.strategy)).toEqual([
      'oauth_google',
      'oauth_apple',
      'oauth_microsoft',
    ]);
  });

  it('opens Clerk Account Portal in the browser, not the Frontend API host', () => {
    const url = buildAccountPortalOAuthUrl();
    expect(url.startsWith(CLERK_ACCOUNT_PORTAL_SIGN_IN)).toBe(true);
    expect(url).toContain(encodeURIComponent(NATIVE_SSO_REDIRECT));
    expect(url).not.toContain('clerk.motamaati.in');
  });
});
