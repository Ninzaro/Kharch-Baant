import { useState } from 'react';
import { useSignIn } from '@clerk/clerk-react';
import toast from 'react-hot-toast';
import { completeNativeGoogleSignUp } from '../services/nativeAuthBridge';

export function useNativeGoogleSignUp() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [busy, setBusy] = useState(false);

  const signUpWithGoogle = async (): Promise<void> => {
    if (!isLoaded || !signIn || !setActive || busy) {
      return;
    }

    setBusy(true);
    try {
      await completeNativeGoogleSignUp({ signIn, setActive });
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Google sign-up failed.';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return { signUpWithGoogle, busy, isLoaded };
}
