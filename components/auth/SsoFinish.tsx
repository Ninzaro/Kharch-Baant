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
 * Utilizes customNavigate to stay within the SPA without full page refreshes.
 */
const SsoFinish: React.FC = () => {
  const { setActive } = useClerk();
  const [stuck, setStuck] = useState(false);

  const handleNavigate = useCallback((to: string) => {
    window.history.replaceState({}, '', to || '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  useEffect(() => {
    const sessionId = sessionIdFromLocation();
    if (sessionId) {
      void setActive({ session: sessionId }).catch((err) => {
        console.warn('Direct setActive failed, letting AuthenticateWithRedirectCallback proceed:', err);
      });
    }
    const timer = setTimeout(() => {
      setStuck(true);
    }, 12000);
    return () => clearTimeout(timer);
  }, [setActive]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans p-6">
      <div className="text-center max-w-sm">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4" />
        <p className="text-foreground font-medium mb-1">Completing sign in...</p>
        <p className="text-xs text-muted-foreground mb-4">
          {stuck
            ? 'Taking longer than expected. You can return to try again.'
            : 'Please wait a moment'}
        </p>

        {stuck && (
          <button
            type="button"
            onClick={() => handleNavigate('/')}
            className="py-2 px-4 bg-primary text-primary-foreground rounded-lg font-medium text-xs hover:bg-primary/90 transition-colors shadow-sm"
          >
            Return to Sign In
          </button>
        )}

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

