import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { useSignIn, useSignUp } from '@clerk/clerk-react';
import { NATIVE_PORTAL_RETURN_URL } from '../components/auth/clerkAppearance';

/** Clerk Account Portal (HTML). Never open clerk.motamaati.in (FAPI) in a browser tab. */
export const CLERK_ACCOUNT_PORTAL_SIGN_IN = 'https://accounts.motamaati.in/sign-in';

export function buildAccountPortalOAuthUrl(): string {
  const url = new URL(CLERK_ACCOUNT_PORTAL_SIGN_IN);
  url.searchParams.set('redirect_url', NATIVE_PORTAL_RETURN_URL);
  url.searchParams.set('after_sign_in_url', NATIVE_PORTAL_RETURN_URL);
  url.searchParams.set('after_sign_up_url', NATIVE_PORTAL_RETURN_URL);
  return url.toString();
}

export async function openAccountPortal(): Promise<void> {
  await Browser.open({ url: buildAccountPortalOAuthUrl() });
}

/**
 * Initiates Google OAuth from the WebView Clerk client instance.
 * Opens Google's OAuth consent screen in Chrome Custom Tabs, which then
 * redirects to Clerk and back to the native app via `kharchbaant://sso-callback`.
 */
export async function startNativeGoogleOAuth(
  signIn: any,
  signUp: any
): Promise<void> {
  if (!signIn) {
    throw new Error('Clerk signIn is not initialized yet.');
  }

  let externalUrl: string | undefined;

  try {
    const signInAttempt = await signIn.create({
      strategy: 'oauth_google',
      redirectUrl: NATIVE_PORTAL_RETURN_URL,
      actionCompleteRedirectUrl: NATIVE_PORTAL_RETURN_URL,
    });

    const redirectUrlObj = signInAttempt.firstFactorVerification?.externalVerificationRedirectURL;
    externalUrl = redirectUrlObj ? redirectUrlObj.toString() : undefined;
  } catch (err: any) {
    console.warn('signIn.create for Google OAuth failed, attempting signUp fallback:', err);
    if (signUp) {
      try {
        const signUpAttempt = await signUp.create({
          strategy: 'oauth_google',
          redirectUrl: NATIVE_PORTAL_RETURN_URL,
          actionCompleteRedirectUrl: NATIVE_PORTAL_RETURN_URL,
        });
        const redirectUrlObj = signUpAttempt.verifications?.externalAccount?.externalVerificationRedirectURL;
        externalUrl = redirectUrlObj ? redirectUrlObj.toString() : undefined;
      } catch (signUpErr) {
        console.error('signUp.create fallback also failed:', signUpErr);
        throw signUpErr;
      }
    } else {
      throw err;
    }
  }

  if (!externalUrl) {
    throw new Error('Clerk did not return an external verification URL for Google OAuth.');
  }

  await Browser.open({ url: externalUrl });
}

export function useNativeOAuth() {
  const isNative = Capacitor.isNativePlatform();
  const { signIn, isLoaded: isSignInLoaded } = useSignIn();
  const { signUp, isLoaded: isSignUpLoaded } = useSignUp();

  const startGoogleOAuth = async (): Promise<void> => {
    if (!isSignInLoaded) return;
    await startNativeGoogleOAuth(signIn, isSignUpLoaded ? signUp : undefined);
  };

  return {
    isNative,
    startGoogleOAuth,
    openAccountPortal,
  };
}

