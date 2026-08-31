import React from 'react';
import { SignIn } from '@clerk/clerk-react';
import { Capacitor } from '@capacitor/core';
import NativeSocialButtons from './NativeSocialButtons';
import { nativeHideClerkSocials } from './clerkAppearance';

interface AuthScreenProps {
  onBack?: () => void;
}

/**
 * Clerk sign-in. On Capacitor, OAuth must not run inside the WebView
 * (Google returns HTTP 400 / "malformed"). NativeSocialButtons opens
 * Google / Apple / Microsoft in a Custom Tab and returns via
 * kharchbaant://sso-callback.
 */
const AuthScreen: React.FC<AuthScreenProps> = ({ onBack }) => {
  const isNative = Capacitor.isNativePlatform();

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 safe-area-top safe-area-bottom">
      <div className="w-full max-w-md flex flex-col items-center">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="self-start mb-4 text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
        )}

        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-foreground mb-2" aria-hidden>
            💰
          </h1>
          <h2 className="text-2xl font-bold text-foreground">Kharch Baant</h2>
          <p className="text-muted-foreground text-sm">Shared Expense Tracker</p>
        </div>

        <NativeSocialButtons />

        <SignIn
          routing="virtual"
          fallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
          appearance={{
            elements: isNative ? nativeHideClerkSocials : undefined,
          }}
        />
      </div>
    </div>
  );
};

export default AuthScreen;
