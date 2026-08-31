import React from 'react';

interface WelcomeScreenProps {
  onContinue?: () => void;
  onGoogleSignIn?: () => void;
  onEmailSignIn?: () => void;
  loading?: boolean;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onContinue,
  onGoogleSignIn,
  onEmailSignIn,
  loading = false,
}) => {
  const handleGoogleClick = onGoogleSignIn || onContinue;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col px-6 py-10 safe-area-top safe-area-bottom">
      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        <p className="text-5xl mb-4" aria-hidden>
          💰
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Kharch Baant</h1>
        <p className="text-muted-foreground mt-2 text-base">
          Split trips, rent, and dinners with friends — without the spreadsheet headache.
        </p>

        <ul className="mt-8 space-y-3 text-sm text-foreground">
          <li className="flex gap-3">
            <span className="text-primary font-bold">1.</span>
            Create a group for a trip or household
          </li>
          <li className="flex gap-3">
            <span className="text-primary font-bold">2.</span>
            Add expenses and split them fairly
          </li>
          <li className="flex gap-3">
            <span className="text-primary font-bold">3.</span>
            See who owes whom and settle up
          </li>
        </ul>
      </div>

      <div className="max-w-md mx-auto w-full space-y-3 pb-4">
        {handleGoogleClick && (
          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleClick}
            className="w-full py-3 px-4 rounded-xl bg-card border border-border text-foreground font-semibold shadow-sm hover:bg-card/80 flex items-center justify-center gap-3 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent" />
            ) : (
              <GoogleIcon />
            )}
            <span>Continue with Google</span>
          </button>
        )}

        {onEmailSignIn && (
          <button
            type="button"
            disabled={loading}
            onClick={onEmailSignIn}
            className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            Continue with Email
          </button>
        )}

        {!onEmailSignIn && !handleGoogleClick && (
          <button
            type="button"
            disabled={loading}
            onClick={onContinue}
            className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold shadow-sm"
          >
            Get started
          </button>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Secure authentication powered by Clerk.
        </p>
      </div>
    </div>
  );
};

export default WelcomeScreen;

