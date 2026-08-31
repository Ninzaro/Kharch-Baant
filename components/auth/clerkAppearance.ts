/** Deep-link into the Android app after Clerk finishes in Chrome. */
export const NATIVE_SSO_REDIRECT = 'kharchbaant://sso-callback';

/**
 * HTTPS bounce page (public/native-sso.html). Clerk Account Portal will not
 * send Chrome to a custom scheme, so it returns here and this page opens the app.
 */
export const NATIVE_PORTAL_RETURN_URL = 'https://www.motamaati.in/native-sso.html';
