import { describe, expect, it } from 'vitest';
import { NATIVE_PORTAL_RETURN_URL } from '../../../components/auth/clerkAppearance';
import {
  buildAccountPortalOAuthUrl,
  CLERK_ACCOUNT_PORTAL_SIGN_IN,
} from '../../../hooks/useNativeOAuth';

describe('native OAuth', () => {
  it('asks Clerk to return to the HTTPS bounce page, not the website home', () => {
    const url = buildAccountPortalOAuthUrl();
    expect(url.startsWith(CLERK_ACCOUNT_PORTAL_SIGN_IN)).toBe(true);
    expect(url).toContain(encodeURIComponent(NATIVE_PORTAL_RETURN_URL));
    expect(url).not.toContain('clerk.motamaati.in');
  });
});
