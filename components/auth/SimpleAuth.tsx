import React, { useState } from 'react';

interface SimpleAuthProps {
  children: React.ReactNode;
}

// Temporary bypass for testing - remove when Clerk is working
const SimpleAuth: React.FC<SimpleAuthProps> = ({ children }) => {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [email, setEmail] = useState('');

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-primary/40 to-background flex items-center justify-center p-4">
        <div className="bg-card backdrop-blur-md rounded-2xl p-8 shadow-lg border border-border max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">💰</h1>
            <h2 className="text-2xl font-bold text-foreground">Kharch-Baant</h2>
            <p className="text-muted-foreground text-sm">Quick Demo Access</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Email (any email for demo)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="your@email.com"
              />
            </div>

            <button
              onClick={() => {
                if (email) {
                  setIsSignedIn(true);
                }
              }}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-3 px-4 rounded-lg transition-colors"
            >
              Enter App (Demo Mode)
            </button>

            <p className="text-muted-foreground text-xs text-center">
              This is a temporary bypass while Clerk is being configured
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default SimpleAuth;