import React from 'react';

interface AuthFailureScreenProps {
  retrying?: boolean;
  onRetry: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}

const AuthFailureScreen: React.FC<AuthFailureScreenProps> = ({
  retrying = false,
  onRetry,
  onSignOut,
}) => (
  <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans p-6">
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
      <h1 className="text-xl font-semibold mb-2">We couldn't connect your account</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Your authentication session could not be verified. Your expense data has not been loaded.
      </p>
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => void onRetry()}
          disabled={retrying}
          className="w-full py-2.5 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {retrying ? 'Reconnecting…' : 'Retry'}
        </button>
        <button
          type="button"
          onClick={() => void onSignOut()}
          className="w-full py-2.5 px-4 bg-muted text-foreground rounded-lg font-medium hover:bg-muted/80 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  </div>
);

export default AuthFailureScreen;
