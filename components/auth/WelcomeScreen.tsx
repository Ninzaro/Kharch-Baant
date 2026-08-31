import React from 'react';

interface WelcomeScreenProps {
  onContinue: () => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onContinue }) => {
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
        <button
          type="button"
          onClick={onContinue}
          className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold shadow-sm"
        >
          Get started
        </button>
        <p className="text-center text-xs text-muted-foreground">
          Sign in with Google, Apple, Microsoft, or email.
        </p>
      </div>
    </div>
  );
};

export default WelcomeScreen;
