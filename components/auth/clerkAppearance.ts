/**
 * Hide Clerk social buttons inside the Capacitor Android WebView.
 * Native Google uses ClerkNativeAuthPlugin (Credential Manager + clerk-android),
 * not embedded <SignIn /> social buttons and not the Account Portal.
 */
export const NATIVE_HIDE_SOCIAL_CLERK_APPEARANCE = {
  elements: {
    socialButtons: { display: 'none' },
    socialButtonsBlockButton: { display: 'none' },
    socialButtonsRoot: { display: 'none' },
    dividerRow: { display: 'none' },
  },
};

/** Deep-link into the Android app after Clerk finishes in Chrome. */
export const NATIVE_SSO_REDIRECT = 'kharchbaant://sso-callback';

/**
 * HTTPS bounce page (public/native-sso.html). Clerk Account Portal will not
 * send Chrome to a custom scheme, so it returns here and this page opens the app.
 */
export const NATIVE_PORTAL_RETURN_URL = 'https://www.motamaati.in/native-sso.html';
