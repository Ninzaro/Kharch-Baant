import React from 'react';
import { SignIn } from '@clerk/clerk-react';

/** Web Clerk sign-in. Android uses WelcomeScreen → Clerk Account Portal in Chrome. */
const AuthScreen: React.FC = () => {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 safe-area-top safe-area-bottom">
      <div className="w-full max-w-md flex flex-col items-center">
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
