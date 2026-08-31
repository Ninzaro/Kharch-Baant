import { describe, expect, it } from 'vitest';
import { nativeHideClerkSocials, NATIVE_SSO_REDIRECT } from '../../../components/auth/clerkAppearance';
import { NATIVE_OAUTH_PROVIDERS } from '../../../hooks/useNativeOAuth';

describe('native OAuth', () => {
  it('hides Clerk social buttons on native so Custom Tabs can be used instead', () => {
    expect(nativeHideClerkSocials.socialButtonsRoot.display).toBe('none');
    expect(NATIVE_SSO_REDIRECT).toBe('kharchbaant://sso-callback');
  });

  it('offers Google, Apple, and Microsoft on native', () => {
    expect(NATIVE_OAUTH_PROVIDERS.map((p) => p.strategy)).toEqual([
      'oauth_google',
      'oauth_apple',
      'oauth_microsoft',
    ]);
  });
});
