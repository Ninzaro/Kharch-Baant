import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

let registered = false;
let removeListener: (() => Promise<void>) | null = null;
let capturedSsoRawUrl: string | null = null;
let ssoConsumeStarted = false;

const HANDLE_REDIRECT_PARAMS = {
  signInUrl: '/',
  signUpUrl: '/',
  signInFallbackRedirectUrl: '/',
  signUpFallbackRedirectUrl: '/',
  continueSignUpUrl: '/',
  firstFactorUrl: '/',
  secondFactorUrl: '/',
};

function ssoLog(message: string, extra?: Record<string, string | boolean | number | null>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`MY_SSO: ${message}${payload}`);
}

export function isSsoCallbackUrl(rawUrl: string): boolean {
  return (
    /sso-callback/i.test(rawUrl) ||
    /native-sso/i.test(rawUrl) ||
    /__clerk_status/i.test(rawUrl) ||
    /__clerk_created_session/i.test(rawUrl)
  );
}

export function queryAndHashFromAppUrl(rawUrl: string): { query: string; hash: string } {
  let rest = rawUrl;
  const schemeIdx = rest.indexOf('://');
  if (schemeIdx >= 0) {
    rest = rest.substring(schemeIdx + 3);
  }
  const qMark = rest.indexOf('?');
  const hashIdx = rest.indexOf('#');

  let query = '';
  let hash = '';

  if (hashIdx >= 0) {
    hash = rest.substring(hashIdx);
    rest = rest.substring(0, hashIdx);
  }
  if (qMark >= 0) {
    query = rest.substring(qMark);
  }

  return { query, hash };
}

export function historyPathForAppUrl(rawUrl: string): string | null {
  const inviteMatch = rawUrl.match(/invite\/([^/?#]+)/i);
  if (inviteMatch) {
    return `/invite/${decodeURIComponent(inviteMatch[1])}`;
  }

  if (!isSsoCallbackUrl(rawUrl)) {
    return null;
  }

  const { query, hash } = queryAndHashFromAppUrl(rawUrl);
  return `/sso-callback${query}${hash}`;
}

export function getCapturedSsoRawUrl(): string | null {
  return capturedSsoRawUrl;
}

export function isSsoFlowPending(): boolean {
  return Boolean(capturedSsoRawUrl) || ssoConsumeStarted;
}

function logClerkAuthState(clerk: any, phase: string): void {
  const sessions = clerk?.client?.signedInSessions || clerk?.client?.sessions || [];
  ssoLog(`auth state after ${phase}`, {
    isSignedIn: clerk?.isSignedIn ?? Boolean(clerk?.session || clerk?.user),
    hasSession: Boolean(clerk?.session),
    sessionId: clerk?.session?.id || null,
    userId: clerk?.user?.id || null,
    signedInSessions: Array.isArray(sessions) ? sessions.length : -1,
  });
}

/** SPA-only navigation — never window.location (that reloads the WebView and drops the deep link). */
export function spaNavigate(to: string): void {
  const next = to || '/';
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (current === next) return;
  window.history.replaceState({}, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Clerk JS for @clerk/clerk-react v5:
 *   clerk.handleRedirectCallback(params, customNavigate)
 * customNavigate is the 2nd argument. The React <AuthenticateWithRedirectCallback />
 * component does NOT pass it, so Clerk default-navigates with window.location and
 * reloads the Capacitor WebView.
 */
export async function consumeCapturedSsoCallback(clerk: any): Promise<boolean> {
  const raw = capturedSsoRawUrl;
  if (!raw || ssoConsumeStarted) return false;
  if (!clerk) {
    ssoLog('consume skipped: clerk missing');
    return false;
  }

  ssoConsumeStarted = true;
  const path = historyPathForAppUrl(raw);
  if (path) {
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (current !== path) {
      window.history.replaceState({}, '', path);
    }
  }

  ssoLog('calling clerk.handleRedirectCallback (2-arg, spaNavigate)', {
    hasQuery: (path || '').includes('?'),
    hasClerkSessionParam: /__clerk_created_session=/i.test(raw),
    hasClerkStatusParam: /__clerk_status=/i.test(raw),
  });

  try {
    await clerk.loaded;
    if (typeof clerk.handleRedirectCallback !== 'function') {
      throw new Error('handleRedirectCallback is not available on this Clerk instance');
    }
    await clerk.handleRedirectCallback(HANDLE_REDIRECT_PARAMS, async (to: string) => {
      logClerkAuthState(clerk, 'spaNavigate callback');
      // Clerk may call this before React context hydrates. Do not route to
      // signed-out Home/sign-in unless a session actually exists.
      if (!clerk.session && !clerk.user) {
        ssoLog('deferring spaNavigate; Clerk session not populated yet');
        return;
      }
      ssoLog('handleRedirectCallback spaNavigate');
      spaNavigate(to || '/');
    });
    ssoLog('handleRedirectCallback finished');
    logClerkAuthState(clerk, 'handleRedirectCallback resolved');

    if (clerk.session || clerk.user) {
      capturedSsoRawUrl = null;
      spaNavigate('/');
      void Browser.close().catch(() => {});
      return true;
    }

    ssoLog('callback resolved without an active Clerk session on this client');
    ssoConsumeStarted = false;
    return false;
  } catch (err: any) {
    ssoLog('handleRedirectCallback failed', {
      status: err?.status || null,
      code: err?.errors?.[0]?.code || err?.message || 'unknown',
    });
    ssoConsumeStarted = false;
    return false;
  }
}

export function applyNativeAppUrl(rawUrl: string): string | null {
  const hasQuery = rawUrl.includes('?');
  const hasHash = rawUrl.includes('#');
  const scheme = rawUrl.split(':')[0] || 'unknown';
  ssoLog('incoming url', {
    scheme,
    isSso: isSsoCallbackUrl(rawUrl),
    hasQuery,
    hasHash,
    hasClerkSessionParam: /__clerk_created_session=/i.test(rawUrl),
    hasClerkStatusParam: /__clerk_status=/i.test(rawUrl),
  });

  const next = historyPathForAppUrl(rawUrl);
  if (!next) {
    ssoLog('url ignored (not invite/sso)');
    return null;
  }

  if (isSsoCallbackUrl(rawUrl)) {
    capturedSsoRawUrl = rawUrl;
    ssoConsumeStarted = false;
    ssoLog('captured SSO url in memory (not getLaunchUrl)');
    window.history.replaceState({}, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
    const clerk = typeof window !== 'undefined' ? (window as any).Clerk : null;
    if (clerk) {
      void consumeCapturedSsoCallback(clerk);
    } else {
      ssoLog('Clerk not on window yet; SsoFinish will consume captured url');
    }
    return next;
  }

  const current = window.location.pathname + window.location.search + window.location.hash;
  if (current === next) return next;
  window.history.replaceState({}, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
  return next;
}

export async function registerNativeDeepLinkListener(): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform()) {
    return async () => {};
  }

  if (registered) {
    return async () => {
      if (removeListener) await removeListener();
    };
  }
  registered = true;
  ssoLog('registering appUrlOpen listener');

  const handle = await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    ssoLog('appUrlOpen received');
    applyNativeAppUrl(url);
  });

  ssoLog('getLaunchUrl called');
  const launchUrl = await CapacitorApp.getLaunchUrl();
  if (launchUrl?.url) {
    ssoLog('launch URL received');
    applyNativeAppUrl(launchUrl.url);
  } else {
    ssoLog('launch URL empty');
  }

  removeListener = async () => {
    registered = false;
    await handle.remove();
    removeListener = null;
  };

  return removeListener;
}
