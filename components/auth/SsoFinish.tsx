import React, { useEffect, useState } from 'react';
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

function leaveSsoPath() {
  window.history.replaceState({}, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Finish OAuth inside the app. Never send Clerk to the Account Portal here —
 * that re-opens Chrome and loops with native-sso.html.
 */
const SsoFinish: React.FC = () => {
  const { setActive } = useClerk();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const sessionId = sessionIdFromLocation();
    if (sessionId) {
      void setActive({ session: sessionId }).catch((err) => {
        console.error('setActive after SSO failed', err);
      });
    }
    const timer = setTimeout(() => {
      setStuck(true);
      leaveSsoPath();
    }, 10000);
    return () => clearTimeout(timer);
  }, [setActive]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans p-6">
      <div className="text-center max-w-sm">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent mx-auto mb-4" />
        <p className="text-foreground font-medium mb-1">Completing sign in...</p>
        <p className="text-xs text-muted-foreground">
          {stuck ? 'Still working… you can close this and tap Get started again.' : 'Please wait a moment'}
        </p>
        <AuthenticateWithRedirectCallback
          signInUrl="/"
          signUpUrl="/"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
          continueSignUpUrl="/"
          firstFactorUrl="/"
          secondFactorUrl="/"
        />
      </div>
    </div>
  );
};

export default SsoFinish;
