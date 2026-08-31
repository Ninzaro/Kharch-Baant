/**
 * Hide only Clerk's own SSO buttons on native. Do not hide socialButtonsRoot —
 * that sends <SignIn> to an empty "Use another method" screen and kills email.
 * NativeSocialButtons starts Google / Apple / Microsoft in Custom Tabs instead.
 */
export const nativeHideClerkSocials = {
  socialButtonsBlockButton__google: { display: 'none' },
  socialButtonsIconButton__google: { display: 'none' },
  socialButtonsBlockButton__apple: { display: 'none' },
  socialButtonsIconButton__apple: { display: 'none' },
  socialButtonsBlockButton__microsoft: { display: 'none' },
  socialButtonsIconButton__microsoft: { display: 'none' },
} as const;

export const NATIVE_SSO_REDIRECT = 'kharchbaant://sso-callback';
