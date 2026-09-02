import React, { useEffect, useState, useCallback } from 'react';
import { AuthenticateWithRedirectCallback, useClerk } from '@clerk/clerk-react';

function sessionIdFromLocation(): string | null {
  const search = new URLSearchParams(window.location.search);
  const fromQuery = search.get('__clerk_created_session') || search.get('created_session_id');
  if (fromQuery) return fromQuery;
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return null;
  const hashParams = new URLSearchParams(hash.includes('=') ? hash : '');
  return hashParams.get('__clerk_created_session') || hashParams.get('created_session_id');
}

/**
 * Finish OAuth inside the app.
 * If sessionId is present (from Chrome SSO callback), activate it directly.
 * Only mount AuthenticateWithRedirectCallback if there is no direct sessionId.
 */
const SsoFinish: React.FC = () => {
  const { setActive } = useClerk();
  const [sessionId] = useState<string | null>(() => sessionIdFromLocation());
  const [status, setStatus] = useState<'working' | 'error' | 'success'>('working');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleNavigate = useCallback((to: string) => {
    window.history.replaceState({}, '', to || '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    let isMounted = true;
    (async () => {
      try {
        console.log('Activating Clerk session from SSO callback:', sessionId);
        await setActive({ session: sessionId });
        if (isMounted) {
          setStatus('success');
          handleNavigate('/');
        }
      } catch (err: any) {
        console.error('Error activating session:', err);
        if (isMounted) {
          setStatus('error');
          setErrorMessage(
            err?.errors?.[0]?.longMessage ||
            err?.errors?.[0]?.message ||
            err?.message ||
            'Failed to complete sign in.'
          );
        }
      }
    })();

    const timer = setTimeout(() => {
      if (isMounted && status === 'working') {
        setStatus('error');
        setErrorMessage('Sign-in took longer than expected. Please try again.');
      }
    }, 15000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [sessionId, setActive, handleNavigate, status]);

  if (sessionId) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans p-6 safe-area-top safe-area-bottom">
        <div className="text-center max-w-sm">
          {status === 'working' && (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4" />
              <p className="text-foreground font-medium mb-1">Completing sign in...</p>
              <p className="text-xs text-muted-foreground mb-4">Connecting your account, please wait</p>
            </>
          )}

          {status === 'error' && (
            <div className="p-6 bg-card border border-border rounded-2xl shadow-xl space-y-4">
              <div className="text-3xl">⚠️</div>
              <h3 className="text-base font-bold text-foreground">Could not complete sign in</h3>
              <p className="text-xs text-muted-foreground">{errorMessage}</p>
              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setStatus('working');
                    setErrorMessage(null);
                    void setActive({ session: sessionId })
                      .then(() => handleNavigate('/'))
                      .catch((err: any) => {
                        setStatus('error');
                        setErrorMessage(
                          err?.errors?.[0]?.longMessage ||
                          err?.errors?.[0]?.message ||
                          err?.message ||
                          'Retry failed.'
                        );
                      });
                  }}
                  className="w-full py-2.5 px-4 bg-primary text-primary-foreground rounded-xl font-medium text-xs hover:bg-primary/90 transition-colors shadow-sm"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('/')}
                  className="w-full py-2 px-4 bg-card border border-border text-foreground rounded-xl font-medium text-xs hover:bg-card/80 transition-colors shadow-sm"
                >
                  Back to Sign In
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Fallback for direct redirects with __clerk_status params
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans p-6 safe-area-top safe-area-bottom">
      <div className="text-center max-w-sm">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4" />
        <p className="text-foreground font-medium mb-1">Completing sign in...</p>
        <p className="text-xs text-muted-foreground mb-4">Please wait a moment</p>
        <AuthenticateWithRedirectCallback
          signInUrl="/"
          signUpUrl="/"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
          continueSignUpUrl="/"
          firstFactorUrl="/"
          secondFactorUrl="/"
          customNavigate={handleNavigate}
        />
      </div>
    </div>
  );
};

export default SsoFinish;


