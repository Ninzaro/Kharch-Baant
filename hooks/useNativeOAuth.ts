import { useEffect, useState } from 'react';
import { useSignIn } from '@clerk/clerk-react';
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

/**
 * Start OAuth in Chrome Custom Tabs, then return via kharchbaant://sso-callback.
 * Identity providers block embedded WebViews (Google HTTP 400 "malformed").
 */
export function useNativeOAuth() {
  const isNative = Capacitor.isNativePlatform();
  const { signIn, isLoaded } = useSignIn();
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
    if (!isLoaded || !signIn) return;
    setOauthError(null);
    setOauthBusy(strategy);
    try {
      const result = await signIn.create({
        strategy,
        redirectUrl: NATIVE_SSO_REDIRECT,
        actionCompleteRedirectUrl: NATIVE_SSO_REDIRECT,
      });
      const url = result.firstFactorVerification?.externalVerificationRedirectURL;
      if (!url) {
        throw new Error('Clerk did not return an OAuth URL');
      }
      await Browser.open({ url: url.toString() });
    } catch (err) {
      console.error('OAuth start failed', strategy, err);
      setOauthError('Sign-in could not start. Try email, or check your connection.');
      setOauthBusy(null);
    }
  };

  return { isNative, isLoaded, startOAuth, oauthBusy, oauthError };
}
