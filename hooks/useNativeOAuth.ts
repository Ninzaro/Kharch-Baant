import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { NATIVE_SSO_REDIRECT } from '../components/auth/clerkAppearance';

export type NativeOAuthStrategy = 'oauth_google' | 'oauth_apple' | 'oauth_microsoft';

export const NATIVE_OAUTH_PROVIDERS: { strategy: NativeOAuthStrategy; label: string }[] = [
  { strategy: 'oauth_google', label: 'Google' },
  { strategy: 'oauth_apple', label: 'Apple' },
  { strategy: 'oauth_microsoft', label: 'Microsoft' },
];

/** Clerk Account Portal (HTML). Never open clerk.motamaati.in (FAPI) in a browser tab. */
export const CLERK_ACCOUNT_PORTAL_SIGN_IN = 'https://accounts.motamaati.in/sign-in';

/**
 * Open Google / Apple / Microsoft in Chrome Custom Tabs via Clerk's Account Portal.
 *
 * Opening the Frontend API host (clerk.motamaati.in) in a tab causes
 * `authorization_invalid` — FAPI needs clerk-js headers/cookies, which Chrome
 * does not have. The Account Portal is a real website; after Google it
 * redirects to kharchbaant://sso-callback.
 */
export function buildAccountPortalOAuthUrl(): string {
  const url = new URL(CLERK_ACCOUNT_PORTAL_SIGN_IN);
  url.searchParams.set('redirect_url', NATIVE_SSO_REDIRECT);
  url.searchParams.set('after_sign_in_url', NATIVE_SSO_REDIRECT);
  url.searchParams.set('after_sign_up_url', NATIVE_SSO_REDIRECT);
  return url.toString();
}

export function useNativeOAuth() {
  const isNative = Capacitor.isNativePlatform();
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState<NativeOAuthStrategy | null>(null);

  useEffect(() => {
    if (!isNative) return;
    let handle: { remove: () => Promise<void> } | undefined;
    const sub = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) setOauthBusy(null);
    });
    sub.then((l) => { handle = l; }).catch(() => {});
    return () => { handle?.remove(); };
  }, [isNative]);

  const startOAuth = async (strategy: NativeOAuthStrategy) => {
    setOauthError(null);
    setOauthBusy(strategy);
    try {
      await Browser.open({ url: buildAccountPortalOAuthUrl() });
    } catch (err) {
      console.error('OAuth start failed', strategy, err);
      setOauthError('Could not open the sign-in browser. Try email instead.');
      setOauthBusy(null);
    }
  };

  return { isNative, isLoaded: true, startOAuth, oauthBusy, oauthError };
}
