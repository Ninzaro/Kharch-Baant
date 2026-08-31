import React from 'react';
import { SignIn } from '@clerk/clerk-react';

interface AuthScreenProps {
  onBack?: () => void;
}

/** Web Clerk sign-in & Native Email/Password fallback. */
const AuthScreen: React.FC<AuthScreenProps> = ({ onBack }) => {
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
        <SignIn
          routing="virtual"
          fallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
        />
      </div>
    </div>
  );
};

export default AuthScreen;

