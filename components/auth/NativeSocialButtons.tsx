import React from 'react';
import { NATIVE_OAUTH_PROVIDERS, useNativeOAuth } from '../../hooks/useNativeOAuth';

/** Capacitor-only: Clerk's built-in social buttons would OAuth inside the WebView. */
const NativeSocialButtons: React.FC = () => {
  const { isNative, isLoaded, startOAuth, oauthBusy, oauthError } = useNativeOAuth();
  if (!isNative) return null;

  return (
    <div className="w-full mb-4 space-y-2">
      {NATIVE_OAUTH_PROVIDERS.map(({ strategy, label }) => (
        <button
          key={strategy}
          type="button"
          onClick={() => void startOAuth(strategy)}
          disabled={!isLoaded || oauthBusy !== null}
          className="w-full py-3 px-4 rounded-xl bg-card border border-border text-foreground font-medium shadow-sm disabled:opacity-50"
        >
          {oauthBusy === strategy ? `Opening ${label}…` : `Continue with ${label}`}
        </button>
      ))}
      {oauthError && (
        <p className="text-sm text-destructive text-center">{oauthError}</p>
      )}
      <p className="text-xs text-center text-muted-foreground">or use email below</p>
    </div>
  );
};

export default NativeSocialButtons;
