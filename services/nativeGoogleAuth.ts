import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';

let isInitialized = false;

export async function initNativeGoogleAuth(): Promise<void> {
  if (!Capacitor.isNativePlatform() || isInitialized) return;

  const webClientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '';
  if (!webClientId) {
    console.warn('VITE_GOOGLE_WEB_CLIENT_ID is not configured.');
    return;
  }

  try {
    await SocialLogin.initialize({
      google: {
        webClientId,
        mode: 'online',
      },
    });
    isInitialized = true;
  } catch (err) {
    console.error('Failed to initialize native Google auth:', err);
  }
}

export interface NativeGoogleLoginResult {
  idToken?: string;
  accessToken?: string;
  email?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  imageUrl?: string;
}

export async function performNativeGoogleSignIn(): Promise<NativeGoogleLoginResult> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native Google sign-in is only available on mobile devices.');
  }

  await initNativeGoogleAuth();

  const res = await SocialLogin.login({
    provider: 'google',
    options: {
      scopes: ['email', 'profile'],
    },
  });

  const result = res.result;
  if (!result) {
    throw new Error('Google Sign-In was cancelled or failed to return credentials.');
  }

  return {
    idToken: result.idToken || undefined,
    accessToken: (result as any).accessToken?.token || (result as any).accessToken || undefined,
    email: result.email || (result as any).profile?.email || undefined,
    name: result.name || (result as any).profile?.name || undefined,
    givenName: result.givenName || (result as any).profile?.givenName || undefined,
    familyName: result.familyName || (result as any).profile?.familyName || undefined,
    imageUrl: result.imageUrl || (result as any).profile?.imageUrl || undefined,
  };
}
