import { describe, expect, it } from 'vitest';
import { NATIVE_SSO_REDIRECT } from '../../../components/auth/clerkAppearance';
import {
  buildAccountPortalOAuthUrl,
  CLERK_ACCOUNT_PORTAL_SIGN_IN,
} from '../../../hooks/useNativeOAuth';

describe('native OAuth', () => {
  it('opens Clerk Account Portal in the browser, not the Frontend API host', () => {
    const url = buildAccountPortalOAuthUrl();
    expect(url.startsWith(CLERK_ACCOUNT_PORTAL_SIGN_IN)).toBe(true);
    expect(url).toContain(encodeURIComponent(NATIVE_SSO_REDIRECT));
    expect(url).not.toContain('clerk.motamaati.in');
  });
});
