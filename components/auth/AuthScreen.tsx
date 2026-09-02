import React, { useState } from 'react';
import { SignIn, useClerk } from '@clerk/clerk-react';
import { Capacitor } from '@capacitor/core';
import { performNativeGoogleSignIn } from '../../services/nativeGoogleAuth';
import toast from 'react-hot-toast';

interface AuthScreenProps {
  onBack?: () => void;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
    />
  </svg>
);

/** Web Clerk sign-in & Native Credential Manager Google Sign-In with in-app email fallback. */
const AuthScreen: React.FC<AuthScreenProps> = ({ onBack }) => {
  const clerk = useClerk();
  const isNative = Capacitor.isNativePlatform();
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    if (googleLoading) return;
    setGoogleLoading(true);

    try {
      // 1. Native Google Sign-In via Credential Manager bottom sheet
      const { idToken } = await performNativeGoogleSignIn();
      if (!idToken) {
        throw new Error('No Google ID token received.');
      }

      // 2. Pass ID token to Clerk Google One Tap handler
      const signInOrUp = await (clerk as any).authenticateWithGoogleOneTap({
        token: idToken,
      });

      // 3. Complete Clerk session activation
      await (clerk as any).handleGoogleOneTapCallback(signInOrUp, {
        signInFallbackRedirectUrl: '/',
        signUpFallbackRedirectUrl: '/',
      });
    } catch (err: any) {
      console.error('Native Google Sign-In error:', err);
      const msg = err?.message || String(err);
      if (
        msg.includes('cancel') ||
        msg.includes('Abort') ||
        msg.includes('NoCredentialException') ||
        msg.includes('User cancelled')
      ) {
        console.log('Google sign-in was cancelled by user.');
      } else {
        toast.error(
          err?.errors?.[0]?.longMessage ||
          err?.errors?.[0]?.message ||
          msg ||
          'Google Sign-In failed'
        );
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 safe-area-top safe-area-bottom">
      <div className="w-full max-w-md flex flex-col items-center">
        {onBack && (
          <div className="w-full flex justify-start mb-4">
            <button
              type="button"
              onClick={onBack}
              className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-card border border-border transition-colors shadow-sm"
            >
              ← Back
            </button>
          </div>
        )}
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-foreground mb-2" aria-hidden>
            💰
          </h1>
          <h2 className="text-2xl font-bold text-foreground">Kharch Baant</h2>
          <p className="text-muted-foreground text-sm">Shared Expense Tracker</p>
        </div>

        {isNative && (
          <div className="w-full max-w-sm mb-2">
            <button
              type="button"
              disabled={googleLoading}
              onClick={handleGoogleSignIn}
              className="w-full py-2.5 px-4 rounded-xl bg-card border border-border text-foreground font-medium flex items-center justify-center gap-3 hover:bg-card/80 transition-colors shadow-sm disabled:opacity-60"
            >
              {googleLoading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent" />
              ) : (
                <GoogleIcon className="w-5 h-5 shrink-0" />
              )}
              <span>{googleLoading ? 'Signing in with Google...' : 'Continue with Google'}</span>
            </button>


            <div className="relative w-full my-4 text-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <span className="relative bg-background px-3 text-xs text-muted-foreground">
                or continue with email
              </span>
            </div>
          </div>
        )}

        <SignIn
          routing="virtual"
          fallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
          appearance={
            isNative
              ? {
                  elements: {
                    socialButtons: { display: 'none' },
                    dividerRow: { display: 'none' },
                  },
                }
              : undefined
          }
        />
      </div>
    </div>
  );
};

export default AuthScreen;


