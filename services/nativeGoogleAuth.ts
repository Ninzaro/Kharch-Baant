import { SocialLogin } from '@capgo/capacitor-social-login';

/**
 * Google Web OAuth client ID.
 *
 * IMPORTANT:
 * This must be the WEB client ID from the same Google Cloud project
 * that is configured in Clerk -> SSO -> Google -> Custom credentials.
 *
 * The Android OAuth client is used for the native Android configuration,
 * but this value must remain the Web client ID.
 */
export const GOOGLE_WEB_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ||
  '1042927142025-7qtde6trtg8vm1rkb2j2pae02b0ri3f4.apps.googleusercontent.com';

let initialized = false;

/**
 * Initialize the Capgo native Google provider.
 */
export async function initNativeGoogleAuth(): Promise<void> {
  if (initialized) {
    return;
  }

  const webClientId = GOOGLE_WEB_CLIENT_ID?.trim();

  if (!webClientId) {
    throw new Error(
      'Missing VITE_GOOGLE_WEB_CLIENT_ID. Configure the Google Web OAuth client ID.'
    );
  }

  await SocialLogin.initialize({
    google: {
      webClientId,
      mode: 'online',
    },
  });

  initialized = true;
}

/**
 * Result returned by the native Google login.
 */
export interface NativeGoogleUser {
  idToken: string;
  userId?: string;
  email?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  imageUrl?: string;
}

/**
 * Decode a JWT payload for debugging only.
 *
 * DO NOT use this decoded payload as proof of authentication.
 * The ID token itself is sent to Clerk, which validates it server-side.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];

    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '='
    );

    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Perform native Google authentication through Android Credential Manager.
 *
 * This gets a Google ID token from the native Android side.
 */
export async function performNativeGoogleSignIn(): Promise<NativeGoogleUser> {
  await initNativeGoogleAuth();

  const result = await SocialLogin.login({
    provider: 'google',
    options: {
      style: 'bottom',
      filterByAuthorizedAccounts: false,
    },
  });

  const idToken = result.result?.idToken;

  if (!idToken) {
    throw new Error(
      'Google authentication succeeded, but Google did not return an ID token.'
    );
  }

  // Debug information only. Never log the actual token.
  const payload = decodeJwtPayload(idToken);

  console.log('========== GOOGLE ID TOKEN ==========');
  console.log('iss:', payload?.iss);
  console.log('aud:', payload?.aud);
  console.log('azp:', payload?.azp);
  console.log('sub:', payload?.sub);
  console.log('email_verified:', payload?.email_verified);
  console.log('payload claims:', payload ? Object.keys(payload) : []);
  console.log('MY_DEBUG_TOKEN: present');

  return {
    idToken,
    userId: result.result?.profile?.id,
    email: result.result?.profile?.email,
    name: result.result?.profile?.name,
    givenName: result.result?.profile?.givenName,
    familyName: result.result?.profile?.familyName,
    imageUrl: result.result?.profile?.imageUrl,
  };
}

/**
 * Exchange the native Google ID token with Clerk.
 *
 * IMPORTANT:
 * Do NOT use `oauth_token_google` or `google_one_tap` as a strategy
 * with signIn.create(). Those are not valid ClerkJS strategies for
 * this native ID-token flow.
 *
 * The Google ID token is passed to Clerk's Google credential API.
 */
export async function exchangeGoogleIdTokenWithClerk(
  clerk: any,
  googleUser: NativeGoogleUser
): Promise<any> {
  if (!clerk) {
    throw new Error('Clerk is not available.');
  }

  const idToken = googleUser?.idToken;

  if (!idToken) {
    throw new Error('Missing Google ID token.');
  }

  if (!clerk.loaded) {
    await clerk.load();
  }

  // Free-plan Clerk instances are locked to single-session mode.
  // Any lingering session must be cleared before attempting a new sign-in,
  // or Clerk's server rejects the request with authorization_invalid.
  try {
    if (
      clerk.session ||
      (clerk.client?.signedInSessions?.length ?? 0) > 0
    ) {
      console.log(
        'MY_DEBUG: clearing existing Clerk session before native sign-in'
      );

      await clerk.signOut();

      // Give Clerk's internal state a moment to fully clear before retrying.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (cleanupError) {
    // Session cleanup should never prevent a fresh sign-in attempt.
    console.log(
      'MY_DEBUG: session cleanup error (non-fatal):',
      cleanupError
    );
  }

  console.log('MY_DEBUG: exchanging Google ID token with Clerk');

  try {
    /**
     * Clerk's JavaScript SDK Google credential authentication.
     *
     * The native Android Google login gives us a Google ID token,
     * which is passed directly to Clerk for server-side validation.
     */
    if (typeof clerk.authenticateWithGoogleOneTap !== 'function') {
      throw new Error(
        'Your installed Clerk JavaScript SDK does not expose authenticateWithGoogleOneTap(). Please update @clerk/clerk-react before using native Google ID-token authentication.'
      );
    }

    const signInOrUp = await clerk.authenticateWithGoogleOneTap({
      token: idToken,
    });

    console.log(
      'MY_DEBUG: Clerk Google authentication response received',
      signInOrUp?.status
    );

    /**
     * If Clerk has completed the authentication, activate the session.
     */
    if (
      signInOrUp?.status === 'complete' &&
      signInOrUp?.createdSessionId
    ) {
      await clerk.setActive({
        session: signInOrUp.createdSessionId,
      });

      console.log('MY_DEBUG: Clerk session activated');

      return signInOrUp;
    }

    /**
     * Clerk may require an additional step such as MFA or profile
     * completion. Return the resource to the caller so the UI can
     * handle that state.
     */
    if (signInOrUp) {
      console.log(
        'MY_DEBUG: Clerk authentication requires additional steps',
        signInOrUp.status
      );

      return signInOrUp;
    }

    throw new Error('Clerk returned an empty Google authentication response.');
  } catch (error: any) {
    console.error('MY_DEBUG_ERROR:', error);

    const status = error?.status;
    const code = error?.errors?.[0]?.code;
    const message =
      error?.errors?.[0]?.long_message ||
      error?.errors?.[0]?.message ||
      error?.message ||
      'Google sign-in failed.';

    console.error('MY_DEBUG_ERROR_status:', status);
    console.error('MY_DEBUG_ERROR_code:', code);
    console.error('MY_DEBUG_ERROR_message:', message);

    if (status === 403 || code === 'authorization_invalid') {
      throw new Error(
        'Clerk rejected the Google credential. In Clerk Dashboard, open SSO -> Google, enable Google for sign-in/sign-up, enable "Use custom credentials", and configure the Google Web Client ID and Web Client Secret from the same Google Cloud project.'
      );
    }

    if (status === 422) {
      throw new Error(`Clerk rejected the Google credential: ${message}`);
    }

    throw new Error(message);
  }
}

/**
 * Returns the configured Google Web OAuth client ID.
 */
export function getGoogleWebClientId(): string {
  return GOOGLE_WEB_CLIENT_ID;
}
