import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { NATIVE_PORTAL_RETURN_URL } from '../components/auth/clerkAppearance';

/** Clerk Account Portal (HTML). Never open clerk.motamaati.in (FAPI) in a browser tab. */
export const CLERK_ACCOUNT_PORTAL_SIGN_IN = 'https://accounts.motamaati.in/sign-in';

/**
 * Clerk's hosted sign-in in Chrome Custom Tabs.
 * After Google / email, Clerk redirects to native-sso.html (HTTPS), which
 * then opens kharchbaant://sso-callback so the Android app — not Chrome — gets the session.
 */
export function buildAccountPortalOAuthUrl(): string {
  const url = new URL(CLERK_ACCOUNT_PORTAL_SIGN_IN);
  url.searchParams.set('redirect_url', NATIVE_PORTAL_RETURN_URL);
  url.searchParams.set('after_sign_in_url', NATIVE_PORTAL_RETURN_URL);
  url.searchParams.set('after_sign_up_url', NATIVE_PORTAL_RETURN_URL);
  url.searchParams.set('sign_in_force_redirect_url', NATIVE_PORTAL_RETURN_URL);
  url.searchParams.set('sign_up_force_redirect_url', NATIVE_PORTAL_RETURN_URL);
  return url.toString();
}

export async function openAccountPortal(): Promise<void> {
  await Browser.open({ url: buildAccountPortalOAuthUrl() });
}

export function useNativeOAuth() {
  const isNative = Capacitor.isNativePlatform();
  return { isNative, openAccountPortal };
}
