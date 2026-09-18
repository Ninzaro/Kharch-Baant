import { registerPlugin, WebPlugin } from '@capacitor/core';

export interface ClerkNativeAuthPlugin {
  signInWithGoogle(options: {
    publishableKey: string;
  }): Promise<{ token: string }>;
  signUpWithGoogle(options: {
    publishableKey: string;
  }): Promise<{ token: string }>;
  signOut(): Promise<void>;
}

class ClerkNativeAuthWeb extends WebPlugin implements ClerkNativeAuthPlugin {
  async signInWithGoogle(): Promise<{ token: string }> {
    throw new Error('Native Clerk authentication is only available on Android.');
  }

  async signUpWithGoogle(): Promise<{ token: string }> {
    throw new Error('Native Clerk authentication is only available on Android.');
  }

  async signOut(): Promise<void> {
    throw new Error('Native Clerk authentication is only available on Android.');
  }
}

const ClerkNativeAuth = registerPlugin<ClerkNativeAuthPlugin>('ClerkNativeAuth', {
  web: () => new ClerkNativeAuthWeb(),
});

export default ClerkNativeAuth;
