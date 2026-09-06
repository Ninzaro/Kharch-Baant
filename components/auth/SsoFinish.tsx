import React, { useEffect, useState, useCallback } from 'react';
import { useClerk } from '@clerk/clerk-react';
import { consumeCapturedSsoCallback, getCapturedSsoRawUrl, spaNavigate } from '../../utils/nativeDeepLinks';

/**
 * Completes SSO in the same WebView instance that received appUrlOpen.
 * Does not mount <AuthenticateWithRedirectCallback /> — that helper calls
 * handleRedirectCallback(params) with one argument, so Clerk reloads the page.
 */
const SsoFinish: React.FC = () => {
  const clerk = useClerk();
  const [status, setStatus] = useState<'working' | 'error'>('working');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const goHome = useCallback(() => {
    spaNavigate('/');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const raw = getCapturedSsoRawUrl();
    console.log('MY_SSO: SsoFinish mounted', JSON.stringify({
      clerkLoaded: clerk.loaded,
      hasCapturedUrl: Boolean(raw),
    }));

    (async () => {
      await clerk.loaded;
      if (cancelled) return;
      const handled = await consumeCapturedSsoCallback(clerk);
      if (cancelled) return;
      if (handled) return;
      if (getCapturedSsoRawUrl()) {
        setStatus('error');
        setErrorMessage(
          'Google finished in the browser, but this app did not receive an active Clerk session. Stay on this screen and try Continue with Google again.'
        );
      }
    })().catch((err: any) => {
      if (cancelled) return;
      console.log('MY_SSO: SsoFinish consume failed', err?.status || err?.errors?.[0]?.code || 'unknown');
      setStatus('error');
      setErrorMessage(
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        err?.message ||
        'Failed to complete sign in.'
      );
    });

    return () => {
      cancelled = true;
    };
  }, [clerk, goHome]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans p-6 safe-area-top safe-area-bottom">
      <div className="text-center max-w-sm">
        {status === 'working' && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4" />
            <p className="text-foreground font-medium mb-1">Completing sign in...</p>
          </>
        )}
        {status === 'error' && (
          <div className="p-6 bg-card border border-border rounded-2xl shadow-xl space-y-4">
            <h3 className="text-base font-bold text-foreground">Could not complete sign in</h3>
            <p className="text-xs text-muted-foreground">{errorMessage}</p>
            <button
              type="button"
              onClick={goHome}
              className="w-full py-2 px-4 bg-card border border-border text-foreground rounded-xl font-medium text-xs"
            >
              Back to Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SsoFinish;
