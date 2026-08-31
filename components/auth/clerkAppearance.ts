/**
 * On Capacitor, Clerk's built-in social buttons OAuth inside the WebView.
 * NativeSocialButtons starts Google / Apple / Microsoft in Custom Tabs instead.
 */
export const nativeHideClerkSocials = {
  socialButtonsRoot: { display: 'none' },
  dividerRow: { display: 'none' },
} as const;

export const NATIVE_SSO_REDIRECT = 'kharchbaant://sso-callback';
