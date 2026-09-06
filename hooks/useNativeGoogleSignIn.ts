import { useState } from 'react';
import { useSignIn } from '@clerk/clerk-react';
import toast from 'react-hot-toast';
import { completeNativeGoogleSignIn } from '../services/nativeAuthBridge';

export function useNativeGoogleSignIn() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [busy, setBusy] = useState(false);

  const signInWithGoogle = async (): Promise<void> => {
    if (!isLoaded || !signIn || !setActive || busy) {
      return;
    }

    setBusy(true);
    try {
      await completeNativeGoogleSignIn({ signIn, setActive });
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Google sign-in failed.';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return { signInWithGoogle, busy, isLoaded };
}
