import { registerPlugin, WebPlugin } from '@capacitor/core';

export interface ClerkNativeAuthPlugin {
  signInWithGoogle(options: {
    googleIdToken: string;
    publishableKey: string;
  }): Promise<{ token: string }>;
}

class ClerkNativeAuthWeb extends WebPlugin implements ClerkNativeAuthPlugin {
  async signInWithGoogle(): Promise<{ token: string }> {
    throw new Error('Native Clerk authentication is only available on Android.');
  }
}

const ClerkNativeAuth = registerPlugin<ClerkNativeAuthPlugin>('ClerkNativeAuth', {
  web: () => new ClerkNativeAuthWeb(),
});

export default ClerkNativeAuth;
